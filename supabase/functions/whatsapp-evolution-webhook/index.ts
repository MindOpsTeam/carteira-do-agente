/**
 * POST /whatsapp-evolution-webhook
 * Webhook que recebe eventos da Evolution API e converte pro formato incoming-message.
 * Auth: ?apikey=<webhook_secret> ou header `apikey` validado contra evolution_config.webhook_secret.
 * verify_jwt=false.
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";

type EvolutionEvent = {
  event?: string;
  instance?: string;
  data?: {
    key?: { remoteJid?: string; fromMe?: boolean; id?: string };
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
      imageMessage?: { caption?: string };
    };
    pushName?: string;
  };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  // Auth: ?apikey=<webhook_secret> OR header `apikey`
  const url = new URL(req.url);
  const queryKey = url.searchParams.get("apikey") ?? "";
  const headerKey = req.headers.get("apikey") ?? "";
  const providedKey = queryKey || headerKey;

  const supabase = adminClient();
  const { data: cfg } = await supabase.from("evolution_config")
    .select("webhook_secret, active").limit(1).maybeSingle();
  if (!cfg || !cfg.active) return errorResponse("Evolution não configurada", 503);
  if (cfg.webhook_secret !== providedKey) return errorResponse("Invalid secret", 401);

  let body: EvolutionEvent;
  try { body = await req.json(); } catch { return errorResponse("Body inválido", 400); }

  // Aceita só messages.upsert; outros eventos retornam 200 silenciosamente
  if (body.event !== "messages.upsert") {
    return jsonResponse({ ok: true, ignored: `event=${body.event ?? "none"}` });
  }

  const instance = body.instance ?? "";
  const remoteJid = body.data?.key?.remoteJid ?? "";
  const fromMe = body.data?.key?.fromMe === true;

  if (!instance || !remoteJid) {
    return jsonResponse({ ok: true, ignored: "missing instance or remoteJid" });
  }

  // Self-chat permitido (user manda pro próprio número pra conversar com Marcos).
  // TODO: quando VPS estiver ativa e Marcos responder via send_message, adicionar dedup
  // por data.key.id (Marcos guarda em hooks_dedup os IDs das msgs que enviou ANTES da
  // Evolution disparar o webhook de volta) pra prevenir loop.
  // Por ora, sem VPS, fromMe=true em self-chat é tratado como user msg normal.

  // Ignora grupos por enquanto
  if (remoteJid.endsWith("@g.us")) return jsonResponse({ ok: true, ignored: "group" });

  const text =
    body.data?.message?.conversation ??
    body.data?.message?.extendedTextMessage?.text ??
    body.data?.message?.imageMessage?.caption ??
    "";

  if (!text.trim()) return jsonResponse({ ok: true, ignored: "no text" });

  // Extrai número (E.164 sem o sufixo @s.whatsapp.net)
  const phone = remoteJid.split("@")[0];

  // Forward pro incoming-message
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  try {
    const forwardResp = await fetch(`${supabaseUrl}/functions/v1/incoming-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
      },
      body: JSON.stringify({
        channel: `whatsapp:${instance}`,
        external_id: phone,
        text: text.trim(),
        secret: cfg.webhook_secret,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const respBody = await forwardResp.text();
    if (!forwardResp.ok) {
      console.error("forward failed:", forwardResp.status, respBody);
      return jsonResponse({ ok: false, forward_status: forwardResp.status, forward_body: respBody }, 200);
    }
    return jsonResponse({ ok: true, forwarded: true });
  } catch (err) {
    console.error("forward exception:", err);
    return jsonResponse({ ok: false, error: String(err) }, 200);
  }
});
