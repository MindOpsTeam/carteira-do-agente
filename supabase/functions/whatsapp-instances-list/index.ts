/**
 * GET /whatsapp-instances-list → array sem dados sensíveis
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const supabase = adminClient();
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .select("id, instance_name, display_name, phone_number, status, qr_code_b64, receives_marcos_chat, last_seen, created_at")
    .order("created_at", { ascending: true });
  if (error) return errorResponse(error.message, 500);
  return jsonResponse(data ?? []);
});
