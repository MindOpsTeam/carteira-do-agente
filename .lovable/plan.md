# Refinamento UX/UI — deltas sobre o estado atual

A maior parte do redesign já está aplicada do turno anterior (sidebar em dois grupos com Administração colapsável, header sem OpenClaw, dashboard com "ao vivo"/"desconectado", "venda(s) pendente(s)", título "Painel Financeiro", saudação sem emoji, tokens violet `oklch(0.68 0.22 290)`). Este plano cobre só o que ainda diverge da nova especificação.

## Mudanças

### 1. `src/components/app-sidebar.tsx`
- Remover item "Conversar com Marcos" do grupo principal (não consta na nova lista).
- Mover "Alertas" do grupo Administração para o grupo principal (entre Automações e Integrações).
- Resto fica como está (header com BarChart2 + "Agente CFO" + "CFO Digital", grupo Administração colapsável com persistência em localStorage, ícones atuais mantidos — `Server`, `Cpu`, etc).

Grupo principal final:
Painel · Relatórios · Metas · Automações · Alertas · Integrações · Configurações

Grupo Administração final:
Instâncias · Observabilidade · Eventos · Custo LLM · Auditoria

### 2. `src/components/app-header.tsx`
Nada a fazer — OpenClaw e suas variáveis já foram removidas.

### 3. `src/styles.css` — bloco `.dark`
- `--primary-foreground`: trocar de `oklch(0.208 0.042 265.755)` para `oklch(0.98 0 0)` (branco puro, contraste com violet).
- `--sidebar-ring`: trocar de `oklch(0.551 0.027 264.364)` para `oklch(0.68 0.22 290)`.
- Restante dos tokens violet já está aplicado.

### 4. `src/routes/_authenticated/index.tsx`
Nada a fazer — copy já está em "ao vivo"/"desconectado", "venda(s) pendente(s)", título "Painel Financeiro", saudação direta sem emoji.

## Detalhes técnicos
- Nenhuma rota, edge function ou lógica de dados é tocada.
- A rota `/chat` continua existindo; apenas o link da sidebar sai (acesso continua via Cmd+K e botões "Marcos: cobrar?" no card de cobranças).
