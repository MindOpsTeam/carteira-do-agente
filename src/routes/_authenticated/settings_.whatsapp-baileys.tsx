import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, RotateCw, Loader2, Smartphone, CheckCircle2, XCircle,
  AlertTriangle, Power,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings_/whatsapp-baileys")({
  head: () => ({ meta: [{ title: "WhatsApp (Baileys) — Agente CFO" }] }),
  component: WhatsappBaileysPage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PairStatus = "idle" | "starting" | "qr_ready" | "scanning" | "connected" | "failed" | "unknown";

type StatusPayload = {
  status?: PairStatus;
  qr?: string | null;        // base64 PNG (sem prefixo data:)
  qr_text?: string | null;   // alternativa ASCII
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

const POLL_INTERVAL: Record<PairStatus, number | null> = {
  idle: null,
  starting: 2_000,
  qr_ready: 2_500,
  scanning: 1_500,
  connected: null,
  failed: null,
  unknown: 3_000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parsePayload(content: string): StatusPayload {
  if (!content) return { status: "unknown" };
  // Try JSON anywhere in the content (agent often wraps with prose)
  const match = content.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : content.trim();
  try {
    const j = JSON.parse(raw);
    return j as StatusPayload;
  } catch {
    // Not JSON → treat as error message
    return { status: "failed", error: content.slice(0, 240) };
  }
}

function statusLabel(s: PairStatus): { label: string; color: string; icon: React.ReactNode } {
  switch (s) {
    case "idle":
      return { label: "Aguardando início", color: "bg-muted text-muted-foreground", icon: <Power className="h-3 w-3" /> };
    case "starting":
      return { label: "Iniciando…", color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400", icon: <Loader2 className="h-3 w-3 animate-spin" /> };
    case "qr_ready":
      return { label: "Aguardando escaneamento", color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400", icon: <Smartphone className="h-3 w-3" /> };
    case "scanning":
      return { label: "Pareando…", color: "bg-blue-500/20 text-blue-700 dark:text-blue-400", icon: <Loader2 className="h-3 w-3 animate-spin" /> };
    case "connected":
      return { label: "Conectado", color: "bg-green-500/20 text-green-700 dark:text-green-400", icon: <CheckCircle2 className="h-3 w-3" /> };
    case "failed":
      return { label: "Falha", color: "bg-red-500/20 text-red-700 dark:text-red-400", icon: <XCircle className="h-3 w-3" /> };
    default:
      return { label: "Desconhecido", color: "bg-muted text-muted-foreground", icon: <AlertTriangle className="h-3 w-3" /> };
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function WhatsappBaileysPage() {
  const [status, setStatus] = useState<PairStatus>("unknown");
  const [phone, setPhone] = useState<string | null>(null);
  const [qrB64, setQrB64] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [firstLoad, setFirstLoad] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const pendingRunIds = useRef<Map<string, "status" | "qr" | "start" | "cancel" | "disconnect">>(new Map());
  const pollTimer = useRef<number | null>(null);
  const previousStatus = useRef<PairStatus>("unknown");

  // ----- low-level: invoke action -----
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
          setErrorMsg("VPS offline — sem heartbeat recente");
        }
        toast.error(`Falha: ${msg}`);
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

      // Safety timeout for this single call (90s)
      window.setTimeout(() => {
        if (pendingRunIds.current.has(runId)) {
          pendingRunIds.current.delete(runId);
          setActionInFlight((cur) => (cur === target ? null : cur));
        }
      }, 90_000);
    },
    [],
  );

  // ----- realtime listener for admin thread -----
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

      // Kick off first status poll
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

  // ----- handler when agent replies -----
  function handleAgentMessage(msg: ChatMsg) {
    if (msg.status !== "sent" || !msg.content) return;
    const meta = (msg.metadata ?? {}) as Record<string, unknown>;
    const runId = String(meta.runId ?? "");
    const target = pendingRunIds.current.get(runId);
    if (!target) return;
    pendingRunIds.current.delete(runId);
    setActionInFlight(null);
    setFirstLoad(false);
    setLastUpdated(Date.now());

    const payload = parsePayload(msg.content);

    // Detect "plugin não instalado" type errors
    if (payload.error && /not installed|não instalado|@openclaw\/whatsapp/i.test(payload.error)) {
      setErrorMsg("Plugin @openclaw/whatsapp não instalado — atualize sua VPS (Sistema → Plugins → instalar `@openclaw/whatsapp`).");
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
      if (payload.qr !== undefined) setQrB64(payload.qr ?? null);

      if (target === "qr" && payload.qr) {
        // QR explicitly fetched — already saved above
      }

      // If we just learned status is qr_ready but didn't get the QR, fetch it
      if (next === "qr_ready" && !payload.qr) {
        setActionInFlight("qr");
        void invokeAction("whatsapp_pair_qr", "qr");
      }

      // Connection success toast (transition into connected)
      if (next === "connected" && prev !== "connected") {
        toast.success("✓ WhatsApp pareado!", {
          description: payload.phone ?? undefined,
        });
      }
      if (next === "failed" && prev !== "failed") {
        toast.error(payload.error || "Falha ao parear WhatsApp");
      }

      // schedule next poll based on the new status
      schedulePoll(next);
    }
  }

  // ----- adaptive polling -----
  const schedulePoll = useCallback((s: PairStatus) => {
    if (pollTimer.current) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    const delay = POLL_INTERVAL[s];
    if (delay == null) return;
    pollTimer.current = window.setTimeout(() => {
      void invokeAction("whatsapp_pair_status", "status");
    }, delay);
  }, [invokeAction]);

  // ----- user actions -----
  const startPairing = async () => {
    setErrorMsg(null);
    setQrB64(null);
    setActionInFlight("start");
    setStatus("starting");
    await invokeAction("whatsapp_pair_start", "start");
  };

  const refreshQr = async () => {
    setErrorMsg(null);
    setQrB64(null);
    setActionInFlight("start");
    await invokeAction("whatsapp_pair_cancel", "cancel");
    // small grace, then restart
    window.setTimeout(() => { void startPairing(); }, 500);
  };

  const cancelPairing = async () => {
    setActionInFlight("cancel");
    await invokeAction("whatsapp_pair_cancel", "cancel");
    setStatus("idle");
    setQrB64(null);
  };

  const disconnect = async () => {
    if (!confirm("Desconectar o WhatsApp pareado? Marcos vai parar de receber mensagens dessa linha.")) return;
    setActionInFlight("disconnect");
    await invokeAction("whatsapp_disconnect", "disconnect");
    setStatus("idle");
    setPhone(null);
    setQrB64(null);
  };

  const stat = statusLabel(status);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
          <Link to="/settings">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar pra Configurações
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Smartphone className="h-6 w-6" />
          WhatsApp (modo Baileys nativo)
          <Badge variant="secondary" className="text-xs">recomendado</Badge>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conecte seu WhatsApp pessoal — Marcos vai responder lá. Sem servidor extra,
          via plugin nativo do OpenClaw.
        </p>
      </div>

      {errorMsg && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex gap-3 pt-6 text-sm">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>{errorMsg}</div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Pareamento</span>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-normal px-2 py-1 rounded-full ${stat.color}`}
            >
              {stat.icon}
              {stat.label}
            </span>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* CONNECTED state */}
          {status === "connected" && (
            <div className="flex flex-col items-center text-center py-6 gap-3">
              <CheckCircle2 className="h-14 w-14 text-green-500" />
              <div className="space-y-1">
                <div className="font-semibold text-lg">WhatsApp conectado</div>
                {phone && (
                  <div className="text-sm text-muted-foreground">
                    Número: <span className="font-mono text-foreground">{phone}</span>
                  </div>
                )}
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={disconnect}
                disabled={!!actionInFlight}
              >
                {actionInFlight === "disconnect" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Power className="h-4 w-4 mr-2" />
                )}
                Desconectar
              </Button>
            </div>
          )}

          {/* IDLE / FAILED / UNKNOWN — show start button */}
          {(status === "idle" || status === "failed" || status === "unknown") && !firstLoad && (
            <div className="flex flex-col items-center text-center py-6 gap-3">
              <Smartphone className="h-12 w-12 text-muted-foreground" />
              <div className="text-sm text-muted-foreground max-w-md">
                Clique abaixo pra gerar o QR Code. Você terá ~60 segundos pra escanear
                pelo seu WhatsApp.
              </div>
              <Button onClick={startPairing} disabled={!!actionInFlight}>
                {actionInFlight === "start" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Smartphone className="h-4 w-4 mr-2" />
                )}
                Iniciar pareamento
              </Button>
            </div>
          )}

          {/* FIRST LOAD skeleton */}
          {firstLoad && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Skeleton className="h-64 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          )}

          {/* QR_READY / SCANNING / STARTING — show QR area */}
          {(status === "qr_ready" || status === "scanning" || status === "starting") && !firstLoad && (
            <div className="flex flex-col items-center gap-4 py-3">
              <div className="rounded-lg border bg-background p-4 shadow-sm">
                {qrB64 ? (
                  <img
                    src={`data:image/png;base64,${qrB64}`}
                    alt="QR Code WhatsApp"
                    className="w-64 h-64 block"
                  />
                ) : (
                  <div className="w-64 h-64 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <div className="text-xs">
                      {status === "scanning" ? "Pareando…" : "Gerando QR…"}
                    </div>
                  </div>
                )}
              </div>

              <div className="text-center text-sm text-muted-foreground max-w-md space-y-1">
                <div className="font-medium text-foreground">
                  📱 Escaneie pelo seu WhatsApp:
                </div>
                <div>
                  WhatsApp → <span className="font-mono">⋮</span> → Dispositivos
                  conectados → Conectar dispositivo
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshQr}
                  disabled={!!actionInFlight}
                >
                  {actionInFlight === "start" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCw className="h-4 w-4 mr-2" />
                  )}
                  Gerar novo QR
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancelPairing}
                  disabled={!!actionInFlight}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          <div className="text-[11px] text-muted-foreground text-center">
            {lastUpdated && (
              <span>
                Última atualização:{" "}
                {new Date(lastUpdated).toLocaleTimeString("pt-BR")}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-muted bg-muted/20">
        <CardContent className="pt-6 text-xs text-muted-foreground space-y-2">
          <div>
            <strong className="text-foreground">Como funciona:</strong> o plugin
            <code className="mx-1 px-1 bg-muted rounded">@openclaw/whatsapp</code>
            roda direto na sua VPS e mantém a sessão Baileys (mesma tecnologia do
            WhatsApp Web). Não precisa de servidor Evolution separado.
          </div>
          <div>
            Precisa de várias linhas? Use a{" "}
            <Link to="/settings/whatsapp" className="underline">
              Evolution API
            </Link>
            .
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
