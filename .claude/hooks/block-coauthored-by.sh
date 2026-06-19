#!/usr/bin/env bash
# Rienda dura: bloquea cualquier `git commit` que incluya el trailer Co-Authored-By.
# Rompe el deploy de Vercel Hobby. El harness lo frena mecánicamente — no depende de que el modelo lo recuerde.
# ponytail: grep sobre el stdin del hook; si algún día hay más reglas de commit, parsear con jq.
set -euo pipefail

input=$(cat)

if grep -qi 'git commit' <<<"$input" && grep -qi 'co-authored-by:' <<<"$input"; then
  echo "Bloqueado: el commit incluye 'Co-Authored-By' (rompe Vercel Hobby). Quita el trailer y reintenta." >&2
  exit 2
fi

exit 0
