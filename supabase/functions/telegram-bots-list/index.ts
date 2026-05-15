/**
 * GET /telegram-bots-list → array sem token
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const supabase = adminClient();
  const { data, error } = await supabase
    .from("telegram_bots")
    .select("id, bot_name, bot_username, active, receives_marcos_chat, last_test_at, last_test_status, last_test_detail, created_at")
    .order("created_at", { ascending: true });
  if (error) return errorResponse(error.message, 500);
  return jsonResponse(data ?? []);
});
