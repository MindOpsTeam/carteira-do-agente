/**
 * GET /telegram-bots-vps-list
 * Auth: X-Panel-Token + X-Hooks-Token. Retorna bots com tokens descriptografados (pro daemon).
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse, validatePanelToken } from "../_shared/auth.ts";
import { decryptVault } from "../_shared/vault.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  if (!validatePanelToken(req)) return errorResponse("Invalid panel token", 401);
  const hooksToken = req.headers.get("X-Hooks-Token");
  if (!hooksToken) return errorResponse("X-Hooks-Token obrigatório", 401);

  const supabase = adminClient();
  const { data: instance, error: instErr } = await supabase
    .from("instances").select("id").eq("hooks_token", hooksToken).maybeSingle();
  if (instErr) return errorResponse(instErr.message, 500);
  if (!instance) return errorResponse("X-Hooks-Token inválido", 401);

  const { data, error } = await supabase
    .from("telegram_bots")
    .select("id, bot_name, bot_username, bot_token_encrypted, webhook_secret, active, receives_marcos_chat, last_test_at, last_test_status, created_at, updated_at");
  if (error) return errorResponse(error.message, 500);

  const out = await Promise.all(
    (data ?? []).map(async (b) => {
      let bot_token: string | null = null;
      try { bot_token = await decryptVault(b.bot_token_encrypted); } catch { /* ignore */ }
      return {
        id: b.id,
        bot_name: b.bot_name,
        bot_username: b.bot_username,
        bot_token,
        webhook_secret: b.webhook_secret,
        active: b.active,
        receives_marcos_chat: b.receives_marcos_chat,
        last_test_at: b.last_test_at,
        last_test_status: b.last_test_status,
        created_at: b.created_at,
        updated_at: b.updated_at,
      };
    }),
  );

  return jsonResponse(out);
});
