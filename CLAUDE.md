# CLAUDE.md — carteira-do-agente

> Mantenha ENXUTO. Claude Code lê isto em todo turno.

## Stack
- TanStack Start (SSR) · TypeScript · Supabase · Tailwind · gerenciador: bun

## Comandos
- Instalar: `bun install`
- Dev: `bun run dev`
- Testar: `<preencher>`        # SEMPRE rodar antes de dizer "pronto"
- Lint/typecheck: `bun run lint` / `<preencher>`
- Build: `bun run build`

## Convenções
- Commits: conventional commits. Branches: `feature/…`, `fix/…`, `wip/…`.
- Nunca commitar `.env`/segredos (gitleaks bloqueia no pre-commit).
- Projeto com gitsync Lovable: commit → push → prompt no Lovable (MCP) pra aplicar/deploy/migrations. Edge functions NÃO deployam daqui.

## Regras para o agente
- Plan mode antes de edição não-trivial.
- Verificação obrigatória: mostre o output do teste, não afirme "funciona".
