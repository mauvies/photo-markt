# T-125 · [Perf] Peso de imágenes de la galería: backfill de thumbnails legacy + variante small + cap de tiles eager

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `perf/gallery-image-weight`
- **OpenSpec change:** —  (probable: toca el pipeline Inngest de thumbnails — decidir al ejecutar)
- **PR:** —

## Requerimiento
Follow-up **F2** de la auditoría de rendimiento T-123 (`docs/PERF_AUDIT.md`). Una galería de evento
de 155 fotos transfiere **~12 MB** de imágenes en la carga móvil (Lighthouse estima 2,7 MiB de
ahorro solo en responsive images). Dos causas que se componen:
1. **Thumbnails que nunca se hornearon:** ~50 de los primeros ~85 tiles del evento medido no tienen
   thumbnail `ready` y caen al preview full-size de `/api/watermark` (~150–190 KB c/u, 7,6 MB) —
   fotos legacy anteriores al pipeline o con estado terminal que el sweeper de T-099 no re-drivea
   (solo re-emite `pending`, no `failed`/faltantes).
2. **El thumb "medium" es grande para un tile de grid** (~110 KB promedio para tiles de ~180px), y
   no hay variante menor; `unoptimized` es deliberado (T-093, coste del optimizador de Vercel), así
   que no hay resize on-the-fly.

Candidatos (confirmar con datos al ejecutar): backfill/re-bake one-off de thumbnails faltantes en
prod; hornear una variante "small" para tiles de grid en `generatePhotoThumbnails` + usarla en los
viewers; cap/estrategia para que el lazy-loading nativo no pre-cargue ~85 de 155 tiles (umbral
móvil enorme), p. ej. placeholder + IntersectionObserver propio o paginación más corta.

## Criterio de aceptación (Definition of Done)
- [ ] Transferencia de imágenes de la galería medida antes/después (documentada en el PR) con
      mejora clara en un evento foto-denso.
- [ ] Las fotos legacy sin thumbnail quedan horneadas (o hay un job/backfill reproducible que lo
      hace), y la galería deja de caer masivamente a `/api/watermark`.
- [ ] Si se añade la variante small: enhebrada end-to-end (bake → status → query → viewer) sin
      romper el fallback `thumbMedium ?? url` ni el re-bake de T-078/T-092.
- [ ] Sin regresión funcional (lightbox, selección, watermark preview, compra).
- [ ] Tests para la lógica nueva (falla antes / pasa después donde aplique).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Origen: T-123 (`docs/PERF_AUDIT.md`, hallazgo F2).
- Tocar el pipeline con cuidado: convenciones `safeCall`, bytes nunca cruzan step boundaries de
  Inngest, ready-guard de T-092, staleness gate de T-099.
- El coste AWS no aplica (thumbnails son Sharp + Storage), pero el re-bake masivo sí toca Storage
  egress — hacerlo idempotente y por lotes.
- Familia: T-093 (unoptimized deliberado), T-099 (sweeper), T-078 (re-bake), T-123.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `perf/gallery-image-weight`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
