/**
 * DELETE /whatsapp-instances-delete?id=...
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "DELETE") return errorResponse("Method not allowed", 405);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return errorResponse("id obrigatório (?id=...)", 400);

  const supabase = adminClient();
  const { error } = await supabase.from("whatsapp_instances").delete().eq("id", id);
  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ ok: true });
});
