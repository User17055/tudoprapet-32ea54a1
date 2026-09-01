#!/usr/bin/env bash
# Descobre qual versão das edge functions está PUBLICADA, comparando com a do repositório.
#
# Por que existe: no Lovable Cloud, sincronizar código e publicar function são
# mecanismos separados. Merge no GitHub NÃO publica — o deploy só roda quando o Lovable
# edita uma function. O código fica certo no repositório, certo no GitHub, certo dentro
# do editor do Lovable, e o que roda em produção é outra coisa. A falha é silenciosa e
# já custou horas (docs/smoke-test-edge-functions.md, Parte 3).
#
# O teste é seguro: um OPTIONS não processa corpo, não dispara WhatsApp, não cria pedido
# e não precisa de credencial nenhuma.
#
# Uso:
#   bash scripts/check-deploy.sh                        # sonda o webhook de retirada
#   bash scripts/check-deploy.sh pickup-validate        # sonda uma específica
#   bash scripts/check-deploy.sh --all                  # sonda todas as do repositorio
#
# Saídas — três, e a distinção importa:
#   0  publicado e na versão do repositório
#   1  respondeu, mas com versão diferente (ou sem o marcador) -> o deploy NÃO rodou
#   2  não deu para alcançar/identificar -> resultado DESCONHECIDO, não conclua nada
#
# Separar 1 de 2 é o ponto: em ambiente sem acesso ao Supabase (Claude Code na web,
# por exemplo, onde a política de egress nega *.supabase.co) um script de duas saídas
# reportaria "não publicado" quando a verdade é "não sei" — e isso manda alguém caçar
# um deploy que já aconteceu.

set -o pipefail

PROJECT_REF="${PROJECT_REF:-smvtnflhkvxdmvqbxwrf}"
BASE_URL="${SUPABASE_FUNCTIONS_URL:-https://${PROJECT_REF}.supabase.co/functions/v1}"
VERSION_HEADER="x-tpp-functions-version"
TIMEOUT="${TIMEOUT:-20}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
cors_file="$repo_root/supabase/functions/_shared/cors.ts"

if ! command -v curl >/dev/null 2>&1; then
  echo "check-deploy: curl não encontrado." >&2
  exit 2
fi

if [ ! -f "$cors_file" ]; then
  echo "check-deploy: não achei $cors_file — rode a partir do repositório." >&2
  exit 2
fi

expected="$(sed -n 's/.*FUNCTIONS_VERSION[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$cors_file" | head -1)"
if [ -z "$expected" ]; then
  echo "check-deploy: não consegui ler FUNCTIONS_VERSION de _shared/cors.ts." >&2
  exit 2
fi

# Derivada do repositório, e não fixa aqui. A lista fixa anterior tinha 13 nomes e
# ficou para trás: não incluía admin-orders, checkout-prepare, checkout-payment nem
# as funções do Asaas. Em 19/08/2026 o `--all` dizia "tudo publicado" enquanto o
# admin-orders em produção estava três dias atrasado — exatamente o silêncio que
# este script existe para quebrar.
ALL_FUNCTIONS="$(find "$repo_root/supabase/functions" -mindepth 1 -maxdepth 1 -type d \
  ! -name '_shared' -exec basename {} \; 2>/dev/null | sort | tr '\n' ' ')"
if [ -z "$ALL_FUNCTIONS" ]; then
  echo "check-deploy: não achei nenhuma function em supabase/functions." >&2
  exit 2
fi

# Functions que legitimamente NÃO carregam o marcador, e por isso não contam como
# atraso. O marcador viaja dentro de `_shared/cors.ts`; quem não importa esse
# módulo não tem como devolvê-lo, esteja publicado ou não.
#
# `mcp` é gerada pela plataforma e não usa o `_shared/`. Antes desta exceção ela
# fazia o `--all` sair com código 1 SEMPRE, inclusive com tudo publicado — e o
# workflow diário roda justamente o `--all`. Alarme que toca todo dia é alarme
# que ninguém lê, que é o contrário do que este script existe para fazer.
#
# A lista de alvos continua derivada do repositório de propósito: a exceção é
# nominal e visível em revisão, não um filtro que possa esconder function nova.
NO_MARKER_FUNCTIONS="mcp"

has_no_marker() {
  for exception in $NO_MARKER_FUNCTIONS; do
    [ "$1" = "$exception" ] && return 0
  done
  return 1
}

case "${1:-}" in
  --all) targets="$ALL_FUNCTIONS" ;;
  "")    targets="shopify-pickup-webhook" ;;
  *)     targets="$*" ;;
esac

echo "Versão no repositório: $expected"
echo "Endpoint: $BASE_URL"
echo

saw_stale=0
saw_unknown=0

for fn in $targets; do
  printf '%-24s ' "$fn"

  if ! resp="$(curl -sS -i -X OPTIONS --max-time "$TIMEOUT" "$BASE_URL/$fn" 2>&1)"; then
    echo "DESCONHECIDO (sem resposta: $(printf '%s' "$resp" | head -1))"
    saw_unknown=1
    continue
  fi

  headers="$(printf '%s' "$resp" | tr -d '\r')"

  # Confirma que quem respondeu foi a function, não o gateway. Sem isso, um 401/403
  # do gateway seria lido como "function publicada sem o marcador" — que é falso.
  if ! printf '%s' "$headers" | grep -qi '^x-served-by:.*supabase-edge-runtime'; then
    status="$(printf '%s' "$headers" | sed -n '1s/^HTTP[^ ]* //p')"
    echo "DESCONHECIDO (respondeu o gateway, não a function — HTTP ${status:-?})"
    saw_unknown=1
    continue
  fi

  found="$(printf '%s' "$headers" | sed -n "s/^[Xx]-[Tt][Pp][Pp]-[Ff]unctions-[Vv]ersion:[[:space:]]*//p" | head -1)"

  if [ -z "$found" ] && has_no_marker "$fn"; then
    echo "SEM MARCADOR (não importa _shared/cors.ts — fora deste controle)"
  elif [ -z "$found" ]; then
    echo "DESATUALIZADO (sem $VERSION_HEADER — versão anterior ao marcador)"
    saw_stale=1
  elif [ "$found" = "$expected" ]; then
    echo "OK ($found)"
  else
    echo "DESATUALIZADO (publicado: $found)"
    saw_stale=1
  fi
done

echo
if [ "$saw_stale" -eq 1 ]; then
  echo "Deploy NÃO rodou para pelo menos uma function."
  echo "Peça ao Lovable que publique as edge functions — é o único caminho hoje."
  echo "Se ele disser que não há o que mudar, force com algo mínimo em _shared/cors.ts."
  exit 1
fi

if [ "$saw_unknown" -eq 1 ]; then
  echo "Resultado DESCONHECIDO: não deu para alcançar o Supabase daqui."
  echo "Rode numa máquina com acesso à internet aberto antes de concluir qualquer coisa."
  exit 2
fi

echo "Tudo publicado na versão $expected."
exit 0
