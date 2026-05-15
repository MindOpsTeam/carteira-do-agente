import { useEffect, useRef, useState } from "react";
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
import { Loader2, Plus, RefreshCw, Trash2, Copy, AlertTriangle, Send } from "lucide-react";
import { formatRelative } from "@/lib/format";
import type { TelegramBot, TelegramBotTestStatus } from "@/types/telegram";

const TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;

function statusDot(b: TelegramBot): string {
  if (!b.active) return "⚪";
  if (b.last_test_status === "ok") return "🟢";
  if (b.last_test_status === "invalid_token" || b.last_test_status === "unreachable") return "🔴";
  return "🟡";
}

function statusLabel(s: TelegramBotTestStatus, active: boolean): string {
  if (!active) return "Inativo";
  switch (s) {
    case "ok": return "Conectado";
    case "invalid_token": return "Token inválido";
    case "unreachable": return "Inacessível";
    case "unknown": return "Desconhecido";
    default: return "Não testado";
  }
}

export function TelegramCard() {
  const [bots, setBots] = useState<TelegramBot[] | null>(null);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [token, setToken] = useState("");
  const [receives, setReceives] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<{ url: string; secret: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TelegramBot | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  async function fetchBots() {
    const { data, error } = await supabase.functions.invoke("telegram-bots-list", {
      method: "GET",
    });
    if (error) {
      toast.error("Erro ao carregar bots", { description: error.message });
      setBots([]);
      return;
    }
    setBots((data as TelegramBot[]) ?? []);
  }

  useEffect(() => {
    fetchBots();
    const ch = supabase
      .channel("tg-bots")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "telegram_bots" },
        () => { fetchBots(); },
      )
      .subscribe();
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, []);

  function buildWebhookUrl(secret: string): string {
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-incoming-webhook?secret=${secret}`;
  }

  function maskedSecretUrl(secret: string): string {
    const masked = secret.length > 8 ? `${secret.slice(0, 4)}...${secret.slice(-4)}` : "***";
    return buildWebhookUrl(masked);
  }

  async function handleCreate() {
    const t = token.trim();
    if (!TOKEN_RE.test(t)) {
      toast.error("Token inválido", { description: "Formato esperado: <digits>:<base62> (vem do @BotFather)" });
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("telegram-bots-save", {
      method: "POST",
      body: {
        bot_token: t,
        receives_marcos_chat: receives,
        active: true,
      },
    });
    setCreating(false);
    if (error) {
      toast.error("Erro ao salvar", { description: error.message });
      return;
    }
    const result = data as { id: string; webhook_secret?: string };
    if (result.webhook_secret) {
      setRevealedSecret({
        url: buildWebhookUrl(result.webhook_secret),
        secret: result.webhook_secret,
      });
    }
    toast.success("Bot salvo — daemon vai registrar webhook em segundos");
    setDlgOpen(false);
    setToken("");
    setReceives(true);
    await fetchBots();
  }

  async function handleTest(bot: TelegramBot) {
    setTesting(bot.id);
    const { data, error } = await supabase.functions.invoke("telegram-bots-test", {
      method: "POST",
      body: { id: bot.id },
    });
    setTesting(null);
    if (error) {
      toast.error("Erro ao testar", { description: error.message });
      return;
    }
    const r = data as { status: string; detail?: string };
    if (r.status === "ok") toast.success("Bot OK", { description: r.detail });
    else if (r.status === "invalid_token") toast.error("Token inválido", { description: r.detail });
    else toast.error("Inacessível", { description: r.detail });
    await fetchBots();
  }

  async function handleToggleReceives(bot: TelegramBot, value: boolean) {
    const { error } = await supabase.functions.invoke("telegram-bots-save", {
      method: "POST",
      body: {
        id: bot.id,
        receives_marcos_chat: value,
        active: bot.active,
      },
    });
    if (error) {
      toast.error("Erro ao atualizar", { description: error.message });
      return;
    }
    await fetchBots();
  }

  async function handleDelete(bot: TelegramBot) {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) { toast.error("Sessão expirada"); return; }
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-bots-delete?id=${encodeURIComponent(bot.id)}`;
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
    toast.success("Bot removido");
    setConfirmDelete(null);
    await fetchBots();
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="h-4 w-4" />
              Telegram
            </CardTitle>
            <CardDescription>
              Conecte bots Telegram para conversar com o Marcos.
            </CardDescription>
          </div>
          <Button onClick={() => setDlgOpen(true)} size="sm">
            <Plus className="h-4 w-4" /> Novo bot
          </Button>
        </CardHeader>
        <CardContent>
          {bots === null ? (
            <Skeleton className="h-20 w-full" />
          ) : bots.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum bot. Clique em "Novo bot" para conectar o primeiro.
            </p>
          ) : (
            <div className="space-y-3">
              {bots.map((bot) => (
                <div key={bot.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-medium">
                        <span aria-hidden>{statusDot(bot)}</span>
                        <span className="truncate">{bot.bot_name || bot.bot_username}</span>
                        <Badge variant="secondary" className="text-xs">
                          @{bot.bot_username} · {statusLabel(bot.last_test_status, bot.active)}
                        </Badge>
                      </div>
                      {bot.last_test_at && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Testado {formatRelative(bot.last_test_at)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline" size="sm"
                        onClick={() => handleTest(bot)}
                        disabled={testing === bot.id}
                      >
                        {testing === bot.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Testar
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => setConfirmDelete(bot)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                    <Label htmlFor={`recv-${bot.id}`} className="text-sm cursor-pointer">
                      💬 Recebe chat do Marcos
                    </Label>
                    <Switch
                      id={`recv-${bot.id}`}
                      checked={bot.receives_marcos_chat}
                      onCheckedChange={(v) => handleToggleReceives(bot, v)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {revealedSecret && (
            <div className="mt-4 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 space-y-2">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-700" />
                <div className="space-y-1">
                  <p className="font-medium">Webhook configurado automaticamente</p>
                  <p className="text-xs text-muted-foreground">
                    O daemon na VPS vai registrar essa URL no Telegram. Anote o secret — não será exibido novamente.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-background px-2 py-1 text-xs font-mono break-all">
                  {maskedSecretUrl(revealedSecret.secret)}
                </code>
                <Button size="sm" variant="outline" onClick={() => copyToClipboard(revealedSecret.url, "URL completa")}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setRevealedSecret(null)}>
                Já anotei
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog: novo bot */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo bot Telegram</DialogTitle>
            <DialogDescription>
              Crie um bot no{" "}
              <a
                href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer"
                className="underline text-primary"
              >
                @BotFather
              </a>{" "}
              e cole o token aqui. Vamos validar e configurar o webhook automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="tg-token">Bot Token</Label>
              <Input
                id="tg-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:AAH..."
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Formato: <code className="font-mono">&lt;digits&gt;:&lt;base62&gt;</code>
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="tg-recv" className="cursor-pointer">
                Recebe chat do Marcos
              </Label>
              <Switch id="tg-recv" checked={receives} onCheckedChange={setReceives} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDlgOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin" />} Testar e salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover bot?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDelete?.bot_name}" (@{confirmDelete?.bot_username}) será removido. O daemon vai desregistrar o webhook.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDelete && handleDelete(confirmDelete)}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
