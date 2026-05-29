import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Eye, EyeOff, Copy, Loader2, Plus, RefreshCw, MessageCircle, Smartphone, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings_/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp — Agente CFO" }] }),
  component: WhatsAppPage,
});

type EvolutionConfig = {
  id: string;
  base_url: string;
  active: boolean;
  webhook_secret: string | null;
  last_test_status: string | null;
  last_test_at: string | null;
  last_test_detail: string | null;
};

type WhatsAppInstance = {
  id: string;
  instance_name: string;
  display_name: string | null;
  phone_number: string | null;
  status: string;
  receives_marcos_chat: boolean;
  last_seen: string | null;
};

type ChatMsg = {
  id: number;
  content: string;
  status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const INSTANCE_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function StatusPill({ status }: { status: string }) {
  if (status === "open") {
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-700 gap-1">
        <CheckCircle2 className="h-3 w-3" /> Conectado
      </Badge>
    );
  }
  if (status === "waiting_scan" || status === "connecting") {
    return <Badge variant="outline">Aguardando leitura</Badge>;
  }
  return <Badge variant="secondary">Desconectado</Badge>;
}

function WhatsAppPage() {
  // Evolution config
  const [cfg, setCfg] = useState<EvolutionConfig | null>(null);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [active, setActive] = useState(true);
  const [savingCfg, setSavingCfg] = useState(false);

  // Instâncias
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [instLoading, setInstLoading] = useState(true);

  // Pareamento
  const [pairOpen, setPairOpen] = useState(false);
  const [pairName, setPairName] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairQr, setPairQr] = useState<string | null>(null);
  const [pairText, setPairText] = useState<string | null>(null);
  const pendingRunIds = useRef<Map<string, "pair">>(new Map());

  async function loadCfg() {
    setCfgLoading(true);
    const { data } = await supabase
      .from("evolution_config")
      .select("id, base_url, active, webhook_secret, last_test_status, last_test_at, last_test_detail")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) {
      setCfg(data as EvolutionConfig);
      setBaseUrl(data.base_url ?? "");
      setActive(!!data.active);
    }
    setCfgLoading(false);
  }

  async function loadInstances() {
    setInstLoading(true);
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name, display_name, phone_number, status, receives_marcos_chat, last_seen")
      .order("created_at", { ascending: false });
    setInstances((data as WhatsAppInstance[]) ?? []);
    setInstLoading(false);
  }

  useEffect(() => { loadCfg(); loadInstances(); }, []);

  // Realtime admin thread (para QR de pareamento)
  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const threadId = `admin:${data.user.id}`;
      const channel = supabase
        .channel(`wa-admin:${data.user.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
          (p) => handleAdminMsg(p.new as ChatMsg),
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
          (p) => handleAdminMsg(p.new as ChatMsg),
        )
        .subscribe();
      unsub = () => { supabase.removeChannel(channel); };
    })();
    return () => { unsub?.(); };
  }, []);

  function handleAdminMsg(msg: ChatMsg) {
    if (msg.status !== "sent" || !msg.content) return;
    const meta = (msg.metadata ?? {}) as Record<string, unknown>;
    const runId = String(meta.runId ?? "");
    if (!pendingRunIds.current.has(runId)) return;
    pendingRunIds.current.delete(runId);

    // Tenta extrair qr_code_b64 ou qr_url do output
    let qr: string | null = null;
    try {
      const parsed = JSON.parse(msg.content);
      if (parsed?.qr_code_b64) qr = `data:image/png;base64,${parsed.qr_code_b64}`;
      else if (parsed?.qr_url) qr = parsed.qr_url;
    } catch {
      const m = msg.content.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/);
      if (m) qr = m[0];
    }
    if (qr) {
      setPairQr(qr);
      setPairText(null);
    } else {
      setPairText(msg.content);
    }
    setPairing(false);
    loadInstances();
    toast.success("Resposta recebida do agente");
  }

  async function saveCfg() {
    if (!baseUrl.trim()) { toast.error("base_url obrigatória"); return; }
    setSavingCfg(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sem sessão ativa");
      const body: Record<string, unknown> = { base_url: baseUrl.trim(), active };
      if (apiKey.trim()) body.api_key = apiKey.trim();
      const { data, error } = await supabase.functions.invoke("evolution-config-save", {
        body, headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      toast.success("Configuração salva");
      setApiKey("");
      await loadCfg();
      if ((data as { webhook_secret?: string })?.webhook_secret) {
        // já vai via loadCfg
      }
    } catch (err) {
      toast.error(`Falha: ${String((err as Error).message ?? err)}`);
    } finally {
      setSavingCfg(false);
    }
  }

  function copyText(s: string) {
    navigator.clipboard.writeText(s).then(
      () => toast.success("Copiado"),
      () => toast.error("Falha ao copiar"),
    );
  }

  async function toggleReceives(inst: WhatsAppInstance, value: boolean) {
    const { error } = await supabase
      .from("whatsapp_instances")
      .update({ receives_marcos_chat: value })
      .eq("id", inst.id);
    if (error) { toast.error(error.message); return; }
    setInstances((prev) => prev.map((i) => i.id === inst.id ? { ...i, receives_marcos_chat: value } : i));
  }

  async function startPair() {
    if (!INSTANCE_RE.test(pairName.trim())) {
      toast.error("Nome inválido (a-z, 0-9, _ ou -, até 64 chars)");
      return;
    }
    setPairing(true);
    setPairQr(null);
    setPairText(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sem sessão ativa");
      const { data, error } = await supabase.functions.invoke("vps-admin-action", {
        body: { action: "whatsapp_pair_new", params: { instance: pairName.trim() } },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      const runId = (data as { run_id?: string })?.run_id;
      if (!runId) throw new Error("Sem run_id");
      pendingRunIds.current.set(runId, "pair");
      toast.message("Pareamento iniciado", { description: "Aguardando QR..." });
      setTimeout(() => {
        if (pendingRunIds.current.has(runId)) {
          pendingRunIds.current.delete(runId);
          setPairing(false);
          toast.error("Timeout — agente não respondeu em 90s");
        }
      }, 90_000);
    } catch (err) {
      setPairing(false);
      toast.error(`Falha: ${String((err as Error).message ?? err)}`);
    }
  }

  const webhookUrl = `${SUPABASE_URL}/functions/v1/incoming-message`;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <MessageCircle className="h-6 w-6" /> WhatsApp
        </h1>
        <p className="text-sm text-muted-foreground">
          Conecte sua Evolution API e pareie números — Marcos atende pelo WhatsApp.
        </p>
      </div>

      {/* Config Evolution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolution API (global)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {cfgLoading ? <Skeleton className="h-32 w-full" /> : (
            <>
              <div className="grid gap-2">
                <Label>Evolution API URL</Label>
                <Input
                  placeholder="https://evolution.seudominio.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>API Key</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? "text" : "password"}
                      placeholder={cfg ? "•••••••• (mantém atual se vazio)" : "API key da Evolution"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={active} onCheckedChange={setActive} />
                <Label>Ativa</Label>
              </div>
              <Button onClick={saveCfg} disabled={savingCfg}>
                {savingCfg && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Salvar
              </Button>

              {cfg?.webhook_secret && (
                <div className="border rounded p-3 space-y-2 bg-muted/30">
                  <div className="text-xs font-semibold">Webhook (configure na Evolution)</div>
                  <div className="grid gap-1">
                    <Label className="text-xs">URL</Label>
                    <div className="flex gap-1">
                      <Input readOnly value={webhookUrl} className="text-xs font-mono" />
                      <Button size="icon" variant="outline" onClick={() => copyText(webhookUrl)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">Secret</Label>
                    <div className="flex gap-1">
                      <Input readOnly value={cfg.webhook_secret} className="text-xs font-mono" />
                      <Button size="icon" variant="outline" onClick={() => copyText(cfg.webhook_secret!)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Aponte o webhook da Evolution para a URL acima enviando
                    {" "}<code>channel: "whatsapp:&lt;instance&gt;"</code>,
                    {" "}<code>external_id</code>, <code>text</code> e <code>secret</code> com o valor acima.
                  </p>
                </div>
              )}

              {cfg?.last_test_at && (
                <div className="text-xs text-muted-foreground">
                  Último teste: <span className="font-medium">{cfg.last_test_status ?? "—"}</span>
                  {" "}— {formatRelative(cfg.last_test_at)}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Instâncias */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Números pareados
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={loadInstances}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => { setPairOpen(true); setPairQr(null); setPairText(null); setPairName(""); }}>
              <Plus className="h-4 w-4 mr-1" /> Parear novo número
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {instLoading ? <Skeleton className="h-24 w-full" /> : instances.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhuma instância pareada ainda.</div>
          ) : (
            <div className="space-y-2">
              {instances.map((inst) => (
                <div key={inst.id} className="flex items-center justify-between gap-3 border rounded p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{inst.display_name || inst.instance_name}</span>
                      <StatusPill status={inst.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {inst.phone_number ?? "sem número"} · {inst.instance_name}
                      {inst.last_seen && ` · visto ${formatRelative(inst.last_seen)}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Marcos chat</Label>
                    <Switch
                      checked={inst.receives_marcos_chat}
                      onCheckedChange={(v) => toggleReceives(inst, v)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog pareamento */}
      <Dialog open={pairOpen} onOpenChange={setPairOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Parear novo número</DialogTitle>
            <DialogDescription>
              Escolha um identificador para a instância (a-z, 0-9, _ ou -). Você escaneará o QR com o WhatsApp do número.
            </DialogDescription>
          </DialogHeader>

          {!pairQr && !pairText && (
            <div className="grid gap-2">
              <Label>Nome da instância</Label>
              <Input
                placeholder="ex: comercial-01"
                value={pairName}
                onChange={(e) => setPairName(e.target.value)}
                disabled={pairing}
              />
            </div>
          )}

          {pairQr && (
            <div className="flex flex-col items-center gap-3">
              <img src={pairQr} alt="QR code" className="h-64 w-64 object-contain border rounded" />
              <p className="text-xs text-muted-foreground text-center">
                Abra o WhatsApp → Aparelhos conectados → Conectar aparelho e escaneie o QR.
              </p>
            </div>
          )}

          {pairText && !pairQr && (
            <pre className="bg-muted rounded p-2 text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">
              {pairText}
            </pre>
          )}

          <DialogFooter>
            {!pairQr && !pairText ? (
              <Button onClick={startPair} disabled={pairing || !pairName.trim()}>
                {pairing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Solicitar QR
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setPairOpen(false)}>Fechar</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
