import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Trash2, Sparkles, RefreshCw, Square, Wifi, WifiOff, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getToolMeta } from "@/lib/tool-meta";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "Conversar com Marcos — Agente CFO" }] }),
  component: ChatPage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ToolCall = {
  id: string;
  name: string;
  status: "pending" | "done" | "error";
  duration_ms?: number;
  startedAt: number;
};

type ChatRow = {
  id: number | string;
  role: "user" | "marcos" | "system";
  content: string;
  status: "pending" | "sent" | "delivered" | "error" | "streaming" | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  // local-only:
  tools?: ToolCall[];
};

type ConnState = "idle" | "connecting" | "connected" | "disconnected" | "error";

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------
function renderMarkdown(content: string) {
  const normalized = content.replace(/\\n/g, "\n");
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
        ul: ({ node, ...props }) => <ul className="list-disc pl-4 mb-2 last:mb-0" {...props} />,
        ol: ({ node, ...props }) => <ol className="list-decimal pl-4 mb-2 last:mb-0" {...props} />,
        li: ({ node, ...props }) => <li className="mb-0.5" {...props} />,
        code: ({ node, inline, className, children, ...props }: any) =>
          inline ? (
            <code className="bg-background/40 px-1 py-0.5 rounded text-xs font-mono" {...props}>
              {children}
            </code>
          ) : (
            <pre className="bg-background/40 p-2 rounded text-xs font-mono overflow-x-auto my-2">
              <code {...props}>{children}</code>
            </pre>
          ),
        strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
        a: ({ node, ...props }) => (
          <a className="underline text-primary" target="_blank" rel="noreferrer" {...props} />
        ),
        table: ({ node, ...props }) => (
          <div className="overflow-x-auto my-2">
            <table className="text-xs border-collapse" {...props} />
          </div>
        ),
        th: ({ node, ...props }) => <th className="border px-2 py-1 bg-background/40" {...props} />,
        td: ({ node, ...props }) => <td className="border px-2 py-1" {...props} />,
      }}
    >
      {normalized}
    </ReactMarkdown>
  );
}

// ---------------------------------------------------------------------------
// Tool Pill
// ---------------------------------------------------------------------------
function ToolPill({ tool }: { tool: ToolCall }) {
  const meta = getToolMeta(tool.name);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-background/60 border border-border/60 px-2 py-0.5 text-[11px] font-medium my-0.5 mr-1">
      <span>{meta.icon}</span>
      <span className="text-foreground/80">{meta.label}</span>
      <span className="text-muted-foreground font-mono text-[10px]">{tool.name}</span>
      {tool.status === "pending" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {tool.status === "done" && (
        <>
          <Check className="h-3 w-3 text-green-500" />
          {tool.duration_ms != null && (
            <span className="text-muted-foreground text-[10px]">{tool.duration_ms}ms</span>
          )}
        </>
      )}
      {tool.status === "error" && <X className="h-3 w-3 text-destructive" />}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const HISTORY_LIMIT = 50;
const MAX_WS_FAILURES = 3;

function ChatPage() {
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnState>("idle");
  const [streaming, setStreaming] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const wsFailuresRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // streaming buffer accumulator + rAF flush
  const bufferRef = useRef<string>("");
  const toolsRef = useRef<ToolCall[]>([]);
  const currentRequestIdRef = useRef<string | null>(null);
  const currentUserContentRef = useRef<string>("");
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "marcos" || last.status !== "streaming") return prev;
      return [
        ...prev.slice(0, -1),
        { ...last, content: bufferRef.current, tools: [...toolsRef.current] },
      ];
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  // -------------------------------------------------------------------------
  // Boot: user, history
  // -------------------------------------------------------------------------
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
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT);
      const ordered = (msgs ?? []).slice().reverse() as ChatRow[];
      setMessages(ordered);
      setLoading(false);
    })();
  }, []);

  // -------------------------------------------------------------------------
  // WebSocket connect
  // -------------------------------------------------------------------------
  const connect = useCallback(async () => {
    if (wsRef.current && wsRef.current.readyState <= 1) return;
    setConn("connecting");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sem sessão");

      const { data, error } = await supabase.functions.invoke("openclaw-ws-url", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      const { ws_url, gateway_token } = data as { ws_url: string; gateway_token: string };
      const url = `${ws_url}?token=${encodeURIComponent(gateway_token)}`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        wsFailuresRef.current = 0;
        setConn("connected");
      };

      ws.onmessage = (ev) => handleWsMessage(ev.data);

      ws.onerror = () => {
        setConn("error");
      };

      ws.onclose = () => {
        wsRef.current = null;
        setConn("disconnected");
        setStreaming(false);
        // backoff reconnect
        if (wsFailuresRef.current < MAX_WS_FAILURES) {
          wsFailuresRef.current += 1;
          const delay = Math.min(1000 * 2 ** wsFailuresRef.current, 8000);
          reconnectTimerRef.current = window.setTimeout(() => connect(), delay);
        }
      };
    } catch (err) {
      setConn("error");
      wsFailuresRef.current += 1;
      const msg = (err as Error)?.message ?? String(err);
      if (msg.toLowerCase().includes("dormindo") || msg.includes("503")) {
        // VPS offline — não fica em loop
        return;
      }
      if (wsFailuresRef.current < MAX_WS_FAILURES) {
        const delay = Math.min(1000 * 2 ** wsFailuresRef.current, 8000);
        reconnectTimerRef.current = window.setTimeout(() => connect(), delay);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!threadId) return;
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [threadId, connect]);

  // -------------------------------------------------------------------------
  // Handle incoming WS frame
  // Assumed JSON-RPC 2.0 over WS. Adapt when OpenClaw publishes spec.
  // -------------------------------------------------------------------------
  const handleWsMessage = useCallback(
    (raw: unknown) => {
      let msg: any;
      try {
        msg = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        return;
      }

      // event-style: { method: "assistant.delta", params: { text } } OR
      // { type: "assistant.delta", text } — handle both.
      const evt: string = msg.method ?? msg.type ?? msg.event ?? "";
      const params = msg.params ?? msg;

      if (evt === "assistant.delta" || evt === "delta") {
        const chunk: string = params.text ?? params.delta ?? params.content ?? "";
        bufferRef.current += chunk;
        scheduleFlush();
        return;
      }

      if (evt === "tool.use" || evt === "tool_call" || evt === "tool.start") {
        const id = String(params.id ?? params.tool_id ?? Date.now());
        toolsRef.current = [
          ...toolsRef.current,
          { id, name: String(params.name ?? params.tool ?? "tool"), status: "pending", startedAt: Date.now() },
        ];
        scheduleFlush();
        return;
      }

      if (evt === "tool.result" || evt === "tool.end") {
        const id = String(params.id ?? params.tool_id ?? "");
        const isError = params.error != null || params.status === "error";
        toolsRef.current = toolsRef.current.map((t) =>
          t.id === id || (!id && t.status === "pending")
            ? {
                ...t,
                status: isError ? "error" : "done",
                duration_ms: params.duration_ms ?? Date.now() - t.startedAt,
              }
            : t,
        );
        scheduleFlush();
        return;
      }

      if (evt === "done" || evt === "agent.done" || evt === "complete") {
        finalizeStream("done");
        return;
      }

      if (evt === "error" || evt === "agent.error") {
        finalizeStream("error", params.message ?? params.error ?? "Erro do gateway");
        return;
      }

      // JSON-RPC response form: { id, result } or { id, error }
      if (msg.id && (msg.result || msg.error)) {
        if (msg.error) finalizeStream("error", msg.error.message ?? "Erro RPC");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheduleFlush],
  );

  const finalizeStream = useCallback(
    async (kind: "done" | "error", errMsg?: string) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const finalText = bufferRef.current;
      const tools = toolsRef.current;
      const userContent = currentUserContentRef.current;

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "marcos") return prev;
        return [
          ...prev.slice(0, -1),
          {
            ...last,
            content: finalText || (kind === "error" ? `Erro: ${errMsg}` : ""),
            status: kind === "error" ? "error" : "sent",
            tools,
          },
        ];
      });

      setStreaming(false);

      if (kind === "done" && threadId && finalText) {
        // persist user + assistant
        await supabase.from("chat_messages").insert([
          { thread_id: threadId, role: "user", content: userContent, status: "sent" },
          {
            thread_id: threadId,
            role: "marcos",
            content: finalText,
            status: "sent",
            metadata: {
              tools_used: tools.map((t) => ({ name: t.name, status: t.status, duration_ms: t.duration_ms })),
            },
          },
        ]);
      } else if (kind === "error") {
        toast.error(errMsg ?? "Erro do Marcos");
      }

      // reset buffers
      bufferRef.current = "";
      toolsRef.current = [];
      currentRequestIdRef.current = null;
      currentUserContentRef.current = "";
    },
    [threadId],
  );

  // -------------------------------------------------------------------------
  // Send via WS (with fallback)
  // -------------------------------------------------------------------------
  const sendViaWs = useCallback(
    (content: string): boolean => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      const reqId = `req_${Date.now()}`;
      currentRequestIdRef.current = reqId;
      currentUserContentRef.current = content;
      bufferRef.current = "";
      toolsRef.current = [];

      // optimistic local user msg + streaming placeholder
      const now = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        {
          id: `local-u-${reqId}`,
          role: "user",
          content,
          status: "sent",
          metadata: null,
          created_at: now,
        },
        {
          id: `local-m-${reqId}`,
          role: "marcos",
          content: "",
          status: "streaming",
          metadata: null,
          created_at: now,
          tools: [],
        },
      ]);
      setStreaming(true);

      try {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: reqId,
            method: "agent.run",
            params: { message: content, thread_id: threadId },
          }),
        );
        return true;
      } catch {
        return false;
      }
    },
    [threadId],
  );

  const sendViaFallback = useCallback(
    async (content: string) => {
      toast.warning("Conexão direta falhou, usando modo lento");
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) throw new Error("Sem sessão");
        // optimistic
        const now = new Date().toISOString();
        setMessages((prev) => [
          ...prev,
          {
            id: `local-u-${Date.now()}`,
            role: "user",
            content,
            status: "sent",
            metadata: null,
            created_at: now,
          },
        ]);
        const { error } = await supabase.functions.invoke("chat-send-message", {
          body: { content },
          headers: { Authorization: `Bearer ${token}` },
        });
        if (error) throw error;
        // reload history shortly
        setTimeout(async () => {
          if (!threadId) return;
          const { data: msgs } = await supabase
            .from("chat_messages")
            .select("*")
            .eq("thread_id", threadId)
            .order("created_at", { ascending: false })
            .limit(HISTORY_LIMIT);
          setMessages(((msgs ?? []).slice().reverse()) as ChatRow[]);
        }, 1500);
      } catch (err) {
        toast.error(`Falha ao enviar: ${String(err)}`);
      }
    },
    [threadId],
  );

  const send = async () => {
    const content = input.trim();
    if (!content || streaming) return;
    setInput("");
    const ok = sendViaWs(content);
    if (!ok) {
      if (wsFailuresRef.current >= MAX_WS_FAILURES) {
        await sendViaFallback(content);
      } else {
        toast.error("WebSocket não conectado. Tentando reconectar...");
        connect();
      }
    }
  };

  const cancel = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && currentRequestIdRef.current) {
      try {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "agent.cancel",
            params: { id: currentRequestIdRef.current },
          }),
        );
      } catch {
        // ignore
      }
    }
    finalizeStream("done");
  };

  const reconnect = () => {
    wsFailuresRef.current = 0;
    wsRef.current?.close();
    wsRef.current = null;
    connect();
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

  // autoscroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const connDot =
    conn === "connected" ? "bg-green-500" :
    conn === "connecting" ? "bg-yellow-500 animate-pulse" :
    conn === "error" || conn === "disconnected" ? "bg-red-500" :
    "bg-muted-foreground/40";

  const connLabel =
    conn === "connected" ? "ao vivo · streaming via OpenClaw" :
    conn === "connecting" ? "conectando..." :
    conn === "error" ? "falha de conexão" :
    conn === "disconnected" ? "desconectado" :
    "offline";

  const inputDisabled = streaming || conn !== "connected";
  const inputPlaceholder =
    conn === "connected" ? "Pergunte algo ao Marcos..." :
    conn === "connecting" ? "Conectando ao Marcos..." :
    "Marcos está dormindo — verifique em /settings";

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
                {conn === "connected" ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {conn === "connected" ? "ao vivo" : "off"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${connDot}`} />
              {connLabel}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(conn === "disconnected" || conn === "error") && (
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
              const tools = m.tools ?? ((m.metadata as any)?.tools_used as ToolCall[] | undefined) ?? [];
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
                    {tools.length > 0 && !isUser && (
                      <div className="mb-1.5 -ml-0.5">
                        {tools.map((t, i) => (
                          <ToolPill
                            key={(t as ToolCall).id ?? i}
                            tool={
                              "startedAt" in (t as object)
                                ? (t as ToolCall)
                                : { id: String(i), name: (t as any).name, status: (t as any).status ?? "done", duration_ms: (t as any).duration_ms, startedAt: 0 }
                            }
                          />
                        ))}
                      </div>
                    )}
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
