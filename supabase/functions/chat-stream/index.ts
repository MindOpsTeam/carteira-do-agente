/**
 * POST /chat-stream
 * Proxy SSE: browser → edge → tunnel OpenClaw /v1/chat/completions.
 * Resolve CORS (browser não consegue chamar tunnel direto) e esconde gateway_token.
 *
 * Auth: JWT do dono logado.
 * Body: { messages: [{role,content}], model?, max_tokens? }
 * Retorna: text/event-stream (SSE OpenAI-compatible)
 */

import { adminClient, corsHeaders, errorResponse } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return errorResponse("Auth required", 401);

  const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) return errorResponse("Configuração do painel incompleta", 500);

  const supabaseUser = createClient(Deno.env.get("SUPABASE_URL")!, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
  if (userErr || !user) return errorResponse("JWT inválido", 401);

  let body: {
    messages?: Array<{ role: string; content: string }>;
    model?: string;
    max_tokens?: number;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body inválido", 400);
  }
  if (!body.messages?.length) return errorResponse("messages obrigatório", 400);

  const supabase = adminClient();
  const { data: instance } = await supabase
    .from("instances")
    .select("ingress_url, openclaw_dashboard_token, last_heartbeat")
    .order("last_heartbeat", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!instance?.ingress_url || !instance?.openclaw_dashboard_token) {
    return errorResponse("VPS não configurada", 503);
  }
  const lastHb = instance.last_heartbeat
    ? new Date(instance.last_heartbeat).getTime()
    : 0;
  if (Date.now() - lastHb > 5 * 60 * 1000) {
    return errorResponse("VPS offline (sem heartbeat recente)", 503);
  }

  const upstreamUrl = `${instance.ingress_url.replace(/\/$/, "")}/v1/chat/completions`;
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${instance.openclaw_dashboard_token}`,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify({
        model: body.model ?? "openclaw",
        messages: body.messages,
        stream: true,
        max_tokens: body.max_tokens ?? 2048,
      }),
    });
  } catch (err) {
    return errorResponse(`Falha ao contatar VPS: ${(err as Error).message}`, 502);
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return errorResponse(`Upstream ${upstream.status}: ${text.slice(0, 200)}`, 502);
  }

  // Wrap upstream stream and inject `: keepalive\n\n` SSE comments every 15s,
  // so Cloudflare/proxies don't buffer the connection while the model is
  // "thinking" (no chunks yet) and the browser detector sees fresh activity.
  const encoder = new TextEncoder();
  const KEEPALIVE_MS = 15_000;
  const upstreamStream = upstream.body;
  const merged = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const ka = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          /* controller already closed */
        }
      }, KEEPALIVE_MS);

      (async () => {
        const reader = upstreamStream.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
        } catch (err) {
          try {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`,
              ),
            );
          } catch { /* noop */ }
        } finally {
          closed = true;
          clearInterval(ka);
          try { controller.close(); } catch { /* noop */ }
          try { reader.releaseLock(); } catch { /* noop */ }
        }
      })();
    },
  });

  return new Response(merged, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
