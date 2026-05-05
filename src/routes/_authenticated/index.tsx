import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonitorSmartphone, DollarSign, AlertTriangle } from "lucide-react";
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

function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [activeInstances, setActiveInstances] = useState(0);
  const [monthCost, setMonthCost] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);
  const [events, setEvents] = useState<EventRow[]>([]);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const period = currentPeriod();

      const [inst, cost, crit, ev] = await Promise.all([
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

      setActiveInstances(inst.count ?? 0);
      setMonthCost((cost.data ?? []).reduce((s, r) => s + Number(r.cost_brl ?? 0), 0));
      setCriticalCount(crit.count ?? 0);
      setEvents((ev.data as EventRow[] | null) ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral do seu painel.</p>
      </div>

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
