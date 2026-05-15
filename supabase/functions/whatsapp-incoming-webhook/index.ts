/**
 * POST /whatsapp-incoming-webhook (thin wrapper — Sprint 35)
 * Recebe payload Evolution API, traduz pro formato unificado e encaminha
 * pra /incoming-message (que valida secret + dispara Marcos).
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as Record<string, unknown>;
  if (typeof m.conversation === "string") return m.conversation;
  if (m.extendedTextMessage && typeof (m.extendedTextMessage as Record<string, unknown>).text === "string") {
    return (m.extendedTextMessage as Record<string, string>).text;
  }
  if (m.imageMessage && typeof (m.imageMessage as Record<string, unknown>).caption === "string") {
    return `[imagem] ${(m.imageMessage as Record<string, string>).caption}`;
  }
  if (m.audioMessage) return "[áudio]";
  if (m.videoMessage) return "[vídeo]";
  if (m.documentMessage) return "[documento]";
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const supabase = adminClient();
  const { data: cfg } = await supabase
    .from("evolution_config")
    .select("webhook_secret, active")
    .limit(1)
    .maybeSingle();
  if (!cfg) return errorResponse("Evolution não configurada", 404);
  if (!cfg.active) return jsonResponse({ ok: true, ignored: "inactive" });

  const provided = req.headers.get("X-Webhook-Secret") ?? req.headers.get("apikey");
  if (!provided || provided !== cfg.webhook_secret) {
    return errorResponse("Invalid webhook secret", 401);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("Body inválido", 400); }

  const event = String(body.event ?? "");
  if (event !== "messages.upsert") return jsonResponse({ ok: true, ignored: event });

  const instanceName = String(body.instance ?? "");
  const data = (body.data ?? {}) as Record<string, unknown>;
  const key = (data.key ?? {}) as Record<string, unknown>;
  const fromMe = !!key.fromMe;
  const remoteJid = String(key.remoteJid ?? "");
  if (fromMe || !remoteJid || !instanceName) return jsonResponse({ ok: true, ignored: "skip" });

  const phone = remoteJid.split("@")[0];
  const text = extractText(data.message);
  if (!text.trim()) return jsonResponse({ ok: true, ignored: "no_text" });

  // Forward para o entry-point unificado
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const fwd = await fetch(`${supabaseUrl}/functions/v1/incoming-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        channel: `whatsapp:${instanceName}`,
        external_id: phone,
        text,
        secret: cfg.webhook_secret,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await fwd.json().catch(() => ({}));
    return jsonResponse({ ok: true, forwarded: json });
  } catch (err) {
    console.error("forward to incoming-message failed:", err);
    return errorResponse(`Forward failed: ${String(err)}`, 502);
  }
});
