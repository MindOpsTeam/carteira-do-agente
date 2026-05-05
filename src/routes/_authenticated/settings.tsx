import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime, truncate } from "@/lib/format";
import { PageSkeleton, EmptyState } from "@/components/states";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Configurações — Agente CFO" }] }),
  component: SettingsPage,
});

type License = {
  id: string;
  license_key: string;
  max_instances: number;
  status: string;
  expires_at: string | null;
};

function SettingsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [budget, setBudget] = useState<string>("");
  const [alertMin, setAlertMin] = useState<string>("");
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: t } = await supabase.from("tenants").select("id, metadata").limit(1).maybeSingle();
      if (t) {
        setTenantId(t.id);
        const meta = (t.metadata ?? {}) as { llm_budget_brl?: number; alert_wa_disconnect_minutes?: number };
        setBudget(String(meta.llm_budget_brl ?? ""));
        setAlertMin(String(meta.alert_wa_disconnect_minutes ?? ""));
      }
      const { data: lic } = await supabase
        .from("licenses")
        .select("id, license_key, max_instances, status, expires_at")
        .order("created_at", { ascending: false });
      setLicenses((lic as License[] | null) ?? []);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    if (!tenantId) return;
    setSaving(true);
    const { data: current } = await supabase.from("tenants").select("metadata").eq("id", tenantId).maybeSingle();
    const merged = {
      ...(current?.metadata as Record<string, unknown> | null ?? {}),
      llm_budget_brl: Number(budget) || 0,
      alert_wa_disconnect_minutes: Number(alertMin) || 0,
    };
    const { error } = await supabase.from("tenants").update({ metadata: merged }).eq("id", tenantId);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Configurações salvas");
  };

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast.success("Chave copiada");
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  if (loading) return <PageSkeleton rows={6} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">Ajustes do tenant e licenças.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Preferências</CardTitle></CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="budget">Orçamento LLM mensal (R$)</Label>
            <Input id="budget" type="number" min="0" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="alert">Alerta WhatsApp desconectado (minutos)</Label>
            <Input id="alert" type="number" min="0" value={alertMin} onChange={(e) => setAlertMin(e.target.value)} />
          </div>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Licenças</CardTitle></CardHeader>
        <CardContent className="p-0">
          {licenses.length === 0 ? (
            <EmptyState title="Nenhuma licença emitida." />
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>License key</TableHead><TableHead>Máx. instâncias</TableHead>
                <TableHead>Status</TableHead><TableHead>Expira em</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {licenses.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <span>{truncate(l.license_key, 24)}</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyKey(l.license_key)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">{l.max_instances}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{l.status}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">
                      {l.expires_at ? formatDateTime(l.expires_at) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
