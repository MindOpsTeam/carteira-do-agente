import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "Conversar com Marcos — Agente CFO" }] }),
  component: ChatPage,
});

type Msg = {
  id: number;
  thread_id: string;
  role: "user" | "marcos" | "system";
  content: string;
  status: "pending" | "sent" | "delivered" | "error" | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function isDraft(content: string) {
  const c = content.toLowerCase();
  return c.includes("confirme") && (c.includes("sim") || c.includes("não") || c.includes("nao"));
}

function renderContent(content: string) {
  // markdown leve: **bold**, `code`, listas
  const lines = content.split("\n");
  return lines.map((line, idx) => {
    const parts: (string | JSX.Element)[] = [];
    let remaining = line;
    let key = 0;
    const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(remaining)) !== null) {
      if (m.index > lastIdx) parts.push(remaining.slice(lastIdx, m.index));
      const tok = m[0];
      if (tok.startsWith("**")) {
        parts.push(<strong key={`b-${idx}-${key++}`}>{tok.slice(2, -2)}</strong>);
      } else {
        parts.push(
          <code key={`c-${idx}-${key++}`} className="bg-muted px-1 py-0.5 rounded text-xs font-mono">
            {tok.slice(1, -1)}
          </code>,
        );
      }
      lastIdx = m.index + tok.length;
    }
    if (lastIdx < remaining.length) parts.push(remaining.slice(lastIdx));
    const isBullet = /^\s*[-*]\s+/.test(line);
    return (
      <div key={idx} className={isBullet ? "pl-4 relative before:content-['•'] before:absolute before:left-0" : ""}>
        {isBullet ? parts.map((p, i) => <span key={i}>{typeof p === "string" ? p.replace(/^\s*[-*]\s+/, "") : p}</span>) : parts}
        {line === "" && <br />}
      </div>
    );
  });
}

function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // boot: pega user, thread, msgs, status da instância
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const tid = `panel:${u.user.id}`;
      setThreadId(tid);

      const { data: msgs } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("thread_id", tid)
        .order("created_at", { ascending: true })
        .limit(100);
      setMessages((msgs ?? []) as Msg[]);

      const { data: inst } = await supabase
        .from("instances")
        .select("status, last_heartbeat")
        .order("last_heartbeat", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      const lastHb = inst?.last_heartbeat ? new Date(inst.last_heartbeat).getTime() : 0;
      const fresh = Date.now() - lastHb < 5 * 60 * 1000;
      setOnline(Boolean(inst && inst.status === "online" && fresh));

      setLoading(false);
    })();
  }, []);

  // realtime
  useEffect(() => {
    if (!threadId) return;
    const channel = supabase
      .channel(`chat:${threadId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
        (payload) => {
          setMessages((prev) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as Msg;
              if (prev.find((m) => m.id === row.id)) return prev;
              return [...prev, row];
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as Msg;
              return prev.map((m) => (m.id === row.id ? row : m));
            }
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id: number }).id;
              return prev.filter((m) => m.id !== oldId);
            }
            return prev;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId]);

  // autoscroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const marcosTyping = messages.length > 0 &&
    messages[messages.length - 1].role === "marcos" &&
    messages[messages.length - 1].status === "pending";

  const send = async () => {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setInput("");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sem sessão");
      const { error } = await supabase.functions.invoke("chat-send-message", {
        body: { content },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
    } catch (err) {
      toast.error(`Falha ao enviar: ${String(err)}`);
      setInput(content);
    } finally {
      setSending(false);
    }
  };

  const clearHistory = async () => {
    if (!threadId) return;
    if (!confirm("Apagar todo o histórico do chat?")) return;
    const { error } = await supabase.from("chat_messages").delete().eq("thread_id", threadId);
    if (error) {
      toast.error("Não foi possível limpar");
      return;
    }
    setMessages([]);
    toast.success("Histórico limpo");
  };

  // detecta resposta de confirmação para um draft anterior
  const confirmationFor = (idx: number): "yes" | "no" | null => {
    const m = messages[idx];
    if (m.role !== "user") return null;
    const prev = messages[idx - 1];
    if (!prev || prev.role !== "marcos" || !isDraft(prev.content)) return null;
    const c = m.content.trim().toLowerCase();
    if (/^(sim|confirmo|s|yes|y|ok)\b/.test(c)) return "yes";
    if (/^(não|nao|n|cancela|cancelar|no)\b/.test(c)) return "no";
    return null;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="font-semibold leading-tight">Marcos — seu CFO virtual</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={`h-2 w-2 rounded-full ${
                  online ? "bg-green-500" : "bg-muted-foreground/40"
                }`}
              />
              {online ? "online" : "offline"}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={clearHistory} disabled={messages.length === 0}>
          <Trash2 className="h-4 w-4 mr-1" />
          Limpar
        </Button>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1 my-3" ref={scrollRef}>
        <div className="space-y-3 pr-3">
          {loading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Carregando...</div>
          ) : messages.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground bg-muted/30 border-dashed">
              Olá. Sou o <strong className="text-foreground">Marcos</strong>, seu CFO. Pergunte
              sobre saldo, contas a pagar, pipeline. Pode pedir pra eu fazer ações também
              <span className="opacity-70"> (sempre confirmo antes)</span>.
            </Card>
          ) : (
            messages.map((m, idx) => {
              const isUser = m.role === "user";
              const draft = m.role === "marcos" && isDraft(m.content);
              const conf = confirmationFor(idx);
              return (
                <div
                  key={m.id}
                  className={`flex animate-in fade-in slide-in-from-bottom-1 duration-200 ${
                    isUser ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words ${
                      isUser
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    } ${draft ? "border-l-4 border-yellow-500" : ""} ${
                      m.status === "error" ? "border border-destructive/50" : ""
                    }`}
                  >
                    {m.status === "pending" && m.role === "marcos" ? (
                      <div className="flex items-center gap-1 py-1 text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" />
                        <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                      </div>
                    ) : (
                      <div className="space-y-1">{renderContent(m.content)}</div>
                    )}
                    {conf && (
                      <div
                        className={`mt-1 text-xs font-medium ${
                          conf === "yes" ? "text-green-300" : "text-red-300"
                        }`}
                      >
                        {conf === "yes" ? "✓ Confirmado" : "✗ Cancelado"}
                      </div>
                    )}
                    {m.status === "error" && (
                      <div className="mt-1 text-xs text-destructive">
                        Falha ao enviar
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {marcosTyping && (
            <div className="text-xs text-muted-foreground pl-2">Marcos está digitando...</div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex gap-2 pt-2 border-t">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={online ? "Pergunte algo ao Marcos..." : "VPS offline — conecte em /settings"}
          disabled={sending || !online}
          className="flex-1"
        />
        <Button onClick={send} disabled={sending || !input.trim() || !online}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
