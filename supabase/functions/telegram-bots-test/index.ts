/**
 * POST /telegram-bots-test  body: { id }
 * Chama getMe na API do Telegram. Atualiza last_test_at/status, popula bot_name/username se faltar.
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { decryptVault } from "../_shared/vault.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: { id?: string };
  try { body = await req.json(); } catch { return errorResponse("Body inválido", 400); }
  if (!body.id) return errorResponse("id obrigatório", 400);

  const supabase = adminClient();
  const { data: bot, error: e1 } = await supabase
    .from("telegram_bots")
    .select("id, bot_name, bot_username, bot_token_encrypted")
    .eq("id", body.id)
    .maybeSingle();
  if (e1) return errorResponse(e1.message, 500);
  if (!bot) return errorResponse("Bot não encontrado", 404);

  let token: string;
  try { token = await decryptVault(bot.bot_token_encrypted); }
  catch (e) { return errorResponse(`Erro ao descriptar: ${(e as Error).message}`, 500); }

  let status: "ok" | "invalid_token" | "unreachable" = "unreachable";
  let detail = "";
  let username = bot.bot_username;
  let name = bot.bot_name;

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok && j.result) {
      status = "ok";
      detail = `@${j.result.username}`;
      username = String(j.result.username ?? username);
      name = String(j.result.first_name ?? j.result.username ?? name);
    } else {
      status = "invalid_token";
      detail = String(j.description ?? `HTTP ${r.status}`);
    }
  } catch (e) {
    status = "unreachable";
    detail = (e as Error).message;
  }

  const updates: Record<string, unknown> = {
    last_test_at: new Date().toISOString(),
    last_test_status: status,
    last_test_detail: detail.slice(0, 500),
    updated_at: new Date().toISOString(),
  };
  if (status === "ok") {
    if (!bot.bot_username && username) updates.bot_username = username;
    if (!bot.bot_name && name) updates.bot_name = name;
  }
  await supabase.from("telegram_bots").update(updates).eq("id", body.id);

  return jsonResponse({ status, detail });
});
