# T-099 · [Inngest] Sweeper cron de reconciliación para estados colgados (`indexing` eterno / thumbnails nunca horneados)

- **Prioridad:** P2
- **Estado:** done (PR #163)
- **Blockers:** ninguno
- **Rama:** `fix/indexing-reconcile-sweeper`  (tipo = fix)
- **OpenSpec change:** evaluar al ejecutar (función Inngest nueva + queries)
- **PR:** —
- **Dep:** T-092 (el guard de ready evita que el sweeper re-hornee de más)
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-18**, ítem #20 del plan)

## Requerimiento
Dos superficies de "wedge silencioso" sin camino de recuperación:
1. `ai_matching_status` pasa a `ready` solo cuando el conteo in-flight llega a 0
   (`index-photo-faces.ts:549-554`) — un solo evento Inngest perdido deja el evento en `indexing`
   **para siempre**. La única recuperación hasta ahora fue una migración manual one-off
   (`20260519000002_recover_stuck_indexing_photos.sql`).
2. `emit-processed` es best-effort (`index-photo-faces.ts:557-576`) — un emit perdido significa
   que el thumbnail **nunca se hornea**: la galería cae al `/api/watermark` por-view
   indefinidamente (pagando su costo por siempre).
Un cron de Inngest que reconcilie periódicamente cierra ambos.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** tests de caracterización de las transiciones de estado actuales
      (pending→indexed/no_faces/failed; evento→ready al drenar; thumbnail pending→ready) en verde
      **antes** del cambio
- [ ] Función Inngest cron (p.ej. cada 30-60 min) que: (a) re-encola fotos `pending` más viejas
      que un umbral (p.ej. >1 h) de eventos en `indexing`; (b) marca `ready` eventos cuyo conteo
      in-flight ya es 0 pero quedaron en `indexing`; (c) re-emite el horneado para fotos
      `indexed`/terminal con `thumbnail_status='pending'` viejo
- [ ] El sweeper es idempotente y no interfiere con jobs en curso (umbral de edad + respeta los
      caps de concurrencia existentes)
- [ ] test de regresión que falla antes y pasa después (estado colgado sintético → el sweeper lo
      resuelve)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Registrar la función en `/src/app/api/inngest/route.ts` como las demás.
- Umbrales conservadores: mejor un wedge que tarda 1 h en resolverse que un sweeper que pisa
  trabajo vivo. Loggear cada acción de reconciliación para diagnóstico.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/indexing-reconcile-sweeper`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
