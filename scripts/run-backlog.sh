#!/usr/bin/env bash
# Ejecuta el backlog en serie: mientras haya un ticket `todo`, corre /work-next.
# Uso: ./scripts/run-backlog.sh [max_tickets]   (por defecto 5)
# ponytail: serie simple. Para reintentos o paralelismo, cambiar el while por una cola.
set -euo pipefail
cd "$(dirname "$0")/.."

max="${1:-5}"
for ((i = 1; i <= max; i++)); do
  if ! grep -qE '\|\s*todo\s*\|' BACKLOG.md; then
    echo "Backlog sin tickets ejecutables. Fin."
    exit 0
  fi
  echo "=== Ticket $i/$max ==="
  claude -p "/work-next" --permission-mode acceptEdits
done
echo "Llegado al máximo de $max tickets."
