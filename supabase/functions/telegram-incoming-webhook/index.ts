/**
 * POST /telegram-incoming-webhook?secret=<webhook_secret> (verify_jwt=false)
 * Thin wrapper: valida secret da query string contra telegram_bots.webhook_secret,
 * monta payload padrão e chama incoming-message.
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as Record<string, unknown>;
  if (typeof m.text === "string") return m.text;
  if (typeof m.caption === "string") return `[mídia] ${m.caption}`;
  if (m.photo) return "[foto]";
  if (m.voice) return "[áudio]";
  if (m.video) return "[vídeo]";
  if (m.document) return "[documento]";
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") ?? req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!secret) return errorResponse("secret obrigatório", 401);

  const supabase = adminClient();
  const { data: bot } = await supabase
    .from("telegram_bots")
    .select("id, bot_username, webhook_secret, active")
    .eq("webhook_secret", secret)
    .maybeSingle();
  if (!bot) return errorResponse("Invalid webhook secret", 401);
  if (!bot.active) return jsonResponse({ ok: true, ignored: "inactive" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("Body inválido", 400); }

  const update = body as Record<string, unknown>;
  const message = (update.message ?? update.edited_message ?? null) as Record<string, unknown> | null;
  if (!message) return jsonResponse({ ok: true, ignored: "no_message" });

  const chat = (message.chat ?? {}) as Record<string, unknown>;
  const chatId = chat.id ? String(chat.id) : "";
  const text = extractText(message);
  if (!chatId || !text.trim()) return jsonResponse({ ok: true, ignored: "no_text_or_chat" });

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
        channel: `telegram:${bot.bot_username}`,
        external_id: chatId,
        text,
        secret: bot.webhook_secret,
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
