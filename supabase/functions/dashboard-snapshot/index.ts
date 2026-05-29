/**
 * GET/POST /dashboard-snapshot
 * Lê o snapshot mais recente persistido em dashboard_snapshots (pushado pela VPS).
 * Auth: JWT Supabase do dono logado no front Lovable.
 */

import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EMPTY_SNAPSHOT = {
  kpis: {
    balance_brl: 0,
    receivables_30d_brl: 0,
    payables_30d_brl: 0,
    pipeline_weighted_brl: 0,
    ecommerce_revenue_month_brl: 0,
    overdue_total_brl: 0,
  },
  by_channel_revenue_30d: [],
  pipeline_by_stage: [],
  cash_projection_90d: [],
  top_debtors: [],
  integrations_health: [],
  empty: true,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Auth JWT ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Authorization header obrigatório", 401);
  }

  const anonKey =
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) {
    return errorResponse("Configuração do painel incompleta", 500);
  }

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    anonKey,
    { global: { headers: { Authorization: authHeader } } },
  );

  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    return errorResponse("JWT inválido ou expirado", 401);
  }

  const supabase = adminClient();

  const { data: latest } = await supabase
    .from("dashboard_snapshots")
    .select("data")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.data) {
    return jsonResponse(latest.data);
  }

  return jsonResponse({
    as_of: new Date().toISOString(),
    ...EMPTY_SNAPSHOT,
  });
});
