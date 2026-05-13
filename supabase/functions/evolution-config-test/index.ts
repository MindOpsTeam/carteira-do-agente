/**
 * POST /evolution-config-test
 * Chama ${base_url}/instance/fetchInstances com header apikey.
 * Atualiza last_test_*.
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { decryptVault } from "../_shared/vault.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const supabase = adminClient();
  const { data: cfg, error } = await supabase
    .from("evolution_config")
    .select("id, base_url, api_key_encrypted")
    .limit(1)
    .maybeSingle();
  if (error) return errorResponse(error.message, 500);
  if (!cfg) return errorResponse("Evolution não configurada", 404);

  let apiKey: string;
  try { apiKey = await decryptVault(cfg.api_key_encrypted); }
  catch { return errorResponse("Falha ao descriptografar api_key", 500); }

  let status: "ok" | "invalid_key" | "unreachable" = "unreachable";
  let detail = "";
  try {
    const resp = await fetch(`${cfg.base_url.replace(/\/+$/, "")}/instance/fetchInstances`, {
      method: "GET",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) {
      status = "ok";
      try {
        const j = await resp.json();
        const count = Array.isArray(j) ? j.length : 0;
        detail = `${count} instância(s) na Evolution`;
      } catch { detail = "Conexão OK"; }
    } else if (resp.status === 401 || resp.status === 403) {
      status = "invalid_key";
      detail = `HTTP ${resp.status}`;
    } else {
      status = "unreachable";
      detail = `HTTP ${resp.status}`;
    }
  } catch (e) {
    status = "unreachable";
    detail = (e as Error).message;
  }

  await supabase
    .from("evolution_config")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_status: status,
      last_test_detail: detail,
    })
    .eq("id", cfg.id);

  return jsonResponse({ status, detail });
});
