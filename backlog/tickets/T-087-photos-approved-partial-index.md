# T-087 · [Perf/DB] Índice parcial para la query más caliente de galería + drop del índice duplicado

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `chore/photos-approved-partial-index`  (tipo = chore — migración, sin cambio de comportamiento)
- **OpenSpec change:** —  (migración de índices, semántica de queries intacta)
- **PR:** —
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-24**, ítem #4 del plan)

## Requerimiento
La query más caliente (galería pública y owner) es
`event_id = X AND upload_status = 'approved' ORDER BY taken_at, id` + `.range()`. El único índice
compuesto que toca `upload_status` es parcial `WHERE upload_status <> 'approved'` — **excluye**
justo las filas que esta query lee. Postgres cae al índice `(event_id)` + sort en memoria por
página; en eventos grandes cada página re-ordena todo el set approved. Además hay un índice
duplicado: `photos_event_idx` ≡ `photos_event_id_idx` (ambos `(event_id)`).

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** los tests existentes de paginación de galería
      (`getEventPhotosPublicPage`/`getEventPhotosPage` — orden determinista `(taken_at, id)`,
      ventanas sin solaparse) están en verde **antes** de la migración; si falta alguno de orden
      estable entre páginas, añadirlo primero
- [ ] Migración: `CREATE INDEX photos_event_approved_taken_idx ON photos (event_id, taken_at, id)
      WHERE upload_status = 'approved'`
- [ ] Migración: drop de `photos_event_idx` (duplicado de `photos_event_id_idx`)
- [ ] Los mismos tests de paginación pasan **después** sin cambios (cero cambio de comportamiento
      — el índice solo cambia el plan)
- [ ] Verificación manual (documentada en el PR): `EXPLAIN` de la query de galería usa el índice
      nuevo en local
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Este ticket es deliberadamente "no-behavior-change": el requisito de tests aquí es de
  **caracterización** (el comportamiento observable no debe moverse), no de regresión
  falla-antes/pasa-después.
- Recordar el gotcha de deployment: la migración corre en prod vía `migrate.yml` al mergear;
  el preview build de Vercel usa la BD de prod (no rompe nada aquí porque no hay columna nueva
  que el código lea — un índice es invisible para PostgREST).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `chore/photos-approved-partial-index`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
