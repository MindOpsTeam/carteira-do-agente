/**
 * POST /incoming-message
 * Ponto único de entrada pra mensagens externas (WhatsApp, Telegram).
 * Auth: secret específico do canal validado contra DB. verify_jwt=false.
 *
 * Body:
 * {
 *   channel: "whatsapp:<instance>" | "telegram:<bot_username>",
 *   external_id: "<phone | chat_id>",
 *   text: "<msg user>",
 *   secret: "<webhook_secret>"
 * }
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";

type Body = {
  channel?: string;
  external_id?: string;
  text?: string;
  secret?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: Body;
  try { body = await req.json(); } catch { return errorResponse("Body inválido", 400); }

  const channel = String(body.channel ?? "").trim();
  const externalId = String(body.external_id ?? "").trim();
  const text = String(body.text ?? "").trim();
  const secret = String(body.secret ?? "");

  if (!channel || !externalId || !text || !secret) {
    return errorResponse("channel, external_id, text e secret são obrigatórios", 400);
  }
  if (text.length > 4000) return errorResponse("text muito longo", 400);

  const supabase = adminClient();

  // 1. Identifica + valida secret por canal
  let channelLabel = "";
  if (channel.startsWith("whatsapp:")) {
    const instanceName = channel.slice("whatsapp:".length);
    if (!instanceName) return errorResponse("instance vazio", 400);
    const { data: cfg } = await supabase
      .from("evolution_config")
      .select("webhook_secret, active")
      .limit(1)
      .maybeSingle();
    if (!cfg || !cfg.active) return errorResponse("Evolution não configurada/ativa", 404);
    if (cfg.webhook_secret !== secret) return errorResponse("Invalid secret", 401);

    const { data: wa } = await supabase
      .from("whatsapp_instances")
      .select("display_name, receives_marcos_chat")
      .eq("instance_name", instanceName)
      .maybeSingle();
    if (!wa) return jsonResponse({ ok: true, ignored: "unknown_instance" });
    if (!wa.receives_marcos_chat) return jsonResponse({ ok: true, ignored: "not_subscribed" });
    channelLabel = `WhatsApp ${instanceName}${wa.display_name ? ` (${wa.display_name})` : ""}`;
  } else if (channel.startsWith("telegram:")) {
    const botUsername = channel.slice("telegram:".length);
    if (!botUsername) return errorResponse("bot_username vazio", 400);
    const { data: bot } = await supabase
      .from("telegram_bots")
      .select("webhook_secret, active, receives_marcos_chat, bot_name")
      .eq("bot_username", botUsername)
      .maybeSingle();
    if (!bot || !bot.active) return errorResponse("Bot Telegram não configurado/ativo", 404);
    if (bot.webhook_secret !== secret) return errorResponse("Invalid secret", 401);
    if (!bot.receives_marcos_chat) return jsonResponse({ ok: true, ignored: "not_subscribed" });
    channelLabel = `Telegram @${botUsername}${bot.bot_name ? ` (${bot.bot_name})` : ""}`;
  } else {
    return errorResponse(`Canal não suportado: ${channel}`, 400);
  }

  const threadId = `${channel}:${externalId}`;

  // 2. Insere user msg
  const { data: userMsg, error: userMsgErr } = await supabase
    .from("chat_messages")
    .insert({
      thread_id: threadId,
      role: "user",
      content: text,
      status: "sent",
      channel,
    })
    .select("id")
    .single();
  if (userMsgErr || !userMsg) return errorResponse(userMsgErr?.message ?? "insert fail", 500);

  // 3. Pega VPS online
  const { data: vps } = await supabase
    .from("instances")
    .select("id, ingress_url, hooks_token, last_heartbeat")
    .not("ingress_url", "is", null)
    .not("hooks_token", "is", null)
    .order("last_heartbeat", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const lastHbMs = vps?.last_heartbeat ? new Date(vps.last_heartbeat).getTime() : 0;
  const isFresh = Date.now() - lastHbMs < 5 * 60 * 1000;

  if (!vps?.ingress_url || !vps?.hooks_token || !isFresh) {
    await supabase.from("chat_messages")
      .update({ status: "error", metadata: { error: "no_vps_instance" } })
      .eq("id", userMsg.id);
    return jsonResponse({ ok: true, warn: "no_vps" });
  }

  // 4. Contexto MCPs/integrações (igual chat-send-message)
  const { data: supabaseProjects } = await supabase
    .from("supabase_projects").select("name, project_url").eq("active", true);
  const { data: integrationCreds } = await supabase
    .from("integration_credentials").select("skill_name").eq("active", true);

  const slugify = (s: string) => s.toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const supaCtx = (supabaseProjects ?? []).map((p) =>
    `- supabase_${slugify(p.name)} (${p.name}): MCP server em ${p.project_url}.`
  ).join("\n");
  const integCtx = (integrationCreds ?? []).map((c) =>
    `- skill ${c.skill_name}: scripts em $HOME/.openclaw/workspace/skills/${c.skill_name}/`
  ).join("\n");
  const contextBlock = (supaCtx || integCtx)
    ? `\n\nCONTEXTO — FERRAMENTAS:\n${supaCtx}\n${integCtx}\n`
    : "";

  const runId = `inc_${Date.now()}_${userMsg.id}`;

  // Sem injeção de system prompt — Marcos persona vive no skill agente-cfo na VPS.

  const promptMsg = `[INCOMING_MESSAGE]
Canal: ${channelLabel}
Phone/Chat: ${externalId}
Usuário: ${text}
${contextBlock}
IMPORTANTE — ao terminar, responda via:
  bash $HOME/.openclaw/workspace/skills/agente-cfo/scripts/panel_post_reply.sh "${channel}" "${externalId}" "${threadId}" "${runId}" "<sua resposta>"

Substitua <sua resposta> pelo texto final (use aspas duplas, escape com \\" se houver aspas).`;

  // 5. Placeholder Marcos
  const { data: marcosMsg } = await supabase
    .from("chat_messages")
    .insert({
      thread_id: threadId,
      role: "marcos",
      content: "",
      status: "pending",
      channel,
      metadata: { runId, channel, external_id: externalId },
    })
    .select("id")
    .single();

  // 6. Dispara hook (fire-and-forget)
  fetch(`${vps.ingress_url}/hooks/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${vps.hooks_token}`,
    },
    body: JSON.stringify({
      message: promptMsg,
      name: "incoming_message",
      wakeMode: "now",
      deliver: false,
      timeoutSeconds: 180,
      metadata: { thread_id: threadId, run_id: runId, channel, external_id: externalId },
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch(async (err) => {
    console.error("hook dispatch failed:", err);
    await supabase.from("chat_messages")
      .update({ status: "error", metadata: { error: String(err) } })
      .eq("id", marcosMsg?.id ?? userMsg.id);
  });

  return jsonResponse({ ok: true, message_id: userMsg.id, run_id: runId });
});
