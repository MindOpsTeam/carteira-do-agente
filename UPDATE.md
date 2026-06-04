# Atualizar o painel (para quem já remixou)

> A maior parte das correções do Agente CFO vive no instalador **central**
> (`MindOpsTeam/agente-cfo`) e chega à sua VPS sozinha — você não precisa fazer
> nada. Este guia é só para os **raros** casos em que o **painel** (as edge
> functions) precisa ser atualizado.
>
> A partir da versão "painel burro", o painel manda para a VPS apenas o **JSON do
> onboarding** + o token. Todo o resto (nomes de variáveis, versão do `setup.sh`,
> etc.) é resolvido pelo instalador central. Então, depois de aplicar este guia
> **uma vez**, você dificilmente vai precisar mexer no painel de novo.

## Quando usar

- A instalação na VPS está pedindo dados no terminal (deveria ser automática), **ou**
- Trava no "PASSO 10" com `fatal: especifique diretórios ... --skip-checks`, **ou**
- Você remixou o painel há algum tempo e quer deixá-lo na versão atual.

## Como aplicar (cole no Lovable do SEU painel)

Abra o seu projeto no Lovable e cole **este prompt** no chat:

```
Atualize o painel para a instalação na VPS rodar do início ao fim sem erros e sem
perguntas no terminal. Faça exatamente:

1) Tabela: crie public.panel_config com uma única linha
   (id smallint primary key default 1, panel_token text not null,
    created_at timestamptz not null default now()), RLS LIGADO e SEM policies
   (só o service_role acessa). Rode a migration.

2) supabase/functions/_shared/auth.ts:
   - validatePanelToken deve ser ASSÍNCRONA e validar o header X-Panel-Token
     contra o secret PANEL_TOKEN se existir; senão contra panel_config.panel_token.
   - Adicione getPanelToken() (env-first, fallback no panel_config) e
     ensurePanelToken() (gera e salva um token no panel_config se ainda não houver).
   - Atualize TODOS os callers de validatePanelToken para usar await.

3) supabase/functions/setup-installer:
   - O script bash gerado deve, no fim, RESOLVER a última release de
     MindOpsTeam/agente-cfo em runtime e baixar o setup.sh dela:
       REPO_REF = tag de https://api.github.com/repos/MindOpsTeam/agente-cfo/releases/latest
                  (fallback "main")
       e terminar com:
       curl -fsSL https://raw.githubusercontent.com/MindOpsTeam/agente-cfo/$REPO_REF/install/setup.sh | bash
   - O arquivo .install_env.sh gerado deve exportar APENAS:
       export NONINTERACTIVE=1
       export PANEL_BASE_URL="<url do projeto>/functions/v1"
       export PANEL_TOKEN="<ensurePanelToken()>"
       export CFO_ONBOARDING_B64="<base64 do JSON do onboarding (user_onboarding.data)>"
     NÃO mapeie nomes de campo aqui — o setup.sh central faz isso a partir do JSON.

4) Faça redeploy de TODAS as edge functions (porque _shared/auth.ts é compartilhado)
   e garanta build verde.
```

## Conferindo que deu certo

1. No onboarding, gere um **novo link de instalação**.
2. Rode na VPS. Deve ir do começo ao fim **sem perguntar nada** (o pareamento do
   WhatsApp por QR é feito no painel, não no terminal).

## Desbloqueio imediato (sem mexer no painel)

Se precisar instalar agora, antes de atualizar o painel, rode na VPS — isso baixa
o instalador central já corrigido e **não trava** (só pergunta os dados no terminal):

```bash
rm -rf ~/.agente-cfo ~/.openclaw/workspace/skills 2>/dev/null
curl -fsSL https://raw.githubusercontent.com/MindOpsTeam/agente-cfo/main/install/setup.sh -o /tmp/cfo.sh
bash /tmp/cfo.sh
```
