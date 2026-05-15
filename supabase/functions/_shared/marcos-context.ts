/**
 * _shared/marcos-context.ts
 * Fonte canônica do system prompt do Marcos (com cache em memória 5min).
 * Tenta buscar da VPS via `${ingress_url}/v1/marcos/context`.
 * Fallback: prompt default mínimo se VPS offline.
 */
import { adminClient } from "./auth.ts";

type Payload = { system_prompt: string; hash: string; source: string };
type CacheEntry = { fetchedAt: number; payload: Payload };

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: CacheEntry | null = null;

const FALLBACK_PROMPT = `Você é Marcos, CFO virtual da empresa.
Responda em português, de forma clara, direta e sem rodeios.
Use ferramentas (bash, scripts, MCP servers) quando precisar de dados reais —
nunca invente números. Reporte custos, riscos e próximas ações com objetividade.`;

async function fetchFromVps(): Promise<Payload | null> {
  const supabase = adminClient();
  const { data: vps } = await supabase
    .from("instances")
    .select("ingress_url, openclaw_dashboard_token, last_heartbeat")
    .not("ingress_url", "is", null)
    .not("openclaw_dashboard_token", "is", null)
    .order("last_heartbeat", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!vps?.ingress_url || !vps?.openclaw_dashboard_token) return null;
  const lastHb = vps.last_heartbeat ? new Date(vps.last_heartbeat).getTime() : 0;
  if (Date.now() - lastHb > 5 * 60 * 1000) return null;

  try {
    const url = `${vps.ingress_url.replace(/\/$/, "")}/v1/marcos/context`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Bearer ${vps.openclaw_dashboard_token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    const json = await resp.json() as { system_prompt?: string; hash?: string };
    if (!json.system_prompt) return null;
    return {
      system_prompt: String(json.system_prompt),
      hash: String(json.hash ?? ""),
      source: "vps",
    };
  } catch {
    return null;
  }
}

export async function getMarcosContext(force = false): Promise<Payload> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.payload;
  }
  const fresh = await fetchFromVps();
  const payload: Payload = fresh ?? {
    system_prompt: FALLBACK_PROMPT,
    hash: "fallback",
    source: "fallback",
  };
  cache = { fetchedAt: Date.now(), payload };
  return payload;
}
