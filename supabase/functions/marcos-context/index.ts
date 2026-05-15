/**
 * GET /marcos-context → { system_prompt, hash, source }
 * Fonte canônica do system prompt do Marcos. Cache 5min em memória.
 * ?refresh=1 força bypass do cache.
 */
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/auth.ts";
import { getMarcosContext } from "../_shared/marcos-context.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);
  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";
  const ctx = await getMarcosContext(force);
  return jsonResponse(ctx);
});
