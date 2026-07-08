# T-090 · [Inngest/Bug] El re-index de caras re-paga `DetectText` — el worker de dorsales no chequea el estado por foto

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/bib-detection-skip-already-detected`  (tipo = fix)
- **OpenSpec change:** —  (guard en un worker)
- **PR:** —
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-12**, ítem #7 del plan)

## Requerimiento
`detect-photo-bibs` se suscribe a `photo.uploaded` (`detect-photo-bibs.ts:62`) — el mismo evento
que el backfill de caras re-emite al re-indexar — y solo chequea el flag **a nivel evento**
(`:98`), nunca el `bib_detection_status` **por foto**. Consecuencia: click en "Re-index event"
(caras) → re-corre `DetectText` (AWS, pago) sobre fotos cuyos dorsales ya estaban detectados.
Peor caso: deshabilitar→rehabilitar AI matching re-paga DetectText de **todo el evento**.
La dirección inversa ya está bien resuelta: el backfill de dorsales usa su propio evento
`photo.bib-detect` justamente para no re-disparar caras/thumbnails — copiar ese criterio.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** tests de caracterización del gate actual del worker (no-op si el
      evento no optó por bibs; corre si optó) en verde **antes** del cambio
- [ ] El worker hace skip (sin descargar imagen ni llamar AWS) cuando la foto ya tiene
      `bib_detection_status` terminal (`detected`/`no_bibs`/equivalente), salvo re-detección
      explícita vía `photo.bib-detect`
- [ ] Re-indexar caras de un evento con dorsales ya detectados no produce llamadas `DetectText`
- [ ] test de regresión que falla antes y pasa después (re-emisión de `photo.uploaded` sobre foto
      con bibs detectados → skip)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Decisión de diseño menor al ejecutar: skip por estado (mínimo) vs. desuscribir el worker de
  `photo.uploaded` y que el flujo de upload emita `photo.bib-detect` explícito (más limpio,
  más invasivo). El skip por estado alcanza para cerrar el costo.
- El gate debe permitir la re-detección legítima del backfill de dorsales (`photo.bib-detect`
  lista solo null/`failed` — ya filtra bien en `backfill-event-bib-detection.ts:184`).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/bib-detection-skip-already-detected`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
