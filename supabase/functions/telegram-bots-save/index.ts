/**
 * POST /telegram-bots-save
 * Body: { id?, bot_name?, bot_username?, bot_token?, receives_marcos_chat, active }
 *
 * - Token formato <digits>:[A-Za-z0-9_-]+
 * - Encripta token
 * - Gera webhook_secret aleatório (32 hex) na primeira vez
 * - Upsert por bot_username (unique)
 * - Retorna { id, webhook_secret? } (secret só nessa resposta quando gerado)
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { encryptVault } from "../_shared/vault.ts";

const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,40}$/;

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: {
    id?: string;
    bot_name?: string;
    bot_username?: string;
    bot_token?: string;
    receives_marcos_chat?: boolean;
    active?: boolean;
  };
  try { body = await req.json(); } catch { return errorResponse("Body inválido", 400); }

  const supabase = adminClient();
  const token = (body.bot_token ?? "").trim();
  const receives_marcos_chat = !!body.receives_marcos_chat;
  const active = body.active !== false;

  // Update por id
  if (body.id) {
    const { data: existing } = await supabase
      .from("telegram_bots")
      .select("id, webhook_secret, bot_token_encrypted")
      .eq("id", body.id)
      .maybeSingle();
    if (!existing) return errorResponse("Bot não encontrado", 404);

    const updates: Record<string, unknown> = {
      receives_marcos_chat,
      active,
      updated_at: new Date().toISOString(),
    };
    if (body.bot_name !== undefined) updates.bot_name = (body.bot_name ?? "").trim() || "telegram-bot";
    if (body.bot_username !== undefined) {
      const u = (body.bot_username ?? "").trim().replace(/^@/, "");
      if (u && !USERNAME_RE.test(u)) return errorResponse("bot_username inválido", 400);
      if (u) updates.bot_username = u;
    }
    if (token) {
      if (!TOKEN_RE.test(token)) return errorResponse("bot_token inválido (formato esperado <digits>:<base62>)", 400);
      try { updates.bot_token_encrypted = await encryptVault(token); }
      catch (e) { return errorResponse(`Erro ao encriptar: ${(e as Error).message}`, 500); }
    }
    const { error } = await supabase.from("telegram_bots").update(updates).eq("id", body.id);
    if (error) return errorResponse(`Erro ao salvar: ${error.message}`, 500);
    return jsonResponse({ id: body.id });
  }

  // Insert: precisa token
  if (!token) return errorResponse("bot_token obrigatório", 400);
  if (!TOKEN_RE.test(token)) return errorResponse("bot_token inválido (formato esperado <digits>:<base62>)", 400);

  let bot_username = (body.bot_username ?? "").trim().replace(/^@/, "");
  let bot_name = (body.bot_name ?? "").trim();

  // Se faltam username/name, busca via getMe
  if (!bot_username || !bot_name) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(10_000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok && j.result) {
        if (!bot_username) bot_username = String(j.result.username ?? "");
        if (!bot_name) bot_name = String(j.result.first_name ?? j.result.username ?? "telegram-bot");
      } else {
        return errorResponse(`Token inválido: ${j.description ?? r.status}`, 400);
      }
    } catch (e) {
      return errorResponse(`Não foi possível validar token: ${(e as Error).message}`, 502);
    }
  }

  if (!bot_username || !USERNAME_RE.test(bot_username)) {
    return errorResponse("bot_username inválido após getMe", 400);
  }
  if (!bot_name) bot_name = bot_username;

  // Verifica duplicate por username
  const { data: existing } = await supabase
    .from("telegram_bots")
    .select("id, webhook_secret")
    .eq("bot_username", bot_username)
    .maybeSingle();

  let bot_token_encrypted: string;
  try { bot_token_encrypted = await encryptVault(token); }
  catch (e) { return errorResponse(`Erro ao encriptar: ${(e as Error).message}`, 500); }

  if (existing) {
    // Update no existing
    const { error } = await supabase
      .from("telegram_bots")
      .update({
        bot_name,
        bot_token_encrypted,
        receives_marcos_chat,
        active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) return errorResponse(`Erro ao salvar: ${error.message}`, 500);
    return jsonResponse({ id: existing.id });
  }

  const webhook_secret = randomHex(32);
  const { data, error } = await supabase
    .from("telegram_bots")
    .insert({
      bot_name,
      bot_username,
      bot_token_encrypted,
      webhook_secret,
      receives_marcos_chat,
      active,
    })
    .select("id")
    .single();
  if (error) return errorResponse(`Erro ao salvar: ${error.message}`, 500);
  return jsonResponse({ id: data.id, webhook_secret });
});
