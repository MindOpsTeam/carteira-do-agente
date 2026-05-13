/**
 * POST /chat-send-message
 * Envia mensagem do dono (painel web) para o agente Marcos via /hooks/agent.
 * Auth: JWT Supabase do dono logado.
 *
 * Body: { content: string }
 * Retorna: { message_id, run_id }
 */

import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Authorization header obrigatório", 401);
  }

  const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) return errorResponse("Configuração do painel incompleta", 500);

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    anonKey,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) return errorResponse("JWT inválido ou expirado", 401);

  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body JSON inválido", 400);
  }

  const content = (body.content ?? "").trim();
  if (!content) return errorResponse("content obrigatório", 400);
  if (content.length > 4000) return errorResponse("content muito longo", 400);

  const supabase = adminClient();
  const threadId = `panel:${user.id}`;

  // 1. Insere mensagem do user
  const { data: userMsg, error: userMsgErr } = await supabase
    .from("chat_messages")
    .insert({ thread_id: threadId, role: "user", content, status: "sent" })
    .select("id")
    .single();

  if (userMsgErr || !userMsg) {
    return errorResponse(`Falha ao salvar mensagem: ${userMsgErr?.message}`, 500);
  }

  // 2. Pega instância online (heartbeat fresco < 5min)
  const { data: instance } = await supabase
    .from("instances")
    .select("id, ingress_url, hooks_token, status, last_heartbeat")
    .not("ingress_url", "is", null)
    .not("hooks_token", "is", null)
    .order("last_heartbeat", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const lastHbMs = instance?.last_heartbeat ? new Date(instance.last_heartbeat).getTime() : 0;
  const isFresh = Date.now() - lastHbMs < 5 * 60 * 1000;

  if (!instance || !instance.ingress_url || !instance.hooks_token || !isFresh) {
    await supabase
      .from("chat_messages")
      .update({ status: "error", metadata: { error: "no_instance" } })
      .eq("id", userMsg.id);
    return errorResponse(
      "Marcos está offline — sua VPS não está conectada (sem heartbeat recente). Verifique em /settings.",
      503,
    );
  }

  // 2b. Busca contexto de MCPs/integrações ativas pra Marcos saber o que pode consultar
  const { data: supabaseProjects } = await supabase
    .from("supabase_projects")
    .select("name, project_url")
    .eq("active", true);
  const { data: integrationCreds } = await supabase
    .from("integration_credentials")
    .select("skill_name")
    .eq("active", true);

  const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const supaCtx = (supabaseProjects ?? []).map((p) =>
    `- supabase_${slugify(p.name)} (${p.name}): MCP server oficial Supabase em ${p.project_url}. Tools: execute_sql, list_tables, list_extensions, get_advisors, apply_migration, deploy_edge_function, get_logs, get_project_url, list_organizations, etc.`
  ).join("\n");
  const integCtx = (integrationCreds ?? []).map((c) => `- skill ${c.skill_name}: scripts em $HOME/.openclaw/workspace/skills/${c.skill_name}/`).join("\n");

  const contextBlock = (supaCtx || integCtx) ? `

CONTEXTO — FERRAMENTAS DISPONÍVEIS AGORA:
${supaCtx ? "\n[MCP servers Supabase conectados pelo dono — use essas tools pra responder perguntas sobre os bancos do dono]\n" + supaCtx : ""}${integCtx ? "\n[Integrações com credenciais ativas — use os scripts/clients locais]\n" + integCtx : ""}

` : "";

  // 3. Dispara o hook (com instruções pro Marcos responder via panel_reply.sh)
  let runId = `run_${Date.now()}_${userMsg.id}`;
  const promptMsg = `[PANEL_CHAT]
Usuário (painel web): ${content}

Você é Marcos, CFO virtual da empresa. Responda diretamente em português, claro e sem rodeios. Use as ferramentas disponíveis (bash, scripts da skill, MCP servers) se precisar consultar dados reais.
${contextBlock}
Quando o usuário perguntar sobre um banco/projeto Supabase específico (pelo nome), use as tools do MCP \`supabase_<slug>\` correspondente (não confunda com o banco do PAINEL CFO em odhcfrgydjluxunhvojp.supabase.co — esse é interno e você NÃO deve consultar a menos que seja explicitamente pedido).

IMPORTANTE — ao terminar, GRAVE sua resposta no painel executando:
  bash $HOME/.openclaw/workspace/skills/agente-cfo/scripts/panel_reply.sh "${threadId}" "${runId}" "<sua resposta aqui>" "sent"

Substitua <sua resposta aqui> pela mensagem final que quer mostrar ao usuário no chat (use aspas duplas e escape com \\" se houver aspas no texto). Não envie nada por WhatsApp — apenas o painel.`;

  try {
    const resp = await fetch(`${instance.ingress_url}/hooks/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${instance.hooks_token}`,
      },
      body: JSON.stringify({
        message: promptMsg,
        name: "panel_chat",
        wakeMode: "now",
        deliver: false,
        timeoutSeconds: 120,
        metadata: {
          thread_id: threadId,
          user_email: user.email,
          run_id: runId,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`hook ${resp.status}: ${text}`);
    }
    try {
      const json = await resp.json();
      if (json?.runId) runId = String(json.runId);
    } catch { /* corpo opcional */ }
  } catch (err) {
    await supabase
      .from("chat_messages")
      .update({ status: "error", metadata: { error: String(err) } })
      .eq("id", userMsg.id);
    return errorResponse(`Falha ao contatar Marcos: ${String(err)}`, 502);
  }

  // 4. Placeholder do Marcos (pending)
  const { data: marcosMsg } = await supabase
    .from("chat_messages")
    .insert({
      thread_id: threadId,
      role: "marcos",
      content: "",
      status: "pending",
      metadata: { runId },
    })
    .select("id")
    .single();

  return jsonResponse({
    message_id: userMsg.id,
    placeholder_id: marcosMsg?.id ?? null,
    run_id: runId,
  });
});
