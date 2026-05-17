# Remover forçamento de dark mode

Apenas o `src/routes/__root.tsx` força dark mode (via `useEffect` que adiciona `dark` ao `<html>`). Nenhum outro arquivo aplica essa classe.

## Mudança

**`src/routes/__root.tsx`** — no `RootComponent`:
- Remover o `useEffect` que faz `document.documentElement.classList.add("dark")`.
- Remover `useEffect` do import de `react` (continua usando `useState`).

Resultado: o app passa a usar o tema light por padrão (`:root` em `styles.css` já define fundo branco). A sidebar mantém sua identidade visual porque usa tokens `--sidebar-*` próprios, definidos tanto em `:root` quanto em `.dark` — não são afetados.

## Não muda

- `src/styles.css` (tokens permanecem)
- Sidebar e seus tokens
- Qualquer outra rota ou componente
