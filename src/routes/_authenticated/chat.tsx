import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Trash2, Sparkles, RefreshCw, Square, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "Conversar com Marcos — Agente CFO" }] }),
  component: ChatPage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ChatRow = {
  id: number | string;
  role: "user" | "marcos" | "system";
  content: string;
  status: "pending" | "sent" | "delivered" | "error" | "streaming" | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ConnState = "idle" | "checking" | "online" | "offline" | "error";

const HISTORY_LIMIT = 50;
const MAX_SSE_FAILURES = 3;
const SYSTEM_PROMPT =
  "Você é Marcos, CFO virtual do usuário. Responde em português, conciso e direto. " +
  "Tem acesso a integrações (HubSpot, Asaas, Supabase, etc) e pode executar ações via tools. " +
  "Sempre confirme antes de qualquer ação destrutiva ou financeira.";
const STREAM_FLUSH_MS = 150;
const STREAM_TIMEOUT_MS = 3 * 60 * 1000;

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------
function renderMarkdown(content: string) {
  const normalized = content.replace(/\\n/g, "\n");
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ul: ({ node, ...props }) => <ul className="list-disc pl-4 mb-2 last:mb-0" {...props} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ol: ({ node, ...props }) => <ol className="list-decimal pl-4 mb-2 last:mb-0" {...props} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        li: ({ node, ...props }) => <li className="mb-0.5" {...props} />,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        code: ({ inline, children, ...props }: any) =>
          inline ? (
            <code className="bg-background/40 px-1 py-0.5 rounded text-xs font-mono" {...props}>
              {children}
            </code>
          ) : (
            <pre className="bg-background/40 p-2 rounded text-xs font-mono overflow-x-auto my-2">
              <code {...props}>{children}</code>
            </pre>
          ),
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        a: ({ node, ...props }) => (
          <a className="underline text-primary" target="_blank" rel="noreferrer" {...props} />
        ),
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        table: ({ node, ...props }) => (
          <div className="overflow-x-auto my-2">
            <table className="text-xs border-collapse" {...props} />
          </div>
        ),
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        th: ({ node, ...props }) => <th className="border px-2 py-1 bg-background/40" {...props} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        td: ({ node, ...props }) => <td className="border px-2 py-1" {...props} />,
      }}
    >
      {normalized}
    </ReactMarkdown>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function ChatPage() {
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnState>("idle");
  const [streaming, setStreaming] = useState(false);

  const sseFailuresRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const knownIdsRef = useRef<Set<string | number>>(new Set());
  

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const trackId = (id: string | number) => {
    knownIdsRef.current.add(id);
  };

  const upsertMessage = (row: ChatRow) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === row.id);
      if (idx === -1) return [...prev, row];
      const next = prev.slice();
      next[idx] = { ...next[idx], ...row };
      return next;
    });
  };

  // -------------------------------------------------------------------------
  // Boot: user, history, realtime
  // -------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user || !mounted) return;
      const tid = `panel:${u.user.id}`;
      setThreadId(tid);

      const { data: msgs } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("thread_id", tid)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT);
      if (!mounted) return;
      const ordered = ((msgs ?? []) as ChatRow[]).slice().reverse();
      ordered.forEach((m) => trackId(m.id));
      setMessages(ordered);
      setLoading(false);

      // realtime — INSERT only (avoids streaming UPDATE echo loops)
      channel = supabase
        .channel(`chat-${tid}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
            filter: `thread_id=eq.${tid}`,
          },
          (p) => {
            const row = p.new as ChatRow;
            if (knownIdsRef.current.has(row.id)) return;
            trackId(row.id);
            setMessages((prev) => [...prev, row]);
          },
        )
        .subscribe();
    })();
    return () => {
      mounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Connection: SSE goes through edge function chat-stream (CORS proxy).
  // No gateway URL/token in the browser anymore.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!threadId) return;
    setConn("online");
  }, [threadId]);

  // -------------------------------------------------------------------------
  // SSE streaming send
  // -------------------------------------------------------------------------
  const sendViaSse = useCallback(
    async (content: string): Promise<boolean> => {
      if (!threadId) return false;
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token;
      if (!accessToken) {
        toast.error("Sem sessão");
        return false;
      }

      // 1. insert user message
      const { data: userRow, error: userErr } = await supabase
        .from("chat_messages")
        .insert({ thread_id: threadId, role: "user", content, status: "sent" })
        .select()
        .single();
      if (userErr || !userRow) {
        toast.error("Falha ao salvar mensagem");
        return false;
      }
      trackId(userRow.id);
      upsertMessage(userRow as ChatRow);

      // 2. insert placeholder assistant message
      const { data: asstRow, error: asstErr } = await supabase
        .from("chat_messages")
        .insert({ thread_id: threadId, role: "marcos", content: "", status: "streaming" })
        .select()
        .single();
      if (asstErr || !asstRow) {
        toast.error("Falha ao criar placeholder");
        return false;
      }
      trackId(asstRow.id);
      upsertMessage(asstRow as ChatRow);
      const asstId = asstRow.id as number;

      // 3. build short history (last ~10 already-persisted messages)
      const recent = messages.slice(-10).map((m) => ({
        role: m.role === "marcos" ? "assistant" : m.role === "user" ? "user" : "system",
        content: m.content,
      }));
      const payloadMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...recent,
        { role: "user", content },
      ];

      setStreaming(true);
      let buffer = "";
      let lastFlush = Date.now();
      let lastChunk = Date.now();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // timeout watcher
      const timeoutTimer = window.setInterval(() => {
        if (Date.now() - lastChunk > STREAM_TIMEOUT_MS) {
          ctrl.abort();
        }
      }, 10_000);

      const flushToDb = async (final = false, errMsg?: string) => {
        try {
          await supabase
            .from("chat_messages")
            .update({
              content: errMsg ? `${buffer}\n\n_Erro: ${errMsg}_` : buffer,
              status: final ? (errMsg ? "error" : "sent") : "streaming",
            })
            .eq("id", asstId);
        } catch {
          // ignore transient
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstId
              ? {
                  ...m,
                  content: errMsg ? `${buffer}\n\n_Erro: ${errMsg}_` : buffer,
                  status: final ? (errMsg ? "error" : "sent") : "streaming",
                }
              : m,
          ),
        );
        lastFlush = Date.now();
      };

      try {
        const supaUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
        const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
        const res = await fetch(`${supaUrl}/functions/v1/chat-stream`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            messages: payloadMessages,
            max_tokens: 2048,
          }),
          signal: ctrl.signal,
        });

        if (res.status === 401) {
          throw new Error("Sessão expirada — recarregue a página");
        }
        if (res.status === 503) {
          const t = await res.text().catch(() => "");
          throw new Error(t || "Marcos offline");
        }
        if (res.status === 404) {
          throw new Error("Modo streaming desabilitado na VPS. Pedir admin ativar.");
        }

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") {
              await flushToDb(true);
              window.clearInterval(timeoutTimer);
              setStreaming(false);
              abortRef.current = null;
              sseFailuresRef.current = 0;
              return true;
            }
            try {
              const json = JSON.parse(payload);
              const delta = json.choices?.[0]?.delta?.content ?? "";
              if (delta) {
                buffer += delta;
                lastChunk = Date.now();
                if (Date.now() - lastFlush > STREAM_FLUSH_MS) {
                  await flushToDb(false);
                }
              }
            } catch {
              // ignore non-JSON keepalives
            }
          }
        }
        // stream ended without [DONE]
        await flushToDb(true);
        window.clearInterval(timeoutTimer);
        setStreaming(false);
        abortRef.current = null;
        sseFailuresRef.current = 0;
        return true;
      } catch (err) {
        window.clearInterval(timeoutTimer);
        setStreaming(false);
        abortRef.current = null;
        const aborted = (err as Error)?.name === "AbortError";
        const errMsg = aborted ? "Cancelado pelo usuário" : (err as Error)?.message ?? String(err);
        await flushToDb(true, errMsg);
        if (!aborted) {
          sseFailuresRef.current += 1;
          toast.error(errMsg);
        }
        return aborted ? true : false;
      }
    },
    [threadId, messages, fetchGateway],
  );

  // -------------------------------------------------------------------------
  // Legacy fallback
  // -------------------------------------------------------------------------
  const sendViaFallback = useCallback(
    async (content: string) => {
      toast.warning("SSE indisponível, usando modo lento");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast.error("Sem sessão");
        return;
      }
      const { error } = await supabase.functions.invoke("chat-send-message", {
        body: { content },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) toast.error(`Falha: ${String(error)}`);
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Send dispatcher
  // -------------------------------------------------------------------------
  const send = async () => {
    const content = input.trim();
    if (!content || streaming) return;
    setInput("");

    if (sseFailuresRef.current >= MAX_SSE_FAILURES) {
      await sendViaFallback(content);
      return;
    }

    const ok = await sendViaSse(content);
    if (!ok && sseFailuresRef.current >= MAX_SSE_FAILURES) {
      await sendViaFallback(content);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const reconnect = async () => {
    sseFailuresRef.current = 0;
    gatewayCacheRef.current = null;
    try {
      await fetchGateway(true);
      toast.success("Reconectado");
    } catch (err) {
      toast.error(`Falha: ${(err as Error)?.message ?? String(err)}`);
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
    knownIdsRef.current.clear();
    setMessages([]);
    toast.success("Histórico limpo");
  };

  // autoscroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const connDot =
    conn === "online" ? "bg-green-500" :
    conn === "checking" ? "bg-yellow-500 animate-pulse" :
    conn === "offline" || conn === "error" ? "bg-red-500" :
    "bg-muted-foreground/40";

  const connLabel =
    conn === "online" ? "conectado · streaming SSE" :
    conn === "checking" ? "verificando..." :
    conn === "offline" ? "Marcos offline" :
    conn === "error" ? "erro de conexão" :
    "—";

  const inputDisabled = streaming || conn === "offline";
  const inputPlaceholder =
    conn === "online" ? "Pergunte algo ao Marcos..." :
    conn === "checking" ? "Conectando..." :
    conn === "offline" ? "Marcos está offline — verifique em /settings" :
    "Pergunte algo ao Marcos...";

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="font-semibold leading-tight flex items-center gap-2">
              Marcos — seu CFO virtual
              <span className="inline-flex items-center gap-1 text-[11px] font-normal px-1.5 py-0.5 rounded-full bg-muted/50">
                {conn === "online" ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {conn === "online" ? "online" : "off"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${connDot}`} />
              {connLabel}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(conn === "offline" || conn === "error") && (
            <Button variant="ghost" size="sm" onClick={reconnect}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Reconectar
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={clearHistory} disabled={messages.length === 0}>
            <Trash2 className="h-4 w-4 mr-1" />
            Limpar
          </Button>
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1 my-3">
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
            messages.map((m) => {
              const isUser = m.role === "user";
              const isStreaming = m.status === "streaming";
              return (
                <div
                  key={m.id}
                  className={`flex animate-in fade-in slide-in-from-bottom-1 duration-200 ${
                    isUser ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`${isUser ? "max-w-[80%]" : "max-w-[90%]"} rounded-2xl px-4 py-2 text-sm break-words ${
                      isUser
                        ? "bg-primary text-primary-foreground whitespace-pre-wrap"
                        : "bg-muted text-foreground"
                    } ${m.status === "error" ? "border border-destructive/50" : ""}`}
                  >
                    {isUser ? (
                      <div>{m.content}</div>
                    ) : m.content ? (
                      <div className="leading-relaxed">
                        {renderMarkdown(m.content)}
                        {isStreaming && (
                          <span className="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse align-text-bottom" />
                        )}
                      </div>
                    ) : isStreaming ? (
                      <div className="flex items-center gap-1 py-1 text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" />
                        <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                        <span className="ml-2 text-xs">Marcos pensando...</span>
                      </div>
                    ) : null}
                    {m.status === "error" && !m.content && (
                      <div className="text-xs text-destructive">Falha ao receber resposta</div>
                    )}
                  </div>
                </div>
              );
            })
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
          placeholder={inputPlaceholder}
          disabled={inputDisabled}
          className="flex-1"
        />
        {streaming ? (
          <Button onClick={cancel} variant="destructive">
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={send} disabled={inputDisabled || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
