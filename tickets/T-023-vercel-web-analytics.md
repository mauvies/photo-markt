# T-023 · Analytics de producto con Vercel Web Analytics

- **Prioridad:** P2
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `feat/vercel-web-analytics`
- **OpenSpec change:** —  (integración mínima)
- **PR:** —

## Requerimiento
Parte de «preparar la app para producción». Hoy **no hay analytics**: sin visibilidad de tráfico ni de embudo.
Integrar **Vercel Web Analytics** (one-liner al estar desplegados en Vercel) para métricas de páginas vistas y visitas.

## Estado actual (verificado)
- Sin Vercel Analytics / GA / Plausible / PostHog. Cero dependencias de analytics en `package.json`.

## Criterio de aceptación (Definition of Done)
- [ ] `@vercel/analytics` instalado; `<Analytics />` montado en `src/app/layout.tsx`
- [ ] (Opcional, mismo PR) `@vercel/speed-insights` con `<SpeedInsights />` para Core Web Vitals
- [ ] Solo activo en producción (el SDK ya no envía en dev por defecto; verificar que no rompa tests/SSR)
- [ ] Sin claves i18n nuevas (no es UI visible)
- [ ] No interfiere con el layout existente ni con el provider de traducciones
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Mantener la integración **mínima**: nada de eventos custom todavía, solo pageviews/visitas base.
- Si se hace T-024 (banner de cookies), el consentimiento debe **gatear** la carga de analytics — por eso
  T-024 depende de este ticket. Dejar el `<Analytics />` montado de forma que sea fácil condicionarlo luego.
- Toca `layout.tsx`, igual que T-024 → ejecutar en serie (este primero).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/vercel-web-analytics`.
2. Acotado → implementar directo (sin OpenSpec).
3. Montar `<Analytics />` (+ Speed Insights opcional).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/vercel-web-analytics`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
