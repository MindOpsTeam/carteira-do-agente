import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchOnboardingStatus } from "@/hooks/use-onboarding";
import { OnboardingPendingBanner } from "@/components/onboarding-banner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonitorSmartphone, DollarSign, AlertTriangle, Copy, Check, ExternalLink } from "lucide-react";
import { formatCurrencyBRL, formatRelative, currentPeriod } from "@/lib/format";
import { SeverityBadge } from "@/lib/status";
import { PageSkeleton, EmptyState } from "@/components/states";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard — Agente CFO" }] }),
  component: Dashboard,
});

type EventRow = {
  id: number;
  type: string;
  severity: string;
  created_at: string;
  instance_id: string;
  payload: unknown;
  instances?: { hostname: string | null } | null;
};

const INSTALL_CMD = "curl -fsSL https://raw.githubusercontent.com/MindOpsTeam/agente-cfo/main/install/setup.sh | bash";

function OnboardingCard() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(INSTALL_CMD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle className="text-xl">Bem-vindo ao Marcos, seu CFO virtual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Você acabou de criar seu painel. O próximo passo é instalar o agente na sua VPS.
            Rode o comando abaixo e siga as instruções:
          </p>
          <div className="relative">
            <pre className="bg-muted rounded px-3 py-2 text-xs font-mono overflow-x-auto pr-10 whitespace-pre-wrap break-all">
              {INSTALL_CMD}
            </pre>
            <button
              onClick={copy}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
              title="Copiar"
            >
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Quando o agente registrar, esta tela vai mostrar o dashboard com saldo, eventos e custos.
          </p>
          <a
            href="https://github.com/MindOpsTeam/agente-cfo"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary underline hover:no-underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Ver README completo
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [totalInstances, setTotalInstances] = useState<number | null>(null);
  const [activeInstances, setActiveInstances] = useState(0);
  const [monthCost, setMonthCost] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [onboardingPending, setOnboardingPending] = useState(false);

  useEffect(() => {
    (async () => {
      const status = await fetchOnboardingStatus();
      if (!status.completed && !status.hasInstance) {
        navigate({ to: "/onboarding" });
        return;
      }
      setOnboardingPending(!status.completed);
    })();
  }, [navigate]);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const period = currentPeriod();

      const [allInst, inst, cost, crit, ev] = await Promise.all([
        supabase.from("instances").select("id", { count: "exact", head: true }),
        supabase.from("instances").select("id", { count: "exact", head: true }).eq("status", "online"),
        supabase.from("llm_usage").select("cost_brl").eq("period", period),
        supabase
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("severity", "critical")
          .gte("created_at", since),
        supabase
          .from("events")
          .select("id, type, severity, created_at, instance_id, payload, instances(hostname)")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      setTotalInstances(allInst.count ?? 0);
      setActiveInstances(inst.count ?? 0);
      setMonthCost((cost.data ?? []).reduce((s, r) => s + Number(r.cost_brl ?? 0), 0));
      setCriticalCount(crit.count ?? 0);
      setEvents((ev.data as EventRow[] | null) ?? []);
      setLoading(false);
    })();
  }, []);

  if (!loading && totalInstances === 0) {
    return <OnboardingCard />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral do seu painel.</p>
      </div>

      {onboardingPending && <OnboardingPendingBanner />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Instâncias ativas"
          value={String(activeInstances)}
          icon={<MonitorSmartphone className="h-4 w-4" />}
        />
        <StatCard
          title="Custo LLM (mês)"
          value={formatCurrencyBRL(monthCost)}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <StatCard
          title="Eventos críticos (24h)"
          value={String(criticalCount)}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimos eventos</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <PageSkeleton rows={6} />
          ) : events.length === 0 ? (
            <EmptyState title="Nenhum evento registrado ainda." />
          ) : (
            <div className="divide-y">
              {events.map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-3">
                  <SeverityBadge severity={e.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{e.type}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {e.instances?.hostname ?? "—"}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatRelative(e.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  );
}
