import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [{ title: "Painel — Agente CFO" }],
  }),
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-semibold">Agente CFO</h1>
        <p className="text-muted-foreground">
          Autenticado como <span className="font-medium text-foreground">{email ?? "…"}</span>
        </p>
        <Button variant="outline" onClick={signOut}>
          Sair
        </Button>
      </div>
    </main>
  );
}
