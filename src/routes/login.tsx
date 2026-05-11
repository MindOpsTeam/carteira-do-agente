// Login: email + password via signInWithPassword (no OTP). Rebuild marker.
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: "Entrar — Agente CFO" },
      { name: "description", content: "Acesse o painel administrativo do Agente CFO." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const readField = (id: string, fallback: string) => {
    if (typeof document === "undefined") return fallback;
    const el = document.getElementById(id) as HTMLInputElement | null;
    return el?.value || fallback;
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const finalEmail = email || readField("email", "");
    const finalPassword = password || readField("password", "");

    if (!finalEmail || !finalPassword) {
      toast.error("Preencha email e senha");
      return;
    }
    if (finalPassword.length < 6) {
      toast.error("Senha precisa de pelo menos 6 caracteres");
      return;
    }

    setLoading(true);

    // Tenta login direto
    const signInResult = await supabase.auth.signInWithPassword({
      email: finalEmail,
      password: finalPassword,
    });

    if (signInResult.data.session) {
      setLoading(false);
      toast.success("Entrou");
      navigate({ to: "/" });
      return;
    }

    // Se falhou por "Invalid login credentials", tenta criar conta
    const msg = signInResult.error?.message || "";
    const isInvalidCreds = /invalid login credentials/i.test(msg);

    if (!isInvalidCreds) {
      setLoading(false);
      toast.error(msg || "Falha ao entrar");
      return;
    }

    // Cria conta nova
    const signUpResult = await supabase.auth.signUp({
      email: finalEmail,
      password: finalPassword,
    });

    if (signUpResult.error) {
      setLoading(false);
      toast.error(signUpResult.error.message);
      return;
    }

    // Se já criou com session ativa (mailer_autoconfirm=true), entra
    if (signUpResult.data.session) {
      setLoading(false);
      toast.success("Conta criada");
      navigate({ to: "/" });
      return;
    }

    // Caso autoconfirm não tenha pegado, tenta login de novo
    const retry = await supabase.auth.signInWithPassword({
      email: finalEmail,
      password: finalPassword,
    });
    setLoading(false);
    if (retry.data.session) {
      toast.success("Conta criada");
      navigate({ to: "/" });
      return;
    }
    toast.error(retry.error?.message || "Conta criada mas precisa confirmar email. Verifique sua caixa.");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Toaster />
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-semibold tracking-tight">Agente CFO</CardTitle>
          <CardDescription>Painel administrativo</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder="voce@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              Primeira vez? A conta é criada automaticamente com esses dados.
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
