import { useState, useEffect } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  BarChart3,
  BarChart2,
  Target,
  Zap,
  Plug,
  Settings,
  Server,
  Activity,
  Bell,
  ScrollText,
  Cpu,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const mainItems = [
  { title: "Painel", url: "/", icon: LayoutDashboard, exact: true },
  { title: "Relatórios", url: "/reports", icon: BarChart3 },
  { title: "Metas", url: "/goals", icon: Target },
  { title: "Automações", url: "/automations", icon: Zap },
  { title: "Alertas", url: "/alerts", icon: Bell },
  { title: "Integrações", url: "/integrations", icon: Plug },
  { title: "Configurações", url: "/settings", icon: Settings, exact: true },
];

const adminItems = [
  { title: "Instâncias", url: "/instances", icon: Server },
  { title: "Observabilidade", url: "/observability", icon: Activity },
  { title: "Eventos", url: "/events", icon: ScrollText },
  { title: "Custo LLM", url: "/llm-usage", icon: Cpu },
  { title: "Auditoria", url: "/audit", icon: ShieldCheck },
];

const ADMIN_OPEN_KEY = "cfo:sidebar-admin-open";

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = localStorage.getItem(ADMIN_OPEN_KEY);
    if (v === "1") setAdminOpen(true);
  }, []);

  const toggleAdmin = (open: boolean) => {
    setAdminOpen(open);
    if (typeof window !== "undefined") {
      localStorage.setItem(ADMIN_OPEN_KEY, open ? "1" : "0");
    }
  };

  const isActive = (url: string, exact?: boolean) =>
    exact ? path === url : path === url || path.startsWith(url + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <BarChart2 className="h-5 w-5 text-primary shrink-0" />
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="font-semibold tracking-tight leading-tight">Agente CFO</span>
            <span className="text-xs text-muted-foreground leading-tight">CFO Digital</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url, item.exact)} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Collapsible open={adminOpen} onOpenChange={toggleAdmin}>
          <SidebarGroup>
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="cursor-pointer flex items-center justify-between hover:text-foreground transition-colors">
                <span>Administração</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${adminOpen ? "rotate-0" : "-rotate-90"}`}
                />
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {adminItems.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                        <Link to={item.url}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      </SidebarContent>
    </Sidebar>
  );
}
