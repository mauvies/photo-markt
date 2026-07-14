# T-124 · [Perf] Server-renderizar los eventos iniciales del grid de home/explore (LCP driver #1 de T-123)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (pero lleva una decisión de producto embebida: qué orden mostrar sin geolocalización — ver Notas)
- **Rama:** `perf/ssr-initial-events-grid`
- **OpenSpec change:** —  (se crea al ejecutar si el diseño lo amerita)
- **PR:** #185

## Requerimiento
Follow-up **F1** de la auditoría de rendimiento T-123 (`docs/PERF_AUDIT.md`). El grid de eventos de
home (`/`) y del Explore de talento se fetchea **client-side después de la hidratación**:
`EventsExploreView` monta `ExplorePageContent` con `loadOnMount={true}` y sin `initialEvents`, así
que en móvil throttled la cadena del LCP es HTML → JS → hydrate → POST del search action → render →
request de imagen (~6.5s de LCP medido). `/events` **ya** pre-fetchea server-side cuando hay
`where`/`status` en la URL (`src/app/[lang]/events/page.tsx`) — extender ese mismo patrón a la
vista default para que las primeras cards (y su cover `priority`) viajen en el HTML inicial.

## Criterio de aceptación (Definition of Done)
- [ ] La vista default de home/explore renderiza la primera página de eventos server-side
      (`initialEvents`), con las covers `priority` presentes en el HTML inicial (preload efectivo).
- [ ] Decisión documentada sobre el orden inicial sin geolocalización (hoy el client-fetch existe
      para ordenar "nearby first" tras obtener la ubicación): p. ej. servir orden por defecto
      (fecha/destacados) en SSR y re-ordenar client-side cuando llegue la geolocalización, sin
      layout shift brusco ni doble parpadeo del grid.
- [ ] Sin regresión funcional en búsqueda/filtros/"Load more" (los tests existentes en verde).
- [ ] Lighthouse antes/después en `/` documentado en el PR (se espera mejora clara de LCP).
- [ ] Test de regresión/feature que falla antes y pasa después.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Origen: T-123 (`docs/PERF_AUDIT.md`, hallazgo F1 — el lever de LCP más grande disponible).
- Reusar el patrón de pre-fetch de `/events` (matchedCity/matchedCountry + `searchEventsAction`);
  `ExplorePageContent`/`useEventSearch` ya aceptan `initialEvents`/`initialTotal`.
- Cuidado con `staleTimes`/cachés: la home es dinámica por searchParams; medir que el SSR extra no
  duplique el POST del cliente (con `initialEvents` el hook ya deja la query seeded).
- Familia: T-118 (vista compartida home/explore), T-123.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `perf/ssr-initial-events-grid`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
