import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Bell, Save, RotateCcw, Info } from "lucide-react";
import { RULES, defaultRulesConfig, SEVERITY_BADGE, type RulesConfig, type Severity } from "@/lib/proactive-rules";
import { formatRelative } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings_/rules")({
  head: () => ({ meta: [{ title: "Regras Proativas — Agente CFO" }] }),
  component: RulesPage,
});

function RulesPage() {
  const [config, setConfig] = useState<RulesConfig>(defaultRulesConfig());
  const [original, setOriginal] = useState<RulesConfig>(defaultRulesConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasInstance, setHasInstance] = useState(false);
  const [hasErp, setHasErp] = useState(false);
  const [lastFires, setLastFires] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const [onbRes, instRes, evRes] = await Promise.all([
        supabase.from("user_onboarding").select("data").eq("user_id", user.id).maybeSingle(),
        supabase.from("instances").select("id, connected_integrations").limit(1).maybeSingle(),
        supabase.from("events").select("type, payload, created_at").eq("type", "proactive_alert").order("created_at", { ascending: false }).limit(200),
      ]);

      const data = (onbRes.data?.data ?? {}) as Record<string, unknown>;
      const stored = data.proactive_rules_config as RulesConfig | undefined;
      const merged = { ...defaultRulesConfig(), ...(stored ?? {}) };
      setConfig(merged);
      setOriginal(merged);

      setHasInstance(!!instRes.data?.id);
      const integrations = (instRes.data?.connected_integrations ?? {}) as Record<string, unknown>;
      const erpKeys = ["omie","bling","tiny","granatum","vhsys","nibo"];
      setHasErp(erpKeys.some((k) => integrations[k]) || !!(data as Record<string, unknown>).erp);

      const fires: Record<string, string> = {};
      for (const ev of evRes.data ?? []) {
        const ruleName = (ev.payload as { rule_name?: string } | null)?.rule_name;
        if (ruleName && !fires[ruleName]) fires[ruleName] = ev.created_at;
      }
      setLastFires(fires);
      setLoading(false);
    })();
  }, []);

  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(original), [config, original]);

  const validation = useMemo(() => {
    for (const rule of RULES) {
      const cfg = config[rule.name];
      if (!cfg) continue;
      for (const p of rule.params) {
        const v = cfg[p.key];
        if (typeof v !== "number" || !Number.isFinite(v)) return `${rule.title}: ${p.label} inválido`;
        if (p.min !== undefined && v < p.min) return `${rule.title}: ${p.label} mínimo ${p.min}`;
        if (p.max !== undefined && v > p.max) return `${rule.title}: ${p.label} máximo ${p.max}`;
      }
    }
    return null;
  }, [config]);

  const updateParam = (ruleName: string, key: string, value: number | boolean) => {
    setConfig((c) => ({ ...c, [ruleName]: { ...c[ruleName], [key]: value } }));
  };

  const resetDefaults = () => {
    setConfig(defaultRulesConfig());
    toast.info("Valores padrão restaurados (não salvos ainda)");
  };

  const save = async () => {
    if (validation) { toast.error(validation); return; }
    setSaving(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sem sessão");
      const { data, error } = await supabase.functions.invoke("update-proactive-rules", {
        body: { rules: config },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      setOriginal(config);
      const reload = (data as { vps_reload?: { ok: boolean } } | null)?.vps_reload;
      if (reload?.ok) toast.success("Configurações atualizadas. Próximo ciclo em ~30min.");
      else toast.success("Configurações salvas. VPS recarrega no próximo ciclo.");
    } catch (err) {
      toast.error(`Falha ao salvar: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Regras Proativas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure quando o Marcos deve te avisar. Mudanças entram em efeito no próximo ciclo do agente (~30min).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={resetDefaults} disabled={loading}>
            <RotateCcw className="h-4 w-4 mr-2" />Padrões
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || !!validation || saving || loading}>
            <Save className="h-4 w-4 mr-2" />{saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>

      {!hasInstance && (
        <Card className="border-yellow-300 bg-yellow-50">
          <CardContent className="pt-6 text-sm text-yellow-900 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              Nenhuma VPS conectada. As regras ficam salvas mas só disparam quando o agente estiver rodando.{" "}
              <Link to="/onboarding" className="underline font-medium">Configurar agora</Link>
            </div>
          </CardContent>
        </Card>
      )}

      {hasInstance && !hasErp && (
        <Card className="border-blue-300 bg-blue-50">
          <CardContent className="pt-6 text-sm text-blue-900 flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              Você ainda não conectou um ERP. Conecte em{" "}
              <Link to="/onboarding" className="underline font-medium">/onboarding</Link>{" "}
              pra ativar regras financeiras.
            </div>
          </CardContent>
        </Card>
      )}

      {validation && (
        <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded border border-destructive/30">
          {validation}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Carregando regras...</div>
      ) : (
        <div className="grid gap-4">
          {RULES.map((rule) => {
            const cfg = config[rule.name] ?? { enabled: true };
            const enabled = cfg.enabled !== false;
            const Icon = rule.icon;
            const lastFire = lastFires[rule.name];
            return (
              <Card key={rule.name} className={enabled ? "" : "opacity-60"}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="rounded-md bg-muted p-2 shrink-0">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                          {rule.title}
                          <Badge variant="outline" className={SEVERITY_BADGE[rule.severity as Severity]}>
                            {rule.severity}
                          </Badge>
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">{rule.description}</p>
                      </div>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => updateParam(rule.name, "enabled", v)}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    {rule.params.map((p) => {
                      const val = cfg[p.key];
                      const num = typeof val === "number" ? val : p.default;
                      const invalid =
                        (p.min !== undefined && num < p.min) ||
                        (p.max !== undefined && num > p.max);
                      return (
                        <div key={p.key} className="space-y-1">
                          <label className="text-xs text-muted-foreground">
                            {p.label}{p.suffix ? ` (${p.suffix})` : ""}
                          </label>
                          <Input
                            type="number"
                            min={p.min}
                            max={p.max}
                            step={p.step ?? 1}
                            value={num}
                            disabled={!enabled}
                            onChange={(e) => updateParam(rule.name, p.key, Number(e.target.value))}
                            className={invalid ? "border-destructive" : ""}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {lastFire
                      ? <>Último disparo: <span className="font-medium">{formatRelative(lastFire)}</span></>
                      : "Nunca disparou."}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={save} disabled={!dirty || !!validation || saving || loading}>
          <Save className="h-4 w-4 mr-2" />{saving ? "Salvando..." : "Salvar configurações"}
        </Button>
      </div>
    </div>
  );
}
