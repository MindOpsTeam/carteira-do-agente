/**
 * GET /evolution-config-vps
 * Auth: X-Panel-Token + X-Hooks-Token. Retorna config descriptografada para VPS.
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

  const { data: cfg, error } = await supabase
    .from("evolution_config")
    .select("base_url, api_key_encrypted, webhook_secret, active")
    .limit(1)
    .maybeSingle();
  if (error) return errorResponse(error.message, 500);
  if (!cfg) return jsonResponse(null);

  let api_key = "";
  try { api_key = await decryptVault(cfg.api_key_encrypted); }
  catch (e) { return errorResponse(`decrypt fail: ${(e as Error).message}`, 500); }

  return jsonResponse({
    base_url: cfg.base_url,
    api_key,
    webhook_secret: cfg.webhook_secret,
    active: !!cfg.active,
  });
});
