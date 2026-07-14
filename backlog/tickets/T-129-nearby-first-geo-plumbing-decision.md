# T-129 · [DISEÑO] "Nearby first": implementar la geolocalización del buscador de eventos o podar el plumbing muerto

- **Prioridad:** P2
- **Estado:** blocked
- **Blockers:** decisión de producto — el usuario aún no sabe si quiere la feature (implementar) o simplificar (podar)
- **Rama:** `feat/nearby-first-events` (opción a) o `refactor/prune-geo-plumbing` (opción b)
- **OpenSpec change:** —  (si se elige la opción (a), crear al ejecutar — toca varios archivos y hay diseño de UX que capturar)
- **PR:** —

## Requerimiento
Hallazgo de T-124 (PR #185): el camino de geolocalización "nearby first" del buscador de eventos está
**muerto end-to-end**. El plumbing existe en todas las capas — `useEventSearch` acepta
`lat`/`lng`/`radiusKm`, `searchEventsAction` los pasa, y `searchPublicEvents` los soporta en SQL
(incluido el fallback de "columna no existe" por migración pendiente) — pero **nada llama a
`navigator.geolocation`** y ningún caller pasa `lat`/`lng`. La justificación histórica de mantener el
grid client-side era este ordenamiento por cercanía; T-124 ya documentó que no existe y server-renderiza
el orden por defecto (`date_desc`).

Decidir y ejecutar **una** de las dos:

- **(a) Implementar "nearby first" de verdad:** pedir geolocalización al usuario (con su prompt de
  permiso), y re-ordenar/re-fetchear **client-side ENCIMA del primer paint sembrado por T-124** —
  el SSR sigue sirviendo `date_desc` al instante y la re-ordenación llega después, sin layout shift
  brusco ni doble parpadeo del grid (la decisión de T-124 ya deja este camino abierto). Definir UX:
  ¿prompt automático o botón "cerca de mí"?, ¿radio por defecto (el hook ya contempla 25 km)?,
  ¿persistir la elección?
- **(b) Podar el plumbing:** quitar `lat`/`lng`/`radiusKm` de `useEventSearch` (estado + query key +
  ambos call sites de `searchEventsAction`), los params de `searchEventsAction`, los props muertos
  `_initialLat`/`_initialLng`/`_initialRadius` de `EventSearchBar`, `radiusKm`/`setRadiusKm` de
  `EventFilterBar`, y el camino lat/lng + fallback de migración de `searchPublicEvents`. Menos
  superficie de API que mantener y testear; re-introducirlo después es mecánico si la feature revive.

## Criterio de aceptación (Definition of Done)
- [ ] Decisión (a) o (b) tomada por el usuario y registrada en este ticket antes de ejecutar.
- [ ] **Si (a):** el grid inicial sigue siendo el SSR `date_desc` de T-124 (sin regresión de LCP); la
      re-ordenación por cercanía ocurre client-side tras el permiso, sin layout shift brusco; denegar
      el permiso deja el orden por defecto sin errores; UX del prompt/radio definida y aplicada;
      strings nuevos en `en.json` y `es.json`.
- [ ] **Si (b):** cero referencias restantes a `lat`/`lng`/`radiusKm`/geolocalización en el stack del
      buscador de eventos (hook, action, search bar, filter bar, capa de queries); `grep` limpio;
      sin cambio de comportamiento visible (el camino ya estaba muerto).
- [ ] test de regresión/feature que falla antes y pasa después (si (b): caracterización de que la
      búsqueda sigue idéntica sin los params).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Origen: T-124 / PR #185 (`prefetchInitialEvents` documenta en código que no existe camino geo hoy).
- La opción (a) se apoya en la decisión de T-124: SSR sirve el orden por defecto y cualquier
  ordenamiento geo debe re-ordenar client-side sobre ese primer paint — así el LCP ganado no se pierde.
- La opción (b) toca los mismos archivos que cualquier trabajo futuro sobre el buscador
  (`use-event-search.ts`, `explore-page-content.tsx`, `EventSearchBar`, `EventFilterBar`) — ejecutar
  con la cola de tickets de ese código mergeada para evitar conflictos.
- Relacionado conceptualmente con T-034 (otra decisión de producto pendiente sobre el buscador), pero
  independiente en código.

## Constraints
- No mezclar las dos opciones: es un either/or, un solo PR.
- Si (a): sin nuevas libs — `navigator.geolocation` nativo; Shadcn/Tailwind existentes para cualquier UI.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama según la opción elegida.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
