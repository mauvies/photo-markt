# T-089 · [Inngest] Serializar backfills por evento + idempotency keys (doble click = doble gasto AWS)

- **Prioridad:** P2
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `fix/backfill-serialization-idempotency`  (tipo = fix)
- **OpenSpec change:** —  (config de Inngest + keys en sends)
- **PR:** —
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-17**, ítem #6 del plan)

## Requerimiento
Ningún `inngest.send()` del codebase pasa idempotency key, y los dos backfills
(`backfill-event-indexing`, `backfill-event-bib-detection`) no tienen cap de concurrencia. Dos
clicks rápidos en "Re-index event" (`events/[id]/actions.ts:711-733`) → dos backfills concurrentes
→ cada uno fan-out de `photo.uploaded` para las mismas fotos → la misma foto indexada dos veces en
paralelo → **doble gasto AWS** y caras duplicadas (agrava F-11/T-091).

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** tests de caracterización del flujo actual de backfill (lista fotos por
      estado, resetea, fan-out) en verde **antes** del cambio — hay tests de integración de
      Inngest existentes como base (`test/integration/inngest/`)
- [ ] `concurrency: [{ limit: 1, key: 'event.data.eventId' }]` en ambos backfills
- [ ] Idempotency key en los sends de `event.ai-matching-enabled` / `event.bib-detection-enabled`
      (colapsa doble-clicks) — evaluar key determinista por (evento, acción, ventana)
- [ ] test de regresión que falla antes y pasa después (dos backfills concurrentes del mismo
      evento no duplican el fan-out / el segundo espera al primero)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- `backfill-event-indexing.ts:44-48` y `backfill-event-bib-detection.ts:34-38` — hoy sin
  `concurrency`. El fan-out de fotos individuales ya está capado (5/evento) — el gap es el nivel
  backfill.
- Ojo: la idempotencia de Inngest por event-id tiene ventana limitada — documentar qué protege
  (doble click) y qué no (re-index legítimo horas después).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/backfill-serialization-idempotency`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
