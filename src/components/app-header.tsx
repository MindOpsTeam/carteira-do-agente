import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, HelpCircle, Terminal, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export function AppHeader() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string>("");
  const [dashAvailable, setDashAvailable] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      setEmail(userData.user?.email ?? "");

      const { data: inst } = await supabase
        .from("instances")
        .select("ingress_url, openclaw_dashboard_token")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setDashAvailable(!!(inst?.ingress_url && inst?.openclaw_dashboard_token));
    })();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    navigate({ to: "/login" });
  };

  const [loadingDash, setLoadingDash] = useState(false);
  const openOpenclawDashboard = async () => {
    setLoadingDash(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/openclaw-dashboard-url`, {
        headers: {
          Authorization: `Bearer ${sess.session?.access_token}`,
          apikey: SUPABASE_ANON,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Erro desconhecido" }));
        toast.error(body.error ?? "Não foi possível abrir o dashboard");
        return;
      }
      const { url } = await res.json();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error("Falha ao buscar URL", { description: String(e) });
    } finally {
      setLoadingDash(false);
    }
  };

  return (
    <header className="h-14 flex items-center gap-3 border-b bg-background px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-6" />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">Agente CFO</div>
      </div>
      <div className="hidden sm:block text-sm text-muted-foreground truncate max-w-[200px]">{email}</div>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="outline"
              size="sm"
              onClick={openOpenclawDashboard}
              disabled={loadingDash || !dashAvailable}
            >
              {loadingDash ? <Loader2 className="h-4 w-4 animate-spin sm:mr-2" /> : <Terminal className="h-4 w-4 sm:mr-2" />}
              <span className="hidden sm:inline">OpenClaw</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {dashAvailable
            ? "Abrir dashboard do agente (OpenClaw)"
            : "Dashboard indisponível — rode setup.sh na VPS para habilitar"}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            asChild
          >
            <a
              href="https://github.com/MindOpsTeam/agente-cfo"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Ajuda"
            >
              <HelpCircle className="h-4 w-4" />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Ajuda</TooltipContent>
      </Tooltip>
      <Button variant="ghost" size="sm" onClick={signOut}>
        <LogOut className="h-4 w-4 sm:mr-2" />
        <span className="hidden sm:inline">Sair</span>
      </Button>
    </header>
  );
}
