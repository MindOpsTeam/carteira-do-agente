/**
 * GET /whatsapp-instances-vps-list
 * Auth: X-Panel-Token + X-Hooks-Token. Retorna todas as instâncias para o daemon.
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse, validatePanelToken } from "../_shared/auth.ts";

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
    .from("whatsapp_instances")
    .select("id, instance_name, display_name, phone_number, status, qr_code_b64, receives_marcos_chat, last_seen, metadata, created_at, updated_at");
  if (error) return errorResponse(error.message, 500);
  return jsonResponse(data ?? []);
});
