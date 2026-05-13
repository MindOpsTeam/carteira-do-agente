/**
 * POST /evolution-config-save
 * Body: { base_url, api_key?, active }
 * Encripta api_key (se fornecida; vazio mantém atual). Gera webhook_secret na primeira vez.
 * Retorna: { id, webhook_secret? } — webhook_secret só aparece se foi gerado agora.
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { encryptVault } from "../_shared/vault.ts";

const URL_RE = /^https?:\/\/[^\s]+$/i;

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: { base_url?: string; api_key?: string; active?: boolean };
  try { body = await req.json(); } catch { return errorResponse("Body inválido", 400); }

  const base_url = (body.base_url ?? "").trim().replace(/\/+$/, "");
  if (!URL_RE.test(base_url)) return errorResponse("base_url inválido (precisa http(s)://...)", 400);
  const apiKey = (body.api_key ?? "").trim();
  const active = body.active !== false;

  const supabase = adminClient();
  const { data: existing } = await supabase
    .from("evolution_config")
    .select("id, api_key_encrypted, webhook_secret")
    .limit(1)
    .maybeSingle();

  let api_key_encrypted = existing?.api_key_encrypted ?? null;
  if (apiKey) {
    try { api_key_encrypted = await encryptVault(apiKey); }
    catch (e) { return errorResponse(`Erro ao encriptar: ${(e as Error).message}`, 500); }
  }
  if (!api_key_encrypted) return errorResponse("api_key obrigatória na primeira vez", 400);

  let webhook_secret = existing?.webhook_secret;
  let generatedNow = false;
  if (!webhook_secret) {
    webhook_secret = randomHex(32);
    generatedNow = true;
  }

  const row = {
    base_url,
    api_key_encrypted,
    webhook_secret,
    active,
    updated_at: new Date().toISOString(),
  };

  let id: string;
  if (existing?.id) {
    const { data, error } = await supabase
      .from("evolution_config")
      .update(row)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) return errorResponse(`Erro ao salvar: ${error.message}`, 500);
    id = data.id;
  } else {
    const { data, error } = await supabase
      .from("evolution_config")
      .insert(row)
      .select("id")
      .single();
    if (error) return errorResponse(`Erro ao salvar: ${error.message}`, 500);
    id = data.id;
  }

  return jsonResponse({
    id,
    webhook_secret: generatedNow ? webhook_secret : undefined,
  });
});
