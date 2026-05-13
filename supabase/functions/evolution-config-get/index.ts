/**
 * GET /evolution-config-get → status + last_test (sem api_key, sem webhook_secret)
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const supabase = adminClient();
  const { data, error } = await supabase
    .from("evolution_config")
    .select("id, base_url, api_key_encrypted, active, last_test_at, last_test_status, last_test_detail")
    .limit(1)
    .maybeSingle();

  if (error) return errorResponse(error.message, 500);
  if (!data) {
    return jsonResponse({
      configured: false,
      base_url: "",
      has_api_key: false,
      active: false,
      last_test_at: null,
      last_test_status: null,
      last_test_detail: null,
    });
  }
  return jsonResponse({
    configured: true,
    base_url: data.base_url ?? "",
    has_api_key: !!data.api_key_encrypted,
    active: !!data.active,
    last_test_at: data.last_test_at,
    last_test_status: data.last_test_status,
    last_test_detail: data.last_test_detail,
  });
});
