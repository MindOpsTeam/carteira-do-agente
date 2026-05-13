/**
 * POST /whatsapp-instances-save
 * Body: { id?, instance_name, display_name, phone_number?, receives_marcos_chat, reset_status? }
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";

const NAME_RE = /^[a-z0-9_-]{2,40}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: {
    id?: string;
    instance_name?: string;
    display_name?: string | null;
    phone_number?: string | null;
    receives_marcos_chat?: boolean;
    reset_status?: boolean;
  };
  try { body = await req.json(); } catch { return errorResponse("Body inválido", 400); }

  const instance_name = (body.instance_name ?? "").trim().toLowerCase();
  if (!NAME_RE.test(instance_name)) {
    return errorResponse("instance_name inválido (use letras minúsculas, números, - ou _)", 400);
  }
  const display_name = body.display_name?.trim() || null;
  const phone_number = body.phone_number?.trim() || null;
  const receives_marcos_chat = !!body.receives_marcos_chat;

  const supabase = adminClient();

  if (body.id) {
    const updates: Record<string, unknown> = {
      display_name,
      receives_marcos_chat,
      updated_at: new Date().toISOString(),
    };
    if (body.reset_status) {
      updates.status = "pending";
      updates.qr_code_b64 = null;
    }
    const { data, error } = await supabase
      .from("whatsapp_instances")
      .update(updates)
      .eq("id", body.id)
      .select("id")
      .single();
    if (error) return errorResponse(error.message, 500);
    return jsonResponse({ id: data.id });
  }

  const { data: dup } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("instance_name", instance_name)
    .maybeSingle();
  if (dup) return errorResponse(`Já existe instância com nome "${instance_name}"`, 409);

  const { data, error } = await supabase
    .from("whatsapp_instances")
    .insert({
      instance_name,
      display_name,
      phone_number,
      receives_marcos_chat,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ id: data.id });
});
