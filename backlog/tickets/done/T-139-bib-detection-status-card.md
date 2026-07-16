# T-139 · [Dashboard] Mostrar estado/progreso de detección de dorsales (paridad con la tarjeta de AI matching)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/bib-detection-status-card`
- **OpenSpec change:** — (UI que lee estado existente; implementado directo, sin OpenSpec)
- **PR:** #195

## Requerimiento
En la página de detalle del evento del fotógrafo (`/dashboard/photographer/events/[id]`) hoy se
muestra el estado del **indexado facial** (AI matching) vía la tarjeta `ai-status-card.tsx`
(idle → indexing → ready). Al habilitar la **detección de dorsales** el backfill corre en background
**sin ningún feedback**: el fotógrafo no ve si está procesando, cuántas fotos van, ni cuándo terminó.

Agregar el equivalente para dorsales, reusando el mismo patrón/UI de `ai-status-card.tsx`. El estado
ya existe y se actualiza solo por el job Inngest `detectPhotoBibs`:
- `events.bib_detection_status`: `idle` / `detecting` / `ready`
- `photos.bib_detection_status` por foto: `pending` / `detected` / `no_bibs`

Solo hay que **leerlo y mostrarlo** (más un conteo de fotos procesadas/con dorsales) — no hay lógica
de detección nueva ni costo AWS nuevo.

## Criterio de aceptación (Definition of Done)
- [ ] En la página del evento del fotógrafo, cuando la detección de dorsales está habilitada, se
      muestra una tarjeta/indicador de estado con `idle`/`detecting`/`done` (paridad visual con la
      de AI matching).
- [ ] Muestra progreso: fotos procesadas vs total (y opcionalmente cuántas tienen dorsales),
      derivado de `photos.bib_detection_status`.
- [ ] No aparece cuando la detección de dorsales está deshabilitada (o muestra el CTA de habilitar,
      igual que hace AI matching).
- [ ] Refresca el estado mientras corre (mismo mecanismo de polling/revalidación que usa la tarjeta
      de AI matching — no reinventar).
- [ ] strings nuevos en `en.json` y `es.json`.
- [ ] test de la lógica de derivación de estado/progreso (falla antes / pasa después).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Referencia a espejar: `src/app/[lang]/dashboard/photographer/events/[id]/ai-status-card.tsx`
  (+ su fuente de estado en `.../events/[id]/actions.ts` y cómo `page.tsx` la monta).
- Familia: T-032 (bib recognition, shipped), T-138 (auditoría — confirmó que el backfill corre pero
  a ciegas para el fotógrafo).
- Estados canónicos ya definidos en `src/lib/inngest/functions/detect-photo-bibs.ts` y las queries
  de `src/database/queries/bib-numbers.ts` — reusar, no redefinir.
- Sin costo AWS: es solo lectura del estado que el job ya persiste.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/bib-detection-status-card`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
