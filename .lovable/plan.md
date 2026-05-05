## Objetivo

Criar apenas a **tela de login** do painel administrativo do Agente CFO, usando Supabase Auth com fluxo de **email + código OTP** (sem senha). Nenhuma outra tela, tabela ou entidade será criada agora — aguardamos as migrations SQL e instruções futuras.

## Escopo desta entrega

1. Habilitar Lovable Cloud (Supabase) no projeto.
2. Criar a rota pública `/login` como página inicial do painel.
3. Implementar o fluxo OTP em duas etapas dentro da mesma tela:
   - **Etapa 1 — Email:** usuário digita o email e recebe um código de 6 dígitos.
   - **Etapa 2 — Código:** usuário digita o código recebido para autenticar.
4. Após autenticar com sucesso, redirecionar para `/` (placeholder simples "Autenticado" por enquanto, já que nenhuma outra tela foi definida).
5. Tratamento de estados: loading, erro (email inválido, código incorreto/expirado), botão "reenviar código" e "trocar email".

## UX da tela

- Layout centralizado, card único, identidade sóbria condizente com SaaS B2B financeiro (Agente CFO): tipografia limpa, paleta neutra com um tom de destaque, sem ilustrações.
- Cabeçalho com nome "Agente CFO" e subtítulo "Painel administrativo".
- Componentes shadcn já presentes: `Card`, `Input`, `Button`, `Label`, `InputOTP`, `Sonner` (toasts para erros/sucesso).
- Mensagens em português.

```text
┌─────────────────────────────┐
│        Agente CFO           │
│   Painel administrativo     │
│                             │
│  [ email@empresa.com    ]   │
│  [   Enviar código →    ]   │
└─────────────────────────────┘

         ↓ após envio

┌─────────────────────────────┐
│   Código enviado para       │
│   email@empresa.com         │
│                             │
│   [ _ _ _ _ _ _ ]           │
│   [    Entrar       ]       │
│   Reenviar · Trocar email   │
└─────────────────────────────┘
```

## Detalhes técnicos

- Frontend: TanStack Start, rota em `src/routes/login.tsx`, substituir o placeholder de `src/routes/index.tsx` por uma página mínima protegida que mostra "Autenticado como {email}" + botão de logout (apenas para validar o fluxo end-to-end; será trocada quando vierem as próximas telas).
- Auth: cliente do browser `@/integrations/supabase/client`.
  - Envio do código: `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`.
  - Verificação: `supabase.auth.verifyOtp({ email, token, type: 'email' })`.
  - Sessão observada via `onAuthStateChange` em um provider leve (`AuthProvider`) que expõe `user` e `signOut`.
- Guarda de rota: layout pathless `src/routes/_authenticated.tsx` com `beforeLoad` checando `supabase.auth.getUser()`; se não autenticado, `redirect({ to: '/login' })`. A home `/` passa a viver em `src/routes/_authenticated/index.tsx`.
- Sem tabela `profiles`, sem `user_roles`, sem schema customizado nesta etapa — apenas `auth.users` nativo do Supabase.
- Sem RLS / migrations agora; serão adicionadas quando o schema chegar.

## Fora de escopo (aguardando instruções)

- Multi-tenant (organizações, membros, convites).
- Tabelas de domínio do CFO (clientes, transações, etc.).
- Telas internas do painel (dashboard, listagens, settings).
- Roles/permissões.
- Login social, recuperação de senha, MFA adicional.
