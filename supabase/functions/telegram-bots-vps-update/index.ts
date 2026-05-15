/**
 * POST /telegram-bots-vps-update
 * Auth: X-Panel-Token + X-Hooks-Token.
 * Body: [{ id, last_test_status, last_test_detail }]
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse, validatePanelToken } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  if (!validatePanelToken(req)) return errorResponse("Invalid panel token", 401);
  const hooksToken = req.headers.get("X-Hooks-Token");
  if (!hooksToken) return errorResponse("X-Hooks-Token obrigatório", 401);

  const supabase = adminClient();
  const { data: instance } = await supabase
    .from("instances").select("id").eq("hooks_token", hooksToken).maybeSingle();
  if (!instance) return errorResponse("X-Hooks-Token inválido", 401);

  let body: Array<{ id?: string; last_test_status?: string; last_test_detail?: string }>;
  try { body = await req.json(); } catch { return errorResponse("Body inválido", 400); }
  if (!Array.isArray(body)) return errorResponse("Body deve ser array", 400);

  const now = new Date().toISOString();
  let updated = 0;
  for (const row of body) {
    if (!row.id) continue;
    const { error } = await supabase
      .from("telegram_bots")
      .update({
        last_test_status: row.last_test_status ?? null,
        last_test_detail: row.last_test_detail?.slice(0, 500) ?? null,
        last_test_at: now,
        updated_at: now,
      })
      .eq("id", row.id);
    if (!error) updated++;
  }
  return jsonResponse({ ok: true, updated });
});
