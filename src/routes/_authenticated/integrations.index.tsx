import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plug, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/integrations/")({
  head: () => ({ meta: [{ title: "Integrações — Agente CFO" }] }),
  component: IntegrationsIndex,
});

type IntegrationDef = {
  key: string;
  name: string;
  description: string;
  managed: boolean; // gerenciado pelo painel
  href?: string;
};

const INTEGRATIONS: IntegrationDef[] = [
  { key: "bling", name: "Bling", description: "ERP e e-commerce — fluxo de caixa, pedidos, NF-e.", managed: true, href: "/integrations/bling" },
  { key: "contaazul", name: "ContaAzul", description: "Gestão financeira — fluxo de caixa, contas a pagar/receber.", managed: true, href: "/integrations/contaazul" },
  { key: "omie", name: "Omie", description: "ERP financeiro e contábil.", managed: false },
  { key: "pipedrive", name: "Pipedrive", description: "CRM de vendas — pipeline e previsão de receita.", managed: false },
  { key: "tiny", name: "Tiny", description: "ERP para e-commerce.", managed: false },
  { key: "granatum", name: "Granatum", description: "Gestão financeira para PMEs.", managed: false },
  { key: "vhsys", name: "VHSYS", description: "ERP modular online.", managed: false },
  { key: "nibo", name: "Nibo", description: "Contas a pagar e receber.", managed: false },
  { key: "hubspot", name: "HubSpot", description: "CRM e marketing.", managed: false },
  { key: "rdstation", name: "RD Station CRM", description: "CRM nacional.", managed: false },
  { key: "piperun", name: "PipeRun", description: "CRM de vendas.", managed: false },
];

function IntegrationsIndex() {
  const [connected, setConnected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("instances")
        .select("connected_integrations")
        .limit(1)
        .maybeSingle();
      const ci = (data?.connected_integrations ?? {}) as Record<string, unknown>;
      const flags: Record<string, boolean> = {};
      for (const k of Object.keys(ci)) flags[k] = true;
      setConnected(flags);
    })();
  }, []);

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
          <p className="text-sm text-muted-foreground">Conecte suas ferramentas financeiras pro Agente CFO consultar dados em tempo real.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {INTEGRATIONS.map((it) => {
            const isConnected = !!connected[it.key];
            return (
              <Card key={it.key} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center">
                        <Plug className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <CardTitle className="text-base">{it.name}</CardTitle>
                    </div>
                    {isConnected ? (
                      <Badge variant="default">Conectado</Badge>
                    ) : (
                      <Badge variant="secondary">Não conectado</Badge>
                    )}
                  </div>
                  <CardDescription className="mt-2">{it.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  {it.managed && it.href ? (
                    <Button asChild size="sm" className="w-full">
                      <Link to={it.href}>{isConnected ? "Gerenciar" : "Conectar"}</Link>
                    </Button>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="outline" className="w-full" disabled>
                          <ExternalLink className="h-3.5 w-3.5" />
                          Configure via setup.sh
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Configure essa integração rodando setup.sh na sua VPS.</TooltipContent>
                    </Tooltip>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
