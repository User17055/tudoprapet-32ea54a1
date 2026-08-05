#!/usr/bin/env bash
# Hook PostToolUse: roda o typecheck das edge functions quando uma delas é editada.
#
# Por que existe: `tsconfig.app.json` inclui apenas `src/`, então `npx tsc --noEmit`
# nunca olha para `supabase/functions/`. Foi essa lacuna que deixou o HMAC descartado
# e seis functions sem autenticação sobreviverem sem ninguém notar
# (docs/relatorio-2026-08.md, seção 8). O comando `npm run check:functions` fecha a
# lacuna, mas só se alguém lembrar dele. Este hook não depende de lembrar.
#
# Fail-soft por design: sem Deno instalado, avisa e sai 0. Ambiente sem acesso a
# deno.land/esm.sh (Claude Code na web, por exemplo) não consegue rodar o check, e
# falhar em toda edição ali viraria ruído — o hook seria desligado, e aí não protege
# ninguém em lugar nenhum.

set -o pipefail

payload="$(cat)"

# Extrai tool_input.file_path sem depender de jq, que pode não existir.
file_path="$(printf '%s' "$payload" | node -e '
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    try {
      const j = JSON.parse(raw);
      process.stdout.write(String((j && j.tool_input && j.tool_input.file_path) || ""));
    } catch (_) {
      process.stdout.write("");
    }
  });
' 2>/dev/null)"

# A esmagadora maioria das edições é em src/. Sai calado.
case "$file_path" in
  *supabase/functions/*) ;;
  *) exit 0 ;;
esac

if ! command -v deno >/dev/null 2>&1; then
  echo "check-functions: Deno ausente — typecheck de supabase/functions/ foi PULADO." >&2
  echo "  Instale com 'winget install DenoLand.Deno' (Windows) e rode 'npm run check:functions'." >&2
  exit 0
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
[ -n "$repo_root" ] || exit 0
cd "$repo_root" || exit 0

if ! output="$(npm run --silent check:functions 2>&1)"; then
  echo "check-functions: 'npm run check:functions' falhou depois de editar $file_path" >&2
  echo "$output" >&2
  # 2 devolve a saída ao agente para que ele corrija antes de seguir.
  exit 2
fi

exit 0
