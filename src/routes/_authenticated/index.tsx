import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
  ReferenceLine,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Command as CmdIcon,
  Download,
  ExternalLink,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Wallet,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrencyBRL, formatRelative } from "@/lib/format";
import { fetchOnboardingStatus } from "@/hooks/use-onboarding";
import type { DashboardSnapshot, Goal } from "@/types/dashboard";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Comando Central — Agente CFO" }] }),
  component: ComandoCentral,
});

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

async function fetchSnapshot(): Promise<DashboardSnapshot> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/dashboard-snapshot`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

type Insight = {
  id: number;
  section: string;
  text: string;
  severity: string;
  data: Record<string, unknown>;
  created_at: string;
};

function useInsights() {
  const [insights, setInsights] = useState<Insight[]>([]);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("marcos_insights")
        .select("*")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (mounted) setInsights((data as Insight[]) ?? []);
    })();
    const ch = supabase
      .channel("marcos_insights")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "marcos_insights" }, (p) => {
        setInsights((prev) => [p.new as Insight, ...prev]);
      })
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);
  return insights;
}

function ComandoCentral() {
  const navigate = useNavigate();
  const [needsOnboarding, setNeedsOnboarding] = useState<null | "no-instance" | "incomplete">(null);
  const [realtimeOk, setRealtimeOk] = useState(true);

  const { data, isLoading, isFetching, refetch, error } = useQuery<DashboardSnapshot, Error & { status?: number }>({
    queryKey: ["dashboard-snapshot"],
    queryFn: fetchSnapshot,
    staleTime: 5 * 60 * 1000,
    retry: (count, err) => (err as { status?: number })?.status === 401 ? false : count < 1,
  });

  // Onboarding check
  useEffect(() => {
    (async () => {
      const status = await fetchOnboardingStatus();
      if (!status.completed && !status.hasInstance) {
        setNeedsOnboarding("no-instance");
      } else if (!status.completed) {
        setNeedsOnboarding("incomplete");
      }
    })();
  }, []);

  // Auth error → login
  useEffect(() => {
    if (error?.status === 401) navigate({ to: "/login" });
  }, [error, navigate]);

  const insights = useInsights();
  const insightsBySection = useMemo(() => {
    const m: Record<string, Insight | undefined> = {};
    for (const i of insights) if (!m[i.section]) m[i.section] = i;
    return m;
  }, [insights]);

  const criticalInsights = insights.filter((i) => i.severity === "critical");
  const crisisMode = criticalInsights.length > 0;

  // Cmd+K
  const [cmdOpen, setCmdOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Goals (for line chart marker) — single-tenant
  const [goals, setGoals] = useState<Goal[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("goals").select("*").eq("active", true);
      setGoals((data as Goal[]) ?? []);
    })();
  }, []);

  // Scenario
  const [scenario, setScenario] = useState({ collect: 0, deals: 0, cut: 0 });
  const [simResult, setSimResult] = useState<null | { delta_balance_brl: number; new_balance_30d: number }>(null);
  const [simulating, setSimulating] = useState(false);
  const simTimerRef = useRef<number | null>(null);

  const applyScenario = async () => {
    setSimulating(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/simulate-scenario`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sess.session?.access_token}`,
          apikey: SUPABASE_ANON,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          collect_percent_overdue: scenario.collect / 100,
          close_deal_count: scenario.deals,
          cut_cost_pct: scenario.cut / 100,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setSimResult({
        delta_balance_brl: Number(json.delta_balance_brl ?? 0),
        new_balance_30d: Number(json.new_balance_30d ?? 0),
      });
      if (simTimerRef.current) window.clearTimeout(simTimerRef.current);
      simTimerRef.current = window.setTimeout(() => setSimResult(null), 10000);
      toast.success("Simulação aplicada");
    } catch (e) {
      toast.error("Falha na simulação", { description: String(e) });
    } finally {
      setSimulating(false);
    }
  };

  // PDF export
  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const exportPdf = async () => {
    if (!reportRef.current) return;
    setExporting(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(reportRef.current, { backgroundColor: "#0a0a0a", scale: 2 });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const w = pdf.internal.pageSize.getWidth();
      const h = (canvas.height * w) / canvas.width;
      pdf.addImage(img, "PNG", 0, 0, w, Math.min(h, pdf.internal.pageSize.getHeight()));
      const today = new Date().toISOString().slice(0, 10);
      pdf.save(`comando-central-${today}.pdf`);
    } catch (e) {
      toast.error("Falha ao exportar PDF", { description: String(e) });
    } finally {
      setExporting(false);
    }
  };

  // Edge: onboarding incomplete
  if (needsOnboarding === "no-instance" || error?.status === 422) {
    return <OnboardingCTA />;
  }

  // Edge: no integrations
  if (data && data.integrations_health.length === 0) {
    return <NoIntegrationsCTA />;
  }

  const k = data?.kpis;

  return (
    <div className="space-y-6">
      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="Buscar comando..." />
        <CommandList>
          <CommandEmpty>Nada encontrado.</CommandEmpty>
          <CommandGroup heading="Navegar">
            <CommandItem onSelect={() => { setCmdOpen(false); navigate({ to: "/chat" }); }}>Ir para Chat</CommandItem>
            <CommandItem onSelect={() => { setCmdOpen(false); navigate({ to: "/reports" }); }}>Ver Relatórios / Cobrança</CommandItem>
            <CommandItem onSelect={() => { setCmdOpen(false); navigate({ to: "/goals" }); }}>Configurar Metas</CommandItem>
            <CommandItem onSelect={() => { setCmdOpen(false); navigate({ to: "/integrations" }); }}>Integrações</CommandItem>
          </CommandGroup>
          <CommandGroup heading="Ações">
            <CommandItem onSelect={() => { setCmdOpen(false); refetch(); }}>Forçar refresh do snapshot</CommandItem>
            <CommandItem onSelect={() => { setCmdOpen(false); exportPdf(); }}>Exportar PDF executivo</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {crisisMode && (
        <div className="border border-destructive/40 bg-destructive/10 text-destructive-foreground rounded-md px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-destructive">Modo crise ativado — {criticalInsights.length} alerta(s) crítico(s)</p>
            <p className="text-xs text-muted-foreground">{criticalInsights[0]?.text}</p>
          </div>
        </div>
      )}

      {/* HERO */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {greeting()}.{" "}
            <span className="text-muted-foreground font-normal">
              {crisisMode ? `Atenção: ${criticalInsights.length} alerta${criticalInsights.length > 1 ? "s" : ""}.` : "Tudo sob controle."}
            </span>
          </h1>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground font-mono">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${realtimeOk ? "bg-emerald-500 animate-pulse" : "bg-destructive"}`} />
              {realtimeOk ? "REALTIME" : "OFFLINE"}
            </span>
            <span>·</span>
            <span>{data ? `atualizado ${formatRelative(data.as_of)}` : "—"}</span>
            {isFetching && <span className="flex items-center gap-1"><RefreshCw className="h-3 w-3 animate-spin" /> atualizando…</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCmdOpen(true)} className="font-mono text-xs">
            <CmdIcon className="h-3.5 w-3.5" /> ⌘K
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={exporting || !data}>
            <Download className="h-3.5 w-3.5" /> PDF
          </Button>
        </div>
      </header>

      <div ref={reportRef} className="space-y-6">
        {/* KPIs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Saldo atual"
            value={k?.balance_brl}
            loading={isLoading}
            insight={insightsBySection["balance"]}
            override={simResult ? simResult.new_balance_30d : undefined}
            icon={<Wallet className="h-4 w-4" />}
          />
          <Kpi
            label="A receber 30d"
            value={k?.receivables_30d_brl}
            loading={isLoading}
            insight={insightsBySection["receivables"]}
            icon={<ArrowUp className="h-4 w-4 text-emerald-500" />}
          />
          <Kpi
            label="A pagar 30d"
            value={k?.payables_30d_brl}
            loading={isLoading}
            insight={insightsBySection["payables"]}
            icon={<ArrowDown className="h-4 w-4 text-amber-500" />}
          />
          <Kpi
            label="Pipeline ponderado"
            value={k?.pipeline_weighted_brl}
            loading={isLoading}
            insight={insightsBySection["pipeline"]}
            icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
          />
        </div>

        {/* Gráficos linha 1 */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Projeção de caixa — 90 dias</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : data && data.cash_projection_90d.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.cash_projection_90d}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                    <RTooltip content={<CurrencyTooltip />} />
                    <Line type="monotone" dataKey="balance_brl" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
                    {goals.filter((g) => g.metric === "balance_brl").map((g) => (
                      <ReferenceLine key={g.id} y={Number(g.target_value)} stroke="var(--color-chart-3)" strokeDasharray="4 4" label={{ value: "Meta", fill: "var(--color-chart-3)", fontSize: 10 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart text="Aguardando primeiro sync (até 5min)" />
              )}
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-foreground/20 transition-colors" onClick={() => navigate({ to: "/reports" })}>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                Pipeline por estágio
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : data && data.pipeline_by_stage.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.pipeline_by_stage} layout="vertical" margin={{ left: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="stage" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} width={80} />
                    <RTooltip content={<CurrencyTooltip />} />
                    <Bar dataKey="brl" fill="var(--color-chart-2)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart text="Sem dados de pipeline" />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Linha 2 */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Receita por canal — 30d</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : data && data.by_channel_revenue_30d.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.by_channel_revenue_30d} dataKey="brl" nameKey="channel" innerRadius={50} outerRadius={90} paddingAngle={2}>
                      {data.by_channel_revenue_30d.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <RTooltip content={<CurrencyTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart text="Sem receita registrada" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top devedores</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : data && data.top_debtors.length > 0 ? (
                <div className="divide-y divide-border">
                  {data.top_debtors.slice(0, 5).map((d, i) => (
                    <div key={d.id ?? i} className="flex items-center justify-between py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{d.name}</p>
                        {d.days_overdue !== undefined && (
                          <p className="text-xs text-muted-foreground font-mono">{d.days_overdue}d em atraso</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums">{formatCurrencyBRL(d.brl)}</p>
                        <button onClick={() => navigate({ to: "/chat" })} className="text-xs text-primary hover:underline">
                          Marcos: cobrar?
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">Sem inadimplentes 🎉</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Cenário */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Cenários "E se" — simule decisões em tempo real
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ScenarioSlider
              label={`Cobrar ${scenario.collect}% do inadimplente`}
              value={scenario.collect}
              onChange={(v) => setScenario((s) => ({ ...s, collect: v }))}
              max={100}
              step={5}
              hint={data ? `+${formatCurrencyBRL((data.kpis.overdue_total_brl * scenario.collect) / 100)}` : "—"}
            />
            <ScenarioSlider
              label={`Fechar ${scenario.deals} deal(s) do pipeline`}
              value={scenario.deals}
              onChange={(v) => setScenario((s) => ({ ...s, deals: v }))}
              max={10}
              step={1}
              hint={data ? `pipeline: ${formatCurrencyBRL(data.kpis.pipeline_weighted_brl)}` : "—"}
            />
            <ScenarioSlider
              label={`Cortar ${scenario.cut}% custos variáveis`}
              value={scenario.cut}
              onChange={(v) => setScenario((s) => ({ ...s, cut: v }))}
              max={50}
              step={1}
              hint={data ? `economia: ${formatCurrencyBRL((data.kpis.payables_30d_brl * scenario.cut) / 100)}` : "—"}
            />
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-border">
              <div className="text-sm">
                {simResult ? (
                  <span className="font-mono tabular-nums">
                    Novo saldo 30d:{" "}
                    <span className="text-emerald-500 font-semibold">{formatCurrencyBRL(simResult.new_balance_30d)}</span>{" "}
                    <span className="text-emerald-500 text-xs">(+{formatCurrencyBRL(simResult.delta_balance_brl)})</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Ajuste e aplique para ver o impacto</span>
                )}
              </div>
              <Button onClick={applyScenario} disabled={simulating} size="sm">
                {simulating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                Aplicar simulação
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Saúde integrações */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saúde das integrações</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : (
              <div className="flex flex-wrap gap-3">
                {(data?.integrations_health ?? []).map((h) => (
                  <div key={h.name} className="flex items-center gap-2 text-xs font-mono border border-border rounded px-3 py-1.5">
                    {h.status === "ok" ? (
                      <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <WifiOff className="h-3.5 w-3.5 text-destructive" />
                    )}
                    <span className="font-medium">{h.name}</span>
                    <span className="text-muted-foreground">{h.last_sync ? formatRelative(h.last_sync) : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {needsOnboarding === "incomplete" && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-4 flex items-center justify-between">
            <p className="text-sm">Complete a configuração para liberar todos os recursos.</p>
            <Button variant="outline" size="sm" onClick={() => navigate({ to: "/onboarding" })}>
              Continuar onboarding
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CurrencyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name?: string; payload?: Record<string, unknown> }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-md px-3 py-2 shadow-lg text-xs font-mono">
      {label && <div className="text-muted-foreground mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span>{p.name ?? (p.payload as { channel?: string; stage?: string })?.channel ?? (p.payload as { stage?: string })?.stage ?? ""}</span>
          <span className="font-semibold tabular-nums">{formatCurrencyBRL(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function Kpi({
  label,
  value,
  loading,
  insight,
  override,
  icon,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  insight?: Insight;
  override?: number;
  icon?: React.ReactNode;
}) {
  const isCritical = insight?.severity === "critical";
  return (
    <Card className={`relative ${isCritical ? "border-destructive/50" : ""} ${override !== undefined ? "ring-1 ring-emerald-500/60 ring-dashed" : ""}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5">
        <CardTitle className="text-xs uppercase tracking-wider font-medium text-muted-foreground">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <div className="text-2xl font-semibold tabular-nums font-mono">
            {override !== undefined ? (
              <span className="text-emerald-500">{formatCurrencyBRL(override)}</span>
            ) : (
              formatCurrencyBRL(value ?? 0)
            )}
          </div>
        )}
        {insight && (
          <div className={`text-xs flex items-start gap-1.5 ${isCritical ? "text-destructive" : "text-muted-foreground"}`}>
            {isCritical ? <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> : <span className="shrink-0">💡</span>}
            <span className="italic line-clamp-2">{insight.text}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScenarioSlider({
  label, value, onChange, max, step, hint,
}: { label: string; value: number; onChange: (v: number) => void; max: number; step: number; hint: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2 text-sm">
        <span>{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{hint}</span>
      </div>
      <Slider value={[value]} min={0} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{text}</div>;
}

function OnboardingCTA() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Complete o onboarding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Antes de ver o Comando Central você precisa registrar uma instância e conectar suas integrações.
          </p>
          <Link to="/onboarding"><Button>Iniciar onboarding</Button></Link>
        </CardContent>
      </Card>
    </div>
  );
}

function NoIntegrationsCTA() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Conecte sua primeira integração</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            O Comando Central agrega dados das suas integrações. Conecte ao menos uma para começar.
          </p>
          <Link to="/integrations"><Button>Ir para integrações</Button></Link>
        </CardContent>
      </Card>
    </div>
  );
}
