/**
 * POST /whatsapp-instances-vps-update
 * Auth: X-Panel-Token + X-Hooks-Token.
 * Body: [{ id, status?, qr_code_b64?, last_seen?, phone_number? }]
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse, validatePanelToken } from "../_shared/auth.ts";

const VALID_STATUS = new Set(["pending", "qr_pending", "connected", "disconnected", "error"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  if (!validatePanelToken(req)) return errorResponse("Invalid panel token", 401);
  const hooksToken = req.headers.get("X-Hooks-Token");
  if (!hooksToken) return errorResponse("X-Hooks-Token obrigatório", 401);

  const supabase = adminClient();
  const { data: instance, error: instErr } = await supabase
    .from("instances").select("id").eq("hooks_token", hooksToken).maybeSingle();
  if (instErr) return errorResponse(instErr.message, 500);
  if (!instance) return errorResponse("X-Hooks-Token inválido", 401);

  let body: Array<{
    id?: string;
    status?: string;
    qr_code_b64?: string | null;
    last_seen?: string | null;
    phone_number?: string | null;
  }>;
  try { body = await req.json(); } catch { return errorResponse("Body inválido", 400); }
  if (!Array.isArray(body)) return errorResponse("Body deve ser array", 400);

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const u of body) {
    if (!u.id) { results.push({ id: "?", ok: false, error: "id ausente" }); continue; }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (u.status !== undefined) {
      if (!VALID_STATUS.has(u.status)) {
        results.push({ id: u.id, ok: false, error: `status inválido: ${u.status}` });
        continue;
      }
      updates.status = u.status;
    }
    if (u.qr_code_b64 !== undefined) updates.qr_code_b64 = u.qr_code_b64;
    if (u.last_seen !== undefined) updates.last_seen = u.last_seen;
    if (u.phone_number !== undefined) updates.phone_number = u.phone_number;

    const { error } = await supabase.from("whatsapp_instances").update(updates).eq("id", u.id);
    results.push({ id: u.id, ok: !error, error: error?.message });
  }
  return jsonResponse({ results });
});
