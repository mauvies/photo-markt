# T-180 · Añadir hora de finalización de la sesión del evento

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/event-session-end-time`  (tipo = feat)
- **OpenSpec change:** —  (probable: toca >1 archivo — migración + wizard + edit + display; decidir al ejecutar)
- **PR:** —

## Requerimiento
Hoy un evento tiene **hora de inicio** de la sesión (`session_time`, manual, T-106) pero **falta la hora de finalización**. Añadir una **hora de finalización de la sesión** para que el fotógrafo pueda indicar el rango horario (p. ej. "09:30 – 12:00"), no solo cuándo empezó.

## Criterio de aceptación (Definition of Done)
- [ ] Nueva columna `events.session_end_time` (`time`, **nullable**) — espejo exacto de `session_time` (T-106): naive local time-of-day, sin timezone, opcional; cuando null el comportamiento es idéntico a hoy.
- [ ] Campo de hora de fin en el **wizard de crear evento** (`steps/step-3-details.tsx`), junto a la hora de inicio existente.
- [ ] Campo de hora de fin en el **form de editar evento** (`edit/components/event-form-fields.tsx`).
- [ ] Persistencia end-to-end: schemas (`wizard.schema.ts`, `edit-event-schema.ts`), types (`wizard-types.ts`), storage del wizard (`wizard-storage.ts`), actions (`new/actions.ts`, `edit/actions.ts`), y el `select`/insert/update de `database/queries/events.ts`.
- [ ] Display: `EventMetaLine` / `formatSessionTime` (`src/lib/format-date.ts`) muestra el **rango** cuando hay inicio **y** fin (p. ej. "09:30 – 12:00"); solo inicio si no hay fin (comportamiento actual intacto); superficies que consumen `sessionTime` (event card, página pública `events/[shareCode]`, evento del talento, grid del talento) reciben y muestran el fin.
- [ ] **Validación:** si se define fin, debe existir inicio y `fin > inicio` (decidir mensaje/comportamiento; ver Notas). Ambos siguen siendo opcionales.
- [ ] strings nuevos (label del campo de fin + posible error de validación) en `en.json` y `es.json`.
- [ ] test de regresión/feature que falla antes y pasa después (persistencia del nuevo campo + formato del rango en el display).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.
- [ ] Sin `any`; Biome; sin otros cambios.

## Notas
- **Espejo de T-106** (`session_time`): replicar exactamente ese patrón simplifica el scope. Migración de referencia: `supabase/migrations/20260712000000_add_session_time_to_events.sql`. La nueva migración añade `session_end_time time` con el mismo comentario/racional (naive local, nullable, rollback inerte).
- **Superficie ya mapeada** (los mismos archivos que tocan `session_time` — `grep session_time`): `database/queries/events.ts`, `wizard.schema.ts`, `wizard-types.ts`, `new/actions.ts`, `wizard-storage.ts`, `wizard.tsx`, `steps/step-3-details.tsx`, `edit/edit-event-schema.ts`, `[id]/page.tsx`, `edit/actions.ts`, `edit/components/event-form-fields.tsx`, `edit/edit-event-form.tsx`, `edit/scoped-event-edit-form.tsx`, `edit/event-form-data.ts`, `talent/events/components/event-grid.tsx`, `talent/events/[id]/page.tsx`, `events/[shareCode]/page.tsx`, `components/event-card.tsx`, `components/event-meta-line.tsx`, `hooks/use-event-search.ts`, ambos diccionarios.
- **Decisiones menores a resolver al ejecutar (no bloquean):**
  - Formato del rango: "09:30 – 12:00". Definir el separador y reusar `formatSessionTime` para formatear cada extremo (mismo locale).
  - Validación `fin > inicio`: preferible en el schema Zod (parte del wizard y del edit). Fin sin inicio: rechazar o ignorar (recomendado: exigir inicio si hay fin).
- **NO confundir** con los campos de time-sync de cámara (`time_offset`/`time_sync_enabled`) ni con `start_date`/`end_date` del evento — esto es la hora **de la sesión** manual, solo display, como T-106.
- **Coordinación:** **T-178 (tabs) ya aterrizó** (PR #238) y decidió **mantener `/edit` como única superficie de edición** (el card de Details enlaza ahí), así que las dos superficies a tocar siguen siendo `steps/step-3-details.tsx` (wizard) y `edit/components/event-form-fields.tsx` (ruta `/edit`) — el refactor de tabs no las movió.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/event-session-end-time`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
