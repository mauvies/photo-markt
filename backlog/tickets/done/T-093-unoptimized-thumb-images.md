# T-093 · [Perf/Imágenes] `unoptimized` en grid y covers para fuentes `/api/` (no re-optimizar thumbs ya horneados)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `perf/unoptimized-thumb-images`  (tipo = perf)
- **OpenSpec change:** —  (dos componentes, patrón ya existente en el carousel)
- **PR:** #153
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-21**, ítem #10 del plan)

## Requerimiento
Las dos superficies de mayor volumen pasan WebP **ya horneado** por la optimización de imágenes de
Vercel: la grilla (`photo-album-viewer.tsx:440`) y las cards de evento (`event-card.tsx:243`)
renderizan `<Image>` sin `unoptimized` con `src=/api/thumb/...webp` — `/_next/image` re-encodea
un WebP que Inngest ya generó al tamaño justo. Quema CPU y **cuota de transformaciones del plan
Hobby** sin ahorrar egress (el thumb ya es chico e inmutable). El carousel ya lo hace bien:
`unoptimized={src.includes('/api/')...}` (`photo-carousel.tsx:164`). Unificar el criterio.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** tests de caracterización de qué `src` reciben la grilla y las cards
      (thumb vs fallback firmado/watermark) en verde **antes** del cambio — si no existen a nivel
      componente, cubrir la lógica de selección de fuente (`thumbSmall/thumbMedium ?? url`)
- [ ] Grid y covers marcan `unoptimized` cuando la fuente es `/api/` (mismo predicado que el
      carousel — extraer helper compartido para que no diverjan de nuevo)
- [ ] Las fuentes que NO son `/api/` (covers firmados de Supabase, avatares) siguen pasando por
      el optimizador (ahí sí aporta)
- [ ] Verificación manual documentada en el PR: la grilla sirve `/api/thumb/...` directo (sin
      `/_next/image?url=...`) en dev/preview
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- `srcSet`/`sizes`: con `unoptimized` Next no genera variantes de ancho — irrelevante aquí porque
  los thumbs ya vienen en dos tamaños fijos (small/medium) elegidos por el viewer.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `perf/unoptimized-thumb-images`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
