/**
 * POST /reports-pipeline-projection
 * Solicita ao agente CFO na VPS uma projeção de pipeline (CRM).
 * Auth: JWT Supabase do dono.
 *
 * Body: { instance_id: string }
 * Retorna: { ok: true, data: <payload do crm_gateway.get_pipeline_projection> }
 */

import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return errorResponse("Authorization obrigatório", 401);

  const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) return errorResponse("Configuração incompleta", 500);

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    anonKey,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) return errorResponse("JWT inválido", 401);

  let body: { instance_id?: string };
  try { body = await req.json(); } catch { return errorResponse("Body inválido", 400); }
  if (!body.instance_id) return errorResponse("instance_id obrigatório", 400);

  const supabase = adminClient();
  const { data: instance } = await supabase
    .from("instances")
    .select("ingress_url, hooks_token")
    .eq("id", body.instance_id)
    .maybeSingle();

  if (!instance?.ingress_url || !instance?.hooks_token) {
    return errorResponse("Instância não configurada", 422);
  }

  const command = `Execute: python3 ~/.openclaw/workspace/skills/agente-cfo/scripts/crm_gateway.py get_pipeline_projection --json`;

  let resp: Response;
  let txt: string;
  try {
    resp = await fetch(`${instance.ingress_url}/hooks/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${instance.hooks_token}` },
      body: JSON.stringify({ message: command, name: "Reports", wakeMode: "now", deliver: false, timeoutSeconds: 60 }),
      signal: AbortSignal.timeout(45_000),
    });
    txt = await resp.text();
  } catch (err) {
    return errorResponse(`Falha ao contatar instância: ${String(err)}`, 502);
  }
  if (!resp.ok) return errorResponse(`Cliente retornou ${resp.status}: ${txt}`, 502);

  let parsed: unknown = null;
  try {
    const outer = JSON.parse(txt);
    const content = typeof outer === "string" ? outer : (outer?.content ?? outer?.response ?? outer?.message ?? outer);
    const str = typeof content === "string" ? content : JSON.stringify(content);
    const match = str.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : outer;
  } catch {
    parsed = { raw: txt };
  }

  return jsonResponse({ ok: true, data: parsed });
});
