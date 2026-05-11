import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowUp, ArrowDown, X, Plus, Save, Play, FlaskConical,
  AlertTriangle, CheckCircle2, Clock, XCircle, Trash2, Lock, ShieldAlert,
} from "lucide-react";
import { formatRelative } from "@/lib/format";
import {
  type Automation, type AutomationAction, type AutomationActionType,
  type AutomationCondition, type AutomationRun, type AutomationTrigger,
  ACTION_LABELS, isRiskyAction,
} from "@/types/automations";

export const Route = createFileRoute("/_authenticated/automations/$id")({
  head: () => ({ meta: [{ title: "Editar automação — Agente CFO" }] }),
  component: AutomationEditorPage,
});

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return {
    Authorization: `Bearer ${data.session?.access_token ?? ""}`,
    apikey: SUPABASE_ANON,
    "Content-Type": "application/json",
  };
}

const ACTION_TYPES: AutomationActionType[] = [
  "send_report", "send_whatsapp", "crm_update_deal", "crm_create_task",
  "erp_create_invoice", "cobranca_send", "ask_owner_confirm", "ai_decide",
];

const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: "Toda segunda às 09:00", expr: "0 9 * * 1" },
  { label: "Todo dia às 08:00", expr: "0 8 * * *" },
  { label: "Todo dia às 10:00", expr: "0 10 * * *" },
  { label: "Todo dia às 18:00", expr: "0 18 * * *" },
  { label: "Toda sexta às 17:00", expr: "0 17 * * 5" },
  { label: "Todo dia 1 às 09:00", expr: "0 9 1 * *" },
];

const METRICS = [
  { value: "balance_brl", label: "Saldo em caixa" },
  { value: "receivables_30d_brl", label: "A receber 30d" },
  { value: "payables_30d_brl", label: "A pagar 30d" },
  { value: "pipeline_weighted_brl", label: "Pipeline ponderado" },
  { value: "overdue_total_brl", label: "Inadimplência total" },
];

function defaultActionFor(type: AutomationActionType): AutomationAction {
  switch (type) {
    case "send_report": return { type, report_type: "cash", deliver_to: "owner" };
    case "send_whatsapp": return { type, to: "owner", template: "" };
    case "crm_update_deal": return { type, deal_id: "{{trigger.deal_id}}", fields: {} };
    case "crm_create_task": return { type, title: "", due_date: "", related_to: "" };
    case "erp_create_invoice": return { type, customer: "", items: [], due_date: "" };
    case "cobranca_send": return { type, customer_id: "", amount: 0, due_date: "" };
    case "ask_owner_confirm": return { type, question: "Posso seguir?" };
    case "ai_decide": return { type, context: "", options: [] };
  }
}

function isCronValid(expr: string): boolean {
  return expr.trim().split(/\s+/).length === 5;
}

async function fetchOne(id: string): Promise<Automation | null> {
  const { data, error } = await supabase.from("automations").select("*").eq("id", id).single();
  if (error || !data) return null;
  return (data as unknown) as Automation;
}

async function fetchRuns(id: string): Promise<AutomationRun[]> {
  const { data } = await supabase
    .from("automation_runs")
    .select("*")
    .eq("automation_id", id)
    .order("started_at", { ascending: false })
    .limit(30);
  return ((data ?? []) as unknown) as AutomationRun[];
}

function statusIcon(status: AutomationRun["status"]) {
  if (status === "succeeded") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === "failed" || status === "expired") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "pending_confirm") return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  if (status === "cancelled") return <XCircle className="h-4 w-4 text-muted-foreground" />;
  return <Clock className="h-4 w-4 text-sky-400" />;
}

function AutomationEditorPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data: loaded, refetch } = useQuery({
    queryKey: ["automation", id],
    queryFn: () => fetchOne(id),
  });
  const { data: runs = [], refetch: refetchRuns } = useQuery({
    queryKey: ["automation-runs", id],
    queryFn: () => fetchRuns(id),
    refetchInterval: 10000,
  });

  const [draft, setDraft] = useState<Automation | null>(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<Array<Record<string, unknown>> | null>(null);

  useEffect(() => { if (loaded) setDraft(structuredClone(loaded)); }, [loaded]);

  // Realtime: automation_runs
  useEffect(() => {
    const ch = supabase
      .channel(`auto-runs-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "automation_runs", filter: `automation_id=eq.${id}` },
        () => refetchRuns(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, refetchRuns]);

  if (!draft) {
    return (
      <div className="container max-w-6xl py-8">
        <Link to="/automations" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Automações
        </Link>
        <p className="mt-6 text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  const d: Automation = draft;
  const update = (patch: Partial<Automation>) => setDraft({ ...d, ...patch });
  const updateTrigger = (t: AutomationTrigger) => update({ trigger: t });

  const addAction = (type: AutomationActionType) => {
    update({ actions: [...d.actions, defaultActionFor(type)] });
  };
  const moveAction = (idx: number, dir: -1 | 1) => {
    const next = [...d.actions];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    update({ actions: next });
  };
  const removeAction = (idx: number) => {
    update({ actions: d.actions.filter((_, i) => i !== idx) });
  };
  const patchAction = (idx: number, patch: Partial<AutomationAction>) => {
    const next = d.actions.map((a, i) => (i === idx ? ({ ...a, ...patch } as AutomationAction) : a));
    update({ actions: next });
  };

  const addCondition = () => update({
    conditions: [...d.conditions, { field: "", op: "eq", value: "" } as AutomationCondition],
  });
  const patchCondition = (idx: number, patch: Partial<AutomationCondition>) => {
    update({ conditions: d.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)) });
  };
  const removeCondition = (idx: number) => {
    update({ conditions: d.conditions.filter((_, i) => i !== idx) });
  };

  async function save() {
    if (d.actions.length === 0) {
      toast.error("Adicione pelo menos uma ação");
      return;
    }
    if (d.trigger.type === "cron" && !isCronValid(d.trigger.expression)) {
      toast.error("Expressão cron deve ter 5 campos");
      return;
    }
    setSaving(true);
    const payload = {
      id: d.id,
      name: d.name,
      description: d.description,
      trigger: d.trigger,
      conditions: d.conditions,
      actions: d.actions,
      active: d.active,
      require_confirmation: d.require_confirmation,
      template_key: d.template_key,
    };
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/automations-save`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success("Salvo");
    } catch {
      const { error } = await supabase
        .from("automations")
        .update({
          name: d.name,
          description: d.description,
          trigger: d.trigger as never,
          conditions: d.conditions as never,
          actions: d.actions as never,
          active: d.active,
          require_confirmation: d.require_confirmation,
        })
        .eq("id", d.id);
      if (error) toast.error("Falha ao salvar");
      else toast.success("Salvo (modo offline)");
    } finally {
      setSaving(false);
      refetch();
    }
  }

  async function runNow() {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/automations-run-now`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ automation_id: d.id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success("Disparado");
      refetchRuns();
    } catch {
      toast.error("Backend de execução indisponível");
    }
  }

  async function test() {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/automations-test`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ actions: d.actions, trigger_payload: {} }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setTestResult(json.steps ?? []);
      toast.success("Preview gerado");
    } catch {
      toast.error("Backend de teste indisponível");
    }
  }

  async function deleteIt() {
    if (!confirm("Excluir esta automação?")) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/automations-delete?id=${d.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      await supabase.from("automations").delete().eq("id", d.id);
    }
    toast.success("Excluído");
    navigate({ to: "/automations" });
  }

  return (
    <div className="container max-w-7xl py-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Link to="/automations" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Automações
        </Link>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={deleteIt} className="text-destructive hover:text-destructive gap-1.5">
            <Trash2 className="h-4 w-4" /> Excluir
          </Button>
          <Button variant="outline" size="sm" onClick={test} className="gap-1.5">
            <FlaskConical className="h-4 w-4" /> Testar
          </Button>
          <Button variant="outline" size="sm" onClick={runNow} className="gap-1.5">
            <Play className="h-4 w-4" /> Executar agora
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
            <Save className="h-4 w-4" /> {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="builder" className="lg:hidden">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="builder">Builder</TabsTrigger>
          <TabsTrigger value="log">Histórico ({runs.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="builder">
          <BuilderColumn
            draft={d}
            update={update}
            updateTrigger={updateTrigger}
            addAction={addAction}
            moveAction={moveAction}
            removeAction={removeAction}
            patchAction={patchAction}
            addCondition={addCondition}
            patchCondition={patchCondition}
            removeCondition={removeCondition}
            testResult={testResult}
          />
        </TabsContent>
        <TabsContent value="log">
          <RunsColumn runs={runs} />
        </TabsContent>
      </Tabs>

      <div className="hidden lg:grid grid-cols-[1fr_360px] gap-6">
        <BuilderColumn
          draft={d}
          update={update}
          updateTrigger={updateTrigger}
          addAction={addAction}
          moveAction={moveAction}
          removeAction={removeAction}
          patchAction={patchAction}
          addCondition={addCondition}
          patchCondition={patchCondition}
          removeCondition={removeCondition}
          testResult={testResult}
        />
        <RunsColumn runs={runs} />
      </div>
    </div>
  );
}

type BuilderProps = {
  draft: Automation;
  update: (p: Partial<Automation>) => void;
  updateTrigger: (t: AutomationTrigger) => void;
  addAction: (t: AutomationActionType) => void;
  moveAction: (i: number, d: -1 | 1) => void;
  removeAction: (i: number) => void;
  patchAction: (i: number, p: Partial<AutomationAction>) => void;
  addCondition: () => void;
  patchCondition: (i: number, p: Partial<AutomationCondition>) => void;
  removeCondition: (i: number) => void;
  testResult: Array<Record<string, unknown>> | null;
};

function BuilderColumn(p: BuilderProps) {
  const { draft, update, updateTrigger, addAction, moveAction, removeAction, patchAction,
    addCondition, patchCondition, removeCondition, testResult } = p;
  const [actionPickerOpen, setActionPickerOpen] = useState(false);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <Input
            value={d.name}
            onChange={(e) => update({ name: e.target.value })}
            className="text-lg font-semibold border-0 px-0 shadow-none focus-visible:ring-0"
            placeholder="Nome da automação"
          />
          <Textarea
            value={d.description ?? ""}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Descrição (opcional)"
            rows={2}
            className="border-0 px-0 shadow-none focus-visible:ring-0 resize-none"
          />
          <div className="flex items-center gap-6 pt-2 border-t">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={d.active} onCheckedChange={(v) => update({ active: v })} />
              Ativa
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={d.require_confirmation}
                onCheckedChange={(v) => update({ require_confirmation: v })}
              />
              Exigir minha confirmação
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Trigger</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            {(["cron", "metric", "manual"] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={d.trigger.type === t ? "default" : "outline"}
                onClick={() => {
                  if (t === "cron") updateTrigger({ type: "cron", expression: "0 9 * * 1" });
                  else if (t === "metric") updateTrigger({ type: "metric", metric: "balance_brl", operator: "lt", value: 50000 });
                  else updateTrigger({ type: "manual" });
                }}
              >
                {t}
              </Button>
            ))}
          </div>

          {d.trigger.type === "cron" && (
            <div className="space-y-2">
              <Label className="text-xs">Quando</Label>
              <Select
                value={CRON_PRESETS.find((p) => p.expr === d.trigger.expression)?.expr ?? ""}
                onValueChange={(v) => updateTrigger({ ...d.trigger as { type: "cron"; expression: string }, expression: v })}
              >
                <SelectTrigger><SelectValue placeholder="Escolha um preset" /></SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map((cp) => (
                    <SelectItem key={cp.expr} value={cp.expr}>{cp.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div>
                <Label className="text-xs text-muted-foreground">Cron avançado</Label>
                <Input
                  value={d.trigger.expression}
                  onChange={(e) => updateTrigger({ type: "cron", expression: e.target.value })}
                  className="font-mono"
                />
                {!isCronValid(d.trigger.expression) && (
                  <p className="text-xs text-destructive mt-1">Cron deve ter 5 campos</p>
                )}
              </div>
            </div>
          )}

          {d.trigger.type === "metric" && (
            <div className="grid grid-cols-3 gap-2">
              <Select value={d.trigger.metric} onValueChange={(v) => updateTrigger({ ...d.trigger as never, metric: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={d.trigger.operator} onValueChange={(v) => updateTrigger({ ...d.trigger as never, operator: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["lt", "lte", "eq", "gte", "gt"] as const).map((op) => (
                    <SelectItem key={op} value={op}>{op}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                value={d.trigger.value}
                onChange={(e) => updateTrigger({ ...d.trigger as never, value: Number(e.target.value) })}
                className="font-mono tabular-nums"
              />
            </div>
          )}

          {d.trigger.type === "manual" && (
            <p className="text-xs text-muted-foreground">Executada apenas via "Executar agora" ou pelo Marcos no chat.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Condições</CardTitle>
          <Button size="sm" variant="ghost" onClick={addCondition} className="h-7 gap-1">
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {d.conditions.length === 0 && (
            <p className="text-xs text-muted-foreground">Sem condições — todos os triggers passam.</p>
          )}
          {d.conditions.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_100px_1fr_auto] gap-2">
              <Input
                placeholder="campo (ex: amount_brl)"
                value={c.field}
                onChange={(e) => patchCondition(i, { field: e.target.value })}
                className="font-mono text-sm"
              />
              <Select value={c.op} onValueChange={(v) => patchCondition(i, { op: v as AutomationCondition["op"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"] as const).map((op) => (
                    <SelectItem key={op} value={op}>{op}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="valor"
                value={String(c.value ?? "")}
                onChange={(e) => patchCondition(i, { value: e.target.value })}
                className="font-mono text-sm"
              />
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => removeCondition(i)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Ações (em sequência)</CardTitle>
          <Popover open={actionPickerOpen} onOpenChange={setActionPickerOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 gap-1">
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-72" align="end">
              <Command>
                <CommandInput placeholder="/ tipo da ação…" />
                <CommandList>
                  <CommandEmpty>Nada encontrado</CommandEmpty>
                  <CommandGroup>
                    {ACTION_TYPES.map((t) => (
                      <CommandItem
                        key={t}
                        onSelect={() => { addAction(t); setActionPickerOpen(false); }}
                      >
                        <span className="font-mono text-xs">{t}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{ACTION_LABELS[t]}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </CardHeader>
        <CardContent className="space-y-3">
          {d.actions.length === 0 && (
            <p className="text-xs text-muted-foreground">Adicione ao menos uma ação para salvar.</p>
          )}
          {d.actions.map((a, i) => (
            <ActionCard
              key={i}
              idx={i}
              total={d.actions.length}
              action={a}
              forceConfirm={d.require_confirmation}
              onMove={moveAction}
              onRemove={removeAction}
              onPatch={patchAction}
            />
          ))}
        </CardContent>
      </Card>

      {testResult && (
        <Card className="border-sky-500/30 bg-sky-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-sky-300">Preview do teste</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ActionCard({
  idx, total, action, forceConfirm, onMove, onRemove, onPatch,
}: {
  idx: number; total: number; action: AutomationAction; forceConfirm: boolean;
  onMove: (i: number, d: -1 | 1) => void;
  onRemove: (i: number) => void;
  onPatch: (i: number, p: Partial<AutomationAction>) => void;
}) {
  const risky = isRiskyAction(action.type) || forceConfirm;
  return (
    <div className="rounded-md border bg-card/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-muted-foreground tabular-nums">{idx + 1}.</span>
          <span className="font-mono text-sm truncate">{action.type}</span>
          <span className="text-xs text-muted-foreground truncate">{ACTION_LABELS[action.type]}</span>
        </div>
        <div className="flex items-center gap-1">
          {risky ? (
            <Badge variant="outline" className="border-amber-500/40 text-amber-300 text-[10px] gap-1">
              <ShieldAlert className="h-3 w-3" /> exige confirmação
            </Badge>
          ) : (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 text-[10px] gap-1">
              <Lock className="h-3 w-3" /> sem confirmação
            </Badge>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={idx === 0} onClick={() => onMove(idx, -1)}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={idx === total - 1} onClick={() => onMove(idx, 1)}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onRemove(idx)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <ActionFields action={action} onPatch={(p) => onPatch(idx, p)} />
    </div>
  );
}

function ActionFields({ action, onPatch }: { action: AutomationAction; onPatch: (p: Partial<AutomationAction>) => void }) {
  switch (action.type) {
    case "send_report":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Select value={action.report_type} onValueChange={(v) => onPatch({ report_type: v as never })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["cash", "pipeline", "cobranca", "dashboard"] as const).map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={action.deliver_to} disabled className="font-mono text-xs" />
        </div>
      );
    case "send_whatsapp":
      return (
        <div className="space-y-2">
          <Input
            placeholder="owner ou +5511..."
            value={action.to}
            onChange={(e) => onPatch({ to: e.target.value })}
            className="font-mono text-sm"
          />
          <Textarea
            placeholder="Mensagem. Pode usar {{trigger.X}} e {{kpis.Y}}"
            value={action.template}
            onChange={(e) => onPatch({ template: e.target.value })}
            rows={3}
            className="font-mono text-xs"
          />
        </div>
      );
    case "crm_update_deal":
      return (
        <div className="space-y-2">
          <Input
            placeholder="deal_id (ex: {{trigger.deal_id}})"
            value={action.deal_id}
            onChange={(e) => onPatch({ deal_id: e.target.value })}
            className="font-mono text-sm"
          />
          <JsonField
            label="fields (JSON)"
            value={action.fields}
            onChange={(v) => onPatch({ fields: v as Record<string, unknown> })}
          />
        </div>
      );
    case "crm_create_task":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="título" value={action.title} onChange={(e) => onPatch({ title: e.target.value })} />
          <Input placeholder="due_date" value={action.due_date ?? ""} onChange={(e) => onPatch({ due_date: e.target.value })} className="font-mono text-sm" />
          <Input placeholder="related_to" value={action.related_to ?? ""} onChange={(e) => onPatch({ related_to: e.target.value })} className="col-span-2 font-mono text-sm" />
        </div>
      );
    case "erp_create_invoice":
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="customer" value={action.customer} onChange={(e) => onPatch({ customer: e.target.value })} />
            <Input placeholder="due_date" value={action.due_date} onChange={(e) => onPatch({ due_date: e.target.value })} className="font-mono text-sm" />
          </div>
          <JsonField label="items (JSON array)" value={action.items} onChange={(v) => onPatch({ items: Array.isArray(v) ? v : [] })} />
        </div>
      );
    case "cobranca_send":
      return (
        <div className="grid grid-cols-3 gap-2">
          <Input placeholder="customer_id" value={action.customer_id} onChange={(e) => onPatch({ customer_id: e.target.value })} className="font-mono text-sm" />
          <Input type="number" placeholder="amount" value={action.amount} onChange={(e) => onPatch({ amount: Number(e.target.value) })} className="font-mono tabular-nums" />
          <Input placeholder="due_date" value={action.due_date} onChange={(e) => onPatch({ due_date: e.target.value })} className="font-mono text-sm" />
        </div>
      );
    case "ask_owner_confirm":
      return (
        <Textarea
          value={action.question}
          onChange={(e) => onPatch({ question: e.target.value })}
          rows={2}
          placeholder="Pergunta ao dono"
        />
      );
    case "ai_decide":
      return (
        <div className="space-y-2">
          <Textarea value={action.context} onChange={(e) => onPatch({ context: e.target.value })} rows={2} placeholder="Contexto" />
          <Input
            value={action.options.join(", ")}
            onChange={(e) => onPatch({ options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="opções separadas por vírgula"
            className="font-mono text-sm"
          />
        </div>
      );
  }
}

function JsonField({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setText(JSON.stringify(value ?? {}, null, 2)); }, [value]);
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value);
            setErr(null);
            onChange(parsed);
          } catch (ex) {
            setErr((ex as Error).message);
          }
        }}
        rows={4}
        className="font-mono text-xs"
      />
      {err && <p className="text-xs text-destructive mt-1">{err}</p>}
    </div>
  );
}

function RunsColumn({ runs }: { runs: AutomationRun[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Histórico de execuções</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 max-h-[70vh] overflow-y-auto">
        {runs.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma execução ainda.</p>}
        {runs.map((r) => (
          <div key={r.id} className="rounded-md border bg-card/40 p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                {statusIcon(r.status)}
                {r.status}
              </span>
              <span className="text-muted-foreground tabular-nums">{formatRelative(r.started_at)}</span>
            </div>
            {r.error && <p className="text-xs text-destructive font-mono">{r.error}</p>}
            {r.steps?.length > 0 && (
              <div className="space-y-1">
                {r.steps.map((s, i) => (
                  <div key={i} className="text-[11px] font-mono text-muted-foreground flex items-center gap-1.5">
                    <span className={s.status === "succeeded" ? "text-emerald-400" : s.status === "failed" ? "text-destructive" : ""}>
                      {s.status === "succeeded" ? "✓" : s.status === "failed" ? "✗" : "·"}
                    </span>
                    {s.action_type}
                    {typeof s.duration_ms === "number" && <span className="tabular-nums">({s.duration_ms}ms)</span>}
                    {s.error && <span className="text-destructive truncate">— {s.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
