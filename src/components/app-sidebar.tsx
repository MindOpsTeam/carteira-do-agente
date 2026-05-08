import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, MonitorSmartphone, ScrollText, DollarSign, ShieldCheck, Settings, Briefcase, Plug, MessageSquare } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, exact: true },
  { title: "Conversar", url: "/chat", icon: MessageSquare },
  { title: "Instâncias", url: "/instances", icon: MonitorSmartphone },
  { title: "Eventos", url: "/events", icon: ScrollText },
  { title: "Custo LLM", url: "/llm-usage", icon: DollarSign },
  { title: "Auditoria", url: "/audit", icon: ShieldCheck },
  { title: "Integrações", url: "/integrations", icon: Plug },
  { title: "Configurações", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });

  const isActive = (url: string, exact?: boolean) =>
    exact ? path === url : path === url || path.startsWith(url + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <Briefcase className="h-5 w-5 text-primary shrink-0" />
          <span className="font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Agente CFO
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
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
      </SidebarContent>
    </Sidebar>
  );
}
