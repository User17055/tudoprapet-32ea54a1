#!/usr/bin/env bash
# Hook SessionStart: diz, na abertura da sessão, o que este ambiente consegue verificar.
#
# O ponto não é instalar nada — é evitar a falsa confiança. Sem Deno, os comandos
# `check:functions` e `lint:functions` simplesmente não rodam, e uma sessão que não
# sabe disso conclui "está tudo verde" tendo verificado só metade do repositório.
#
# Nunca bloqueia o início da sessão: sai 0 em todos os caminhos.

set -o pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)"
[ -n "$repo_root" ] || exit 0
cd "$repo_root" || exit 0

notes=""
add_note() { notes="${notes}  - $1"$'\n'; }

if [ ! -d node_modules ]; then
  add_note "node_modules/ ausente — rode 'npm install' antes de 'npm run test' ou 'npx tsc --noEmit'."
fi

if ! command -v deno >/dev/null 2>&1; then
  if curl -sS -o /dev/null --max-time 8 https://deno.land/install.sh >/dev/null 2>&1; then
    add_note "Deno ausente, mas deno.land responde — instale com 'winget install DenoLand.Deno' (Windows) ou 'curl -fsSL https://deno.land/install.sh | sh'."
  else
    add_note "Deno ausente e deno.land inacessível: 'npm run check:functions' e 'npm run lint:functions' NAO rodam nesta sessão."
    add_note "Para habilitar, a política de egress precisa liberar deno.land, dl.deno.land e esm.sh (as functions importam de esm.sh)."
    add_note "Enquanto isso, supabase/functions/ fica sem typecheck aqui — trate mudanças nessa pasta como não verificadas."
  fi
fi

if [ -n "$notes" ]; then
  printf '[tudopraper] Verificação de ambiente:\n%s' "$notes"
fi

exit 0
