# T-091 · [Inngest/Bug] Re-index duplica caras: borrar caras previas (AWS + `photo_faces`) antes de re-indexar

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/delete-faces-before-reindex`  (tipo = fix)
- **OpenSpec change:** —  (evaluar al ejecutar; toca worker + query layer)
- **PR:** —
- **Dep:** T-089 (serialización primero — sin ella, dos re-index concurrentes compiten con el delete)
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-11**, ítem #8 del plan)

## Requerimiento
`index-photo-faces` nunca borra las caras previas antes de re-indexar: `deleteFacesFromCollection`
existe (`face-indexing.ts:148`) con **cero callers**. AWS mintea un `FaceId` nuevo en cada
`IndexFaces`, así que el unique `(photo_id, aws_face_id)` no dedupea entre corridas, y
`addPhotoFace` es insert plano (`rekognition.ts:133`). Toda foto `failed`/`indexing` con caras
parcialmente persistidas que el backfill re-indexa **acumula** filas en `photo_faces` y caras en
la colección AWS (costo de storage Rekognition creciente). La búsqueda sigue correcta (dedupe por
`photo_id` en query) — es un bug de costo/crecimiento de datos, no de resultados.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** tests de caracterización del flujo actual indexar→persistir (los de
      `test/integration/inngest/index-photo-faces.test.ts`) en verde **antes** del cambio; añadir
      uno que documente el estado actual de re-index si falta
- [ ] Antes de `IndexFaces` en un re-index, se borran las caras previas de la foto: filas de
      `photo_faces` + `DeleteFaces` en la colección AWS (best-effort con `safeCall`; el borrado
      AWS fallido no debe romper el re-index — documentar el trade-off)
- [ ] Re-indexar una foto con caras ya persistidas termina con exactamente el set nuevo (sin
      acumulación)
- [ ] test de regresión que falla antes y pasa después (re-index → no duplica filas)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Orden importa: borrar filas DB **después** de que AWS confirme el delete (o aceptar huérfanas
  AWS con retry) — decidir al ejecutar. Bytes nunca cruzan step boundaries (convención existente).
- La limpieza de lo ya acumulado en prod (si existe) puede ser una migración/script one-off
  separado — fuera de este ticket, anotar si se detecta volumen.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/delete-faces-before-reindex`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
