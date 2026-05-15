import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, RotateCw, Loader2, Smartphone, CheckCircle2, XCircle,
  AlertTriangle, Power, MessageCircle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings_/whatsapp-baileys")({
  head: () => ({ meta: [{ title: "WhatsApp — Agente CFO" }] }),
  component: WhatsappBaileysPage,
});

type PairStatus = "idle" | "starting" | "qr_ready" | "scanning" | "connected" | "failed" | "unknown";

type StatusPayload = {
  status?: PairStatus;
  qr?: string | null;
  qr_text?: string | null;
  phone?: string | null;
  error?: string | null;
  message?: string | null;
};

type ChatMsg = {
  id: number;
  content: string;
  status: string | null;
  metadata: Record<string, unknown> | null;
};

const POLL_INTERVAL_MS = 2_000;
const QR_STALE_MS = 3 * 60 * 1000;

function parsePayload(content: string): StatusPayload {
  if (!content) return { status: "unknown" };
  const match = content.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : content.trim();
  try {
    return JSON.parse(raw) as StatusPayload;
  } catch {
    return { status: "failed", error: content.slice(0, 240) };
  }
}

function statusText(s: PairStatus): string {
  switch (s) {
    case "idle": return "Não pareado";
    case "starting": return "Iniciando…";
    case "qr_ready": return "Aguardando escaneamento";
    case "scanning": return "Detectado escaneamento…";
    case "connected": return "Conectado";
    case "failed": return "Falha no pareamento";
    default: return "Verificando…";
  }
}

function WhatsappBaileysPage() {
  const [status, setStatus] = useState<PairStatus>("unknown");
  const [phone, setPhone] = useState<string | null>(null);
  const [qrB64, setQrB64] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [firstLoad, setFirstLoad] = useState(true);
  const [qrSince, setQrSince] = useState<number | null>(null);

  const pendingRunIds = useRef<Map<string, "status" | "qr" | "start" | "cancel" | "disconnect">>(new Map());
  const pollTimer = useRef<number | null>(null);
  const previousStatus = useRef<PairStatus>("unknown");

  const invokeAction = useCallback(
    async (
      action: string,
      target: "status" | "qr" | "start" | "cancel" | "disconnect",
      params: Record<string, unknown> = {},
    ) => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast.error("Sem sessão ativa");
        return;
      }
      const { data, error } = await supabase.functions.invoke("vps-admin-action", {
        body: { action, params },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) {
        const msg = String((error as Error).message ?? error);
        if (msg.includes("503") || msg.toLowerCase().includes("offline")) {
          setErrorMsg("VPS offline — sem heartbeat recente. Verifique se o agente está rodando.");
        } else {
          toast.error(`Falha: ${msg}`);
        }
        setActionInFlight(null);
        return;
      }
      const runId = (data as { run_id?: string })?.run_id;
      if (!runId) {
        toast.error("Sem run_id na resposta");
        setActionInFlight(null);
        return;
      }
      pendingRunIds.current.set(runId, target);

      window.setTimeout(() => {
        if (pendingRunIds.current.has(runId)) {
          pendingRunIds.current.delete(runId);
          setActionInFlight((cur) => (cur === target ? null : cur));
          if (target === "status" && firstLoad) {
            setFirstLoad(false);
            setStatus("unknown");
            setErrorMsg("VPS não respondeu a tempo. Tente recarregar a página.");
          }
        }
      }, 90_000);
    },
    [firstLoad],
  );

  const schedulePoll = useCallback((s: PairStatus) => {
    if (pollTimer.current) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    if (s === "connected" || s === "failed" || s === "idle") return;
    pollTimer.current = window.setTimeout(() => {
      void invokeAction("whatsapp_pair_status", "status");
    }, POLL_INTERVAL_MS);
  }, [invokeAction]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user || !mounted) return;
      const threadId = `admin:${data.user.id}`;

      const channel = supabase
        .channel(`admin-baileys:${data.user.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
          (p) => handleAgentMessage(p.new as ChatMsg),
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
          (p) => handleAgentMessage(p.new as ChatMsg),
        )
        .subscribe();
      unsub = () => { supabase.removeChannel(channel); };

      setActionInFlight("status");
      await invokeAction("whatsapp_pair_status", "status");
    })();
    return () => {
      mounted = false;
      unsub?.();
      if (pollTimer.current) {
        window.clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAgentMessage(msg: ChatMsg) {
    if (msg.status !== "sent" || !msg.content) return;
    const meta = (msg.metadata ?? {}) as Record<string, unknown>;
    const runId = String(meta.runId ?? "");
    const target = pendingRunIds.current.get(runId);
    if (!target) return;
    pendingRunIds.current.delete(runId);
    setActionInFlight(null);
    setFirstLoad(false);

    const payload = parsePayload(msg.content);

    if (payload.error && /not installed|não instalado|@openclaw\/whatsapp|command not found/i.test(payload.error)) {
      setErrorMsg(
        "Plugin @openclaw/whatsapp não instalado. Atualize sua VPS rodando no terminal:\n" +
        "curl -fsSL https://raw.githubusercontent.com/MindOpsTeam/agente-cfo/main/skills/agente-cfo/scripts/self_update.sh | bash"
      );
      setStatus("failed");
      return;
    }

    if (payload.status) {
      const next = payload.status;
      const prev = previousStatus.current;
      previousStatus.current = next;
      setStatus(next);
      setErrorMsg(payload.error ?? null);

      if (payload.phone !== undefined) setPhone(payload.phone ?? null);
      if (payload.qr !== undefined && payload.qr) {
        setQrB64(payload.qr);
        if (!qrSince) setQrSince(Date.now());
      }

      if (next === "qr_ready" && !payload.qr && !qrB64) {
        setActionInFlight("qr");
        void invokeAction("whatsapp_pair_qr", "qr");
        return;
      }

      if (next !== "qr_ready") setQrSince(null);

      if (next === "connected" && prev !== "connected") {
        toast.success("✓ WhatsApp pareado!", { description: payload.phone ?? undefined });
      }
      if (next === "failed" && prev !== "failed") {
        toast.error(payload.error || "Falha ao parear WhatsApp");
      }

      schedulePoll(next);
    }
  }

  const startPairing = async () => {
    setErrorMsg(null);
    setQrB64(null);
    setQrSince(null);
    setActionInFlight("start");
    setStatus("starting");
    await invokeAction("whatsapp_pair_start", "start");
    schedulePoll("starting");
  };

  const cancelPairing = async () => {
    setActionInFlight("cancel");
    await invokeAction("whatsapp_pair_cancel", "cancel");
    setStatus("idle");
    setQrB64(null);
    setQrSince(null);
  };

  const refreshQr = async () => {
    setActionInFlight("start");
    await invokeAction("whatsapp_pair_cancel", "cancel");
    window.setTimeout(() => { void startPairing(); }, 500);
  };

  const disconnect = async () => {
    if (!confirm("Desconectar o WhatsApp pareado? Marcos vai parar de receber mensagens dessa linha.")) return;
    setActionInFlight("disconnect");
    await invokeAction("whatsapp_disconnect", "disconnect");
    setStatus("idle");
    setPhone(null);
    setQrB64(null);
  };

  const qrIsStale = qrSince !== null && Date.now() - qrSince > QR_STALE_MS;

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link to="/settings">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar pra Configurações
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conecte seu número pra conversar com Marcos.
        </p>
      </div>

      {errorMsg && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap font-sans break-words">{errorMsg}</pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6 pb-6 space-y-5">
          <div className="text-center text-sm text-muted-foreground">
            Status: <span className="font-medium text-foreground">{statusText(status)}</span>
          </div>

          {/* Visual area — single block per state */}
          <div className="flex items-center justify-center min-h-[280px]">
            {firstLoad ? (
              <Skeleton className="h-64 w-64" />
            ) : status === "connected" ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <CheckCircle2 className="h-20 w-20 text-green-500" />
                <div className="font-semibold text-lg">Conectado!</div>
                {phone && (
                  <div className="text-sm text-muted-foreground font-mono">{phone}</div>
                )}
              </div>
            ) : status === "qr_ready" && qrB64 ? (
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-lg border bg-background p-4 shadow-sm">
                  <img
                    src={`data:image/png;base64,${qrB64}`}
                    alt="QR Code WhatsApp"
                    className="w-64 h-64 block"
                  />
                </div>
                <div className="text-center text-xs text-muted-foreground max-w-xs">
                  Escaneie no celular: WhatsApp → ⋮ → Dispositivos conectados → Conectar dispositivo
                </div>
              </div>
            ) : status === "scanning" ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <div className="text-sm">📱 Detectado escaneamento…</div>
              </div>
            ) : status === "starting" || status === "qr_ready" ? (
              <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
                <Loader2 className="h-12 w-12 animate-spin" />
                <div className="text-sm">Gerando QR Code…</div>
              </div>
            ) : status === "failed" ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <XCircle className="h-20 w-20 text-destructive" />
                <div className="text-sm text-muted-foreground max-w-xs">
                  {errorMsg ? "Veja o erro acima." : "Algo deu errado. Tente novamente."}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-center">
                <MessageCircle className="h-20 w-20 text-muted-foreground/60" />
                <div className="text-sm text-muted-foreground">Não pareado</div>
              </div>
            )}
          </div>

          {/* Single contextual button */}
          <div className="flex justify-center">
            {firstLoad ? null : status === "connected" ? (
              <Button
                variant="destructive"
                onClick={disconnect}
                disabled={!!actionInFlight}
              >
                {actionInFlight === "disconnect"
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <Power className="h-4 w-4 mr-2" />}
                Desconectar
              </Button>
            ) : status === "qr_ready" || status === "starting" ? (
              <div className="flex gap-2">
                {qrIsStale && (
                  <Button variant="outline" onClick={refreshQr} disabled={!!actionInFlight}>
                    <RotateCw className="h-4 w-4 mr-2" />
                    Gerar novo QR
                  </Button>
                )}
                <Button variant="outline" onClick={cancelPairing} disabled={!!actionInFlight}>
                  {actionInFlight === "cancel"
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <XCircle className="h-4 w-4 mr-2" />}
                  Cancelar
                </Button>
              </div>
            ) : status === "scanning" ? null : status === "failed" ? (
              <Button onClick={startPairing} disabled={!!actionInFlight}>
                {actionInFlight === "start"
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <RotateCw className="h-4 w-4 mr-2" />}
                Tentar novamente
              </Button>
            ) : (
              <Button onClick={startPairing} disabled={!!actionInFlight} size="lg">
                {actionInFlight === "start"
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <Smartphone className="h-4 w-4 mr-2" />}
                Parear WhatsApp
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
