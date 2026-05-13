/**
 * POST /whatsapp-incoming-webhook
 * Auth: header X-Webhook-Secret == evolution_config.webhook_secret
 * Recebe payload da Evolution API. Para mensagens entrantes em instâncias com
 * receives_marcos_chat=true, salva chat_messages e dispara /hooks/agent.
 */
import { adminClient, corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as Record<string, unknown>;
  if (typeof m.conversation === "string") return m.conversation;
  if (m.extendedTextMessage && typeof (m.extendedTextMessage as Record<string, unknown>).text === "string") {
    return (m.extendedTextMessage as Record<string, string>).text;
  }
  if (m.imageMessage && typeof (m.imageMessage as Record<string, unknown>).caption === "string") {
    return `[imagem] ${(m.imageMessage as Record<string, string>).caption}`;
  }
  if (m.audioMessage) return "[áudio]";
  if (m.videoMessage) return "[vídeo]";
  if (m.documentMessage) return "[documento]";
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const supabase = adminClient();
  const { data: cfg } = await supabase
    .from("evolution_config")
    .select("webhook_secret, active")
    .limit(1)
    .maybeSingle();
  if (!cfg) return errorResponse("Evolution não configurada", 404);
  if (!cfg.active) return jsonResponse({ ok: true, ignored: "inactive" });

  const provided = req.headers.get("X-Webhook-Secret") ?? req.headers.get("apikey");
  if (!provided || provided !== cfg.webhook_secret) {
    return errorResponse("Invalid webhook secret", 401);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("Body inválido", 400); }

  const event = String(body.event ?? "");
  if (event !== "messages.upsert") return jsonResponse({ ok: true, ignored: event });

  const instanceName = String(body.instance ?? "");
  const data = (body.data ?? {}) as Record<string, unknown>;
  const key = (data.key ?? {}) as Record<string, unknown>;
  const fromMe = !!key.fromMe;
  const remoteJid = String(key.remoteJid ?? "");
  if (fromMe || !remoteJid || !instanceName) return jsonResponse({ ok: true, ignored: "skip" });

  const phone = remoteJid.split("@")[0];
  const text = extractText(data.message);
  if (!text.trim()) return jsonResponse({ ok: true, ignored: "no_text" });

  const { data: waInstance } = await supabase
    .from("whatsapp_instances")
    .select("id, instance_name, display_name, receives_marcos_chat")
    .eq("instance_name", instanceName)
    .maybeSingle();
  if (!waInstance) return jsonResponse({ ok: true, ignored: "unknown_instance" });
  if (!waInstance.receives_marcos_chat) {
    return jsonResponse({ ok: true, ignored: "instance_not_subscribed" });
  }

  const threadId = `wa:${instanceName}:${phone}`;

  const { data: userMsg, error: userMsgErr } = await supabase
    .from("chat_messages")
    .insert({ thread_id: threadId, role: "user", content: text, status: "sent" })
    .select("id")
    .single();
  if (userMsgErr || !userMsg) return errorResponse(userMsgErr?.message ?? "insert fail", 500);

  // Pega instância VPS online
  const { data: vps } = await supabase
    .from("instances")
    .select("id, ingress_url, hooks_token")
    .not("ingress_url", "is", null)
    .not("hooks_token", "is", null)
    .order("last_heartbeat", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!vps?.ingress_url || !vps?.hooks_token) {
    await supabase.from("chat_messages")
      .update({ status: "error", metadata: { error: "no_vps_instance" } })
      .eq("id", userMsg.id);
    return jsonResponse({ ok: true, warn: "no_vps" });
  }

  const runId = `wa_${Date.now()}_${userMsg.id}`;
  const promptMsg = `[WHATSAPP_CHAT]
Instância: ${instanceName} (${waInstance.display_name ?? "—"})
Telefone: ${phone}
Mensagem: ${text}

Você é Marcos, CFO virtual. Responda em português, claro e sem rodeios. Use ferramentas (bash, scripts) se precisar consultar dados reais.

IMPORTANTE — ao terminar, ENVIE sua resposta pelo WhatsApp executando:
  bash $HOME/.openclaw/workspace/skills/evolution-api/scripts/send_evolution.sh "${instanceName}" "${phone}" "<sua resposta aqui>"

Substitua <sua resposta aqui> pela mensagem final (use aspas duplas e escape com \\" se houver aspas no texto). Não responda no painel — apenas no WhatsApp.

Também grave a resposta no painel para histórico:
  bash $HOME/.openclaw/workspace/skills/agente-cfo/scripts/panel_reply.sh "${threadId}" "${runId}" "<sua resposta aqui>" "sent"`;

  // Insere placeholder Marcos
  const { data: marcosMsg } = await supabase
    .from("chat_messages")
    .insert({
      thread_id: threadId,
      role: "marcos",
      content: "",
      status: "pending",
      metadata: { runId, instance: instanceName, phone },
    })
    .select("id")
    .single();

  // Dispara hook (fire-and-forget; não bloqueia Evolution)
  fetch(`${vps.ingress_url}/hooks/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${vps.hooks_token}`,
    },
    body: JSON.stringify({
      message: promptMsg,
      name: "wa_chat",
      wakeMode: "now",
      deliver: false,
      timeoutSeconds: 180,
      metadata: { thread_id: threadId, run_id: runId, instance: instanceName, phone },
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
