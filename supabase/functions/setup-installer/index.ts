/**
 * GET /setup-installer?token=xxx
 * Público (verify_jwt=false). Valida token one-time e retorna shell script bash
 * com .install_env.sh já preenchido + curl do setup.sh real.
 */
import { adminClient } from "../_shared/auth.ts";

// Repo do instalador. O script gerado resolve a ÚLTIMA RELEASE publicada em
// runtime e fixa a instalação nessa tag (REPO_REF) — instalação reproduzível;
// um push ruim no main não chega aos clientes. Fallback para main.
const REPO_SLUG = "MindOpsTeam/agente-cfo";

function shEscape(v: string): string {
  return `'${String(v).replace(/'/g, "'\\''")}'`;
}

// Nome no onboarding → nome da pasta de skill no monorepo (quando diferem).
// Ex.: o onboarding salva "rdstation", mas a skill no repo é "rd-station".
const SKILL_NAME_MAP: Record<string, string> = { rdstation: "rd-station" };
const skillName = (n: string) => SKILL_NAME_MAP[n] ?? n;

// IMPORTANTE: os nomes abaixo TÊM que casar exatamente com o que o setup.sh lê
// (CFO_WHATSAPP_TO, CFO_ERP_NAME, OMIE_APP_KEY, CFO_CRM_NAME, ...). Se divergirem,
// o instalador não enxerga os presets e volta a PERGUNTAR tudo no terminal.
function buildEnvVars(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  // Instalação dirigida pelo painel = roda sem perguntas interativas.
  lines.push(`export NONINTERACTIVE=1`);

  const ant = data.anthropic_key as string | undefined;
  if (ant) lines.push(`export ANTHROPIC_API_KEY=${shEscape(ant)}`);

  const wa = data.whatsapp_phone as string | undefined;
  if (wa) lines.push(`export CFO_WHATSAPP_TO=${shEscape(wa)}`);

  const erp = data.erp as { name?: string; credentials?: Record<string, string> } | undefined;
  if (erp?.name && erp.name !== "none") {
    lines.push(`export CFO_ERP_NAME=${shEscape(skillName(erp.name))}`);
    // setup.sh lê credenciais como <ERP>_<CAMPO> (ex.: OMIE_APP_KEY, OMIE_APP_SECRET).
    const prefix = String(erp.name).toUpperCase().replace(/[^A-Z0-9]/g, "_");
    for (const [k, v] of Object.entries(erp.credentials ?? {})) {
      lines.push(`export ${prefix}_${k.toUpperCase()}=${shEscape(String(v))}`);
    }
  }

  // CRM / cobrança / e-commerce: o setup.sh só precisa do NOME pra instalar a skill
  // (as credenciais sincronizam do painel via Vault). "none" → "nenhum" (sentinela
  // que o setup.sh espera) pra NÃO cair em pergunta interativa.
  const crm = data.crm as { name?: string } | undefined;
  lines.push(`export CFO_CRM_NAME=${shEscape(crm?.name && crm.name !== "none" ? skillName(crm.name) : "nenhum")}`);

  const billing = data.billing as { name?: string } | undefined;
  lines.push(`export CFO_COBRANCA_NAME=${shEscape(billing?.name && billing.name !== "none" ? skillName(billing.name) : "nenhum")}`);

  const ecommerce = data.ecommerce as { name?: string } | undefined;
  lines.push(`export CFO_ECOMMERCE_NAME=${shEscape(ecommerce?.name && ecommerce.name !== "none" ? skillName(ecommerce.name) : "nenhum")}`);

  return lines;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return new Response("# erro: token ausente\nexit 1\n", { status: 400 });

  const admin = adminClient();
  const { data: row } = await admin
    .from("installer_tokens")
    .select("token, expires_at, used_at, metadata")
    .eq("token", token)
    .maybeSingle();

  if (!row) return new Response("# erro: token inválido\nexit 1\n", { status: 404 });
  if (row.used_at) return new Response("# erro: token já utilizado\nexit 1\n", { status: 410 });
  if (new Date(row.expires_at) < new Date()) {
    return new Response("# erro: token expirado\nexit 1\n", { status: 410 });
  }

  await admin.from("installer_tokens").update({ used_at: new Date().toISOString() }).eq("token", token);

  const envLines = buildEnvVars((row.metadata ?? {}) as Record<string, unknown>);
  // O painel conhece a própria URL Supabase → injeta pra o setup.sh não perguntar.
  envLines.unshift(`export PANEL_BASE_URL=${shEscape(`${url.origin}/functions/v1`)}`);

  const script = `#!/usr/bin/env bash
# Agente CFO — installer (gerado pelo painel)
set -euo pipefail

echo "==> Configurando variáveis de ambiente do agente..."
mkdir -p "$HOME/.agente-cfo"
cat > "$HOME/.agente-cfo/.install_env.sh" <<'AGENTE_CFO_ENV_EOF'
${envLines.join("\n")}
AGENTE_CFO_ENV_EOF
chmod 600 "$HOME/.agente-cfo/.install_env.sh"
# shellcheck disable=SC1091
source "$HOME/.agente-cfo/.install_env.sh"

echo "==> Resolvendo última release do Agente CFO..."
REPO_REF="$(curl -fsSL https://api.github.com/repos/${REPO_SLUG}/releases/latest 2>/dev/null \
  | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 \
  | sed -E 's/.*"([^"]+)"$/\\1/')"
[ -z "$REPO_REF" ] && { echo "   (sem release publicada — usando main)"; REPO_REF=main; }
export REPO_REF
echo "==> Baixando e executando setup.sh (ref: $REPO_REF)..."
curl -fsSL "https://raw.githubusercontent.com/${REPO_SLUG}/$REPO_REF/install/setup.sh" | bash
`;

  return new Response(script, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
});
