import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  Trash2,
  Copy,
  AlertTriangle,
} from "lucide-react";
import { formatRelative } from "@/lib/format";
import type { EvolutionConfig, WhatsAppInstance, WhatsAppInstanceStatus } from "@/types/evolution";

export const Route = createFileRoute("/_authenticated/settings_/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp · Evolution API — Agente CFO" }] }),
  component: WhatsAppSettingsPage,
});

const URL_RE = /^https?:\/\/[^\s]+$/i;
const NAME_RE = /^[a-z0-9_-]{2,40}$/;

function statusDot(s: WhatsAppInstanceStatus): string {
  switch (s) {
    case "connected": return "🟢";
    case "qr_pending": return "🟡";
    case "pending": return "⚪";
    case "disconnected":
    case "error": return "🔴";
  }
}

function statusLabel(s: WhatsAppInstanceStatus): string {
  switch (s) {
    case "connected": return "Conectado";
    case "qr_pending": return "Aguardando QR";
    case "pending": return "Criando…";
    case "disconnected": return "Desconectado";
    case "error": return "Erro";
  }
}

function WhatsAppSettingsPage() {
  // ---- Evolution config
  const [cfg, setCfg] = useState<EvolutionConfig | null>(null);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [cfgActive, setCfgActive] = useState(true);
  const [savingCfg, setSavingCfg] = useState(false);
  const [testingCfg, setTestingCfg] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  // ---- Instances
  const [instances, setInstances] = useState<WhatsAppInstance[] | null>(null);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [newReceives, setNewReceives] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<WhatsAppInstance | null>(null);
  const [qrInstance, setQrInstance] = useState<WhatsAppInstance | null>(null);

  const evolutionConfigured = !!cfg?.configured && cfg.has_api_key;
  const webhookUrl = useMemo(() => {
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-incoming-webhook`;
  }, []);

  // ---- fetchers
  async function fetchCfg() {
    const { data, error } = await supabase.functions.invoke("evolution-config-get", {
      method: "GET",
    });
    if (error) {
      toast.error("Erro ao carregar config", { description: error.message });
      setCfg(null);
    } else {
      const c = data as EvolutionConfig;
      setCfg(c);
      if (c.base_url) setBaseUrl(c.base_url);
      setCfgActive(c.active);
    }
    setCfgLoading(false);
  }

  async function fetchInstances() {
    const { data, error } = await supabase.functions.invoke("whatsapp-instances-list", {
      method: "GET",
    });
    if (error) {
      toast.error("Erro ao carregar instâncias", { description: error.message });
      setInstances([]);
      return;
    }
    setInstances((data as WhatsAppInstance[]) ?? []);
  }

  useEffect(() => {
    fetchCfg();
    fetchInstances();
  }, []);

  // Realtime: assina mudanças em whatsapp_instances
  useEffect(() => {
    const ch = supabase
      .channel("wa-instances")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_instances" },
        () => { fetchInstances(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // QR auto-refresh enquanto modal aberto
  const qrIdRef = useRef<string | null>(null);
  useEffect(() => {
    qrIdRef.current = qrInstance?.id ?? null;
    if (!qrInstance) return;
    const t = setInterval(() => {
      if (qrIdRef.current) fetchInstances();
    }, 3000);
    return () => clearInterval(t);
  }, [qrInstance]);

  // Atualiza qrInstance com dados frescos quando lista muda
  useEffect(() => {
    if (!qrInstance || !instances) return;
    const fresh = instances.find((i) => i.id === qrInstance.id);
    if (!fresh) { setQrInstance(null); return; }
    if (fresh.status === "connected") {
      toast.success(`${fresh.display_name ?? fresh.instance_name} conectado!`);
      setQrInstance(null);
      return;
    }
    if (fresh.qr_code_b64 !== qrInstance.qr_code_b64 || fresh.status !== qrInstance.status) {
      setQrInstance(fresh);
    }
  }, [instances]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- handlers
  async function handleSaveCfg() {
    if (!URL_RE.test(baseUrl.trim())) {
      toast.error("Base URL inválida", { description: "Ex: https://evolution.exemplo.com" });
      return;
    }
    if (!cfg?.has_api_key && !apiKey.trim()) {
      toast.error("API key obrigatória na primeira vez");
      return;
    }
    setSavingCfg(true);
    const { data, error } = await supabase.functions.invoke("evolution-config-save", {
      method: "POST",
      body: {
        base_url: baseUrl.trim(),
        api_key: apiKey.trim() || undefined,
        active: cfgActive,
      },
    });
    setSavingCfg(false);
    if (error) {
      toast.error("Erro ao salvar", { description: error.message });
      return;
    }
    const result = data as { id: string; webhook_secret?: string };
    if (result.webhook_secret) {
      setRevealedSecret(result.webhook_secret);
    }
    setApiKey("");
    toast.success("Config salva");
    await fetchCfg();
  }

  async function handleTestCfg() {
    setTestingCfg(true);
    const { data, error } = await supabase.functions.invoke("evolution-config-test", {
      method: "POST",
      body: {},
    });
    setTestingCfg(false);
    if (error) {
      toast.error("Erro ao testar", { description: error.message });
      await fetchCfg();
      return;
    }
    const r = data as { status: string; detail?: string };
    if (r.status === "ok") toast.success("Conexão OK", { description: r.detail });
    else if (r.status === "invalid_key") toast.error("Key inválida", { description: r.detail });
    else toast.error("Inacessível", { description: r.detail });
    await fetchCfg();
  }

  async function handleCreateInstance() {
    const name = newName.trim().toLowerCase();
    if (!NAME_RE.test(name)) {
      toast.error("Nome interno inválido", {
        description: "Use 2–40 caracteres: letras minúsculas, números, - ou _",
      });
      return;
    }
    setCreating(true);
    const { error } = await supabase.functions.invoke("whatsapp-instances-save", {
      method: "POST",
      body: {
        instance_name: name,
        display_name: newDisplay.trim() || null,
        receives_marcos_chat: newReceives,
      },
    });
    setCreating(false);
    if (error) {
      toast.error("Erro ao criar", { description: error.message });
      return;
    }
    toast.success("Instância criada — daemon vai configurar em segundos");
    setDlgOpen(false);
    setNewName("");
    setNewDisplay("");
    setNewReceives(false);
    await fetchInstances();
  }

  async function handleToggleReceives(inst: WhatsAppInstance, value: boolean) {
    const { error } = await supabase.functions.invoke("whatsapp-instances-save", {
      method: "POST",
      body: {
        id: inst.id,
        instance_name: inst.instance_name,
        display_name: inst.display_name,
        receives_marcos_chat: value,
      },
    });
    if (error) {
      toast.error("Erro ao atualizar", { description: error.message });
      return;
    }
    await fetchInstances();
  }

  async function handleReconnect(inst: WhatsAppInstance) {
    const { error } = await supabase.functions.invoke("whatsapp-instances-save", {
      method: "POST",
      body: {
        id: inst.id,
        instance_name: inst.instance_name,
        display_name: inst.display_name,
        receives_marcos_chat: inst.receives_marcos_chat,
        reset_status: true,
      },
    });
    if (error) {
      toast.error("Erro ao reconectar", { description: error.message });
      return;
    }
    toast.success("Reconexão pedida — aguarde QR");
    await fetchInstances();
  }

  async function handleDeleteInstance(inst: WhatsAppInstance) {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) { toast.error("Sessão expirada"); return; }
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-instances-delete?id=${encodeURIComponent(inst.id)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      },
    });
    if (!res.ok) {
      const t = await res.text();
      toast.error("Erro ao remover", { description: t });
      return;
    }
    toast.success("Instância removida");
    setConfirmDelete(null);
    await fetchInstances();
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/settings"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp · Evolution API</h1>
        <p className="text-sm text-muted-foreground">
          Conecte seu servidor Evolution e gerencie múltiplas linhas de WhatsApp para conversar com o Marcos.
        </p>
      </div>

      {/* Card 1: Configuração Evolution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Servidor Evolution API</CardTitle>
          <CardDescription>
            Configure o endpoint e a API key do seu servidor Evolution open-source.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {cfgLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ev-url">Base URL</Label>
                <Input
                  id="ev-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://evolution.exemplo.com"
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ev-key">
                    API Key {cfg?.has_api_key && <span className="text-xs text-muted-foreground">(salva — deixe vazia pra manter)</span>}
                  </Label>
                  <Button
                    type="button" variant="ghost" size="sm" className="h-7 px-2"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {showKey ? "Esconder" : "Mostrar"}
                  </Button>
                </div>
                <Input
                  id="ev-key"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={cfg?.has_api_key ? "••••••••" : "sua API key da Evolution"}
                  className="font-mono text-sm"
                />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="ev-active">Ativar Evolution</Label>
                  <p className="text-xs text-muted-foreground">
                    Quando ativa, o daemon na VPS sincroniza instâncias e processa mensagens.
                  </p>
                </div>
                <Switch id="ev-active" checked={cfgActive} onCheckedChange={setCfgActive} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handleSaveCfg} disabled={savingCfg}>
                  {savingCfg && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
                </Button>
                <Button
                  variant="outline" onClick={handleTestCfg}
                  disabled={testingCfg || !cfg?.has_api_key}
                >
                  {testingCfg && <Loader2 className="h-4 w-4 animate-spin" />} Testar conexão
                </Button>

                {cfg?.last_test_status === "ok" && (
                  <Badge className="bg-green-600 hover:bg-green-700">
                    ✓ Conectado · {cfg.last_test_at ? formatRelative(cfg.last_test_at) : "—"}
                  </Badge>
                )}
                {(cfg?.last_test_status === "invalid_key" || cfg?.last_test_status === "unreachable") && (
                  <Badge variant="destructive">⚠ {cfg.last_test_detail ?? cfg.last_test_status}</Badge>
                )}
                {cfg?.has_api_key && !cfg.last_test_status && (
                  <Badge variant="secondary">Não testado ainda</Badge>
                )}
                {!cfg?.has_api_key && <Badge variant="secondary">Não configurado</Badge>}
              </div>
            </>
          )}

          {revealedSecret && (
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 space-y-2">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-700" />
                <div className="space-y-1">
                  <p className="font-medium">Webhook secret gerado — anote agora</p>
                  <p className="text-xs text-muted-foreground">
                    Usado pelo daemon para validar webhooks da Evolution. Não será exibido novamente.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-background px-2 py-1 text-xs font-mono break-all">
                  {revealedSecret}
                </code>
                <Button size="sm" variant="outline" onClick={() => copyToClipboard(revealedSecret, "Secret")}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Webhook URL: <code className="font-mono">{webhookUrl}</code>
                <Button size="sm" variant="ghost" className="ml-1 h-6 px-2"
                  onClick={() => copyToClipboard(webhookUrl, "URL")}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setRevealedSecret(null)}>
                Já anotei
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Card 2: Instâncias */}
      {evolutionConfigured ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Instâncias WhatsApp</CardTitle>
              <CardDescription>
                Cada instância é uma linha de WhatsApp pareada via QR.
              </CardDescription>
            </div>
            <Button onClick={() => setDlgOpen(true)} size="sm">
              <Plus className="h-4 w-4" /> Adicionar instância
            </Button>
          </CardHeader>
          <CardContent>
            {instances === null ? (
              <Skeleton className="h-24 w-full" />
            ) : instances.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma instância. Clique em "Adicionar" para criar a primeira.
              </p>
            ) : (
              <div className="space-y-3">
                {instances.map((inst) => (
                  <div key={inst.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-medium">
                          <span aria-hidden>{statusDot(inst.status)}</span>
                          <span className="truncate">{inst.display_name ?? inst.instance_name}</span>
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {inst.instance_name}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {inst.phone_number ?? "ainda não pareado"} · {statusLabel(inst.status)}
                          {inst.last_seen && <> · visto {formatRelative(inst.last_seen)}</>}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        {inst.status !== "connected" && (
                          <Button size="sm" variant="outline" onClick={() => setQrInstance(inst)}>
                            <QrCode className="h-3.5 w-3.5" /> QR
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => handleReconnect(inst)}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmDelete(inst)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                      <div className="text-xs">
                        <div className="font-medium">Receber chat do Marcos</div>
                        <div className="text-muted-foreground">
                          Mensagens entrantes nesta linha viram conversas com o Marcos.
                        </div>
                      </div>
                      <Switch
                        checked={inst.receives_marcos_chat}
                        onCheckedChange={(v) => handleToggleReceives(inst, v)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Configure a Evolution API acima para gerenciar instâncias WhatsApp.
          </CardContent>
        </Card>
      )}

      {/* Dialog: nova instância */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar instância WhatsApp</DialogTitle>
            <DialogDescription>
              Após criar, abra "QR" e escaneie no WhatsApp do celular para parear.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ni-name">Nome interno (slug)</Label>
              <Input
                id="ni-name" value={newName}
                onChange={(e) => setNewName(e.target.value.toLowerCase())}
                placeholder="principal"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Apenas letras minúsculas, números, - ou _. Único, não muda depois.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ni-display">Nome de exibição</Label>
              <Input
                id="ni-display" value={newDisplay}
                onChange={(e) => setNewDisplay(e.target.value)}
                placeholder="Ex: Principal, Vendas, Suporte"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="ni-recv">Receber mensagens do Marcos</Label>
                <p className="text-xs text-muted-foreground">
                  Quando ativo, mensagens recebidas nessa linha acionam o agente.
                </p>
              </div>
              <Switch id="ni-recv" checked={newReceives} onCheckedChange={setNewReceives} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlgOpen(false)} disabled={creating}>
              Cancelar
            </Button>
            <Button onClick={handleCreateInstance} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin" />} Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: QR */}
      <Dialog open={!!qrInstance} onOpenChange={(open) => !open && setQrInstance(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              QR Code · {qrInstance?.display_name ?? qrInstance?.instance_name}
            </DialogTitle>
            <DialogDescription>
              No WhatsApp do celular: ⋮ → Dispositivos conectados → Conectar dispositivo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {qrInstance?.qr_code_b64 ? (
              <img
                src={qrInstance.qr_code_b64.startsWith("data:")
                  ? qrInstance.qr_code_b64
                  : `data:image/png;base64,${qrInstance.qr_code_b64}`}
                alt="QR Code WhatsApp"
                className="h-64 w-64 rounded-md border bg-white"
              />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center rounded-md border bg-muted/30">
                <div className="text-center text-sm text-muted-foreground">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin mb-2" />
                  Aguardando QR do daemon…
                </div>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              Status: {qrInstance ? statusLabel(qrInstance.status) : "—"} · atualiza automaticamente
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover instância?</AlertDialogTitle>
            <AlertDialogDescription>
              Remover "{confirmDelete?.display_name ?? confirmDelete?.instance_name}"? O número
              será desvinculado do painel mas continua no WhatsApp do celular.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handleDeleteInstance(confirmDelete)}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
