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

function buildEnvVars(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const ant = data.anthropic_key as string | undefined;
  if (ant) lines.push(`export ANTHROPIC_API_KEY=${shEscape(ant)}`);

  const wa = data.whatsapp_phone as string | undefined;
  if (wa) lines.push(`export WHATSAPP_OWNER_PHONE=${shEscape(wa)}`);

  const erp = data.erp as { name?: string; credentials?: Record<string, string> } | undefined;
  if (erp?.name && erp.credentials) {
    lines.push(`export ERP_NAME=${shEscape(erp.name)}`);
    for (const [k, v] of Object.entries(erp.credentials)) {
      lines.push(`export ${k.toUpperCase()}=${shEscape(String(v))}`);
    }
  }

  const crm = data.crm as { name?: string; credentials?: Record<string, string> } | undefined;
  if (crm?.name && crm.credentials) {
    lines.push(`export CRM_NAME=${shEscape(crm.name)}`);
    for (const [k, v] of Object.entries(crm.credentials)) {
      lines.push(`export ${k.toUpperCase()}=${shEscape(String(v))}`);
    }
  }
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
