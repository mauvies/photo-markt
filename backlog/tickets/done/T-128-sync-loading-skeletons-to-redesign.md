# T-128 · Sincronizar los loading skeletons con el layout/márgenes actuales

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (Dep **T-127** — soft: el skeleton de la card debe reservar el mismo espacio de título de dos líneas)
- **Rama:** `fix/sync-loading-skeletons`  (tipo = fix)
- **OpenSpec change:** —  (solo loading states; requerimiento claro, sin schema/lógica)
- **PR:** #193

## Requerimiento
Los loading skeletons (estados/páginas de carga) se **desincronizaron** de los componentes reales que
representan. Tras cambios de márgenes de página y de varios componentes (rediseño de event card T-119,
rediseño de landing T-118, cambios del detalle de evento), los skeletons ya **no** coinciden con las
dimensiones, spacing ni estructura de lo que renderiza después de cargar → hay **layout shift** / desalineo
visible al aparecer el contenido real.

Revisar y arreglar los skeletons para que reflejen fielmente los componentes actuales (márgenes, spacing,
forma) en: **home (`/`)**, **listado de eventos**, y **detalle de evento (grid de fotos)** — público y el
equivalente del dashboard de talento.

## Estado actual (verificado en el código)
- **Home (`/`)** → `EventsExploreView` → `EventGrid` (`dashboard/talent/events/components/event-grid.tsx`).
  `EventSkeleton` (línea 32) sigue imitando la card **vieja** ("Match ExploreEventCard spacing/layout":
  cover `aspect-square`, título de una línea) — pero T-119 rediseñó la card a **cover 16:10** + **título de
  dos líneas** + filas de info (ubicación+bandera, fecha+hora) + **sección de fotógrafo con divisor**. El
  skeleton no refleja nada de eso → footprint distinto al real.
- **Listado de eventos** (`events/loading.tsx`) → solo `<Spinner />`, **sin** grid skeleton de cards.
- **Explore de talento** (`dashboard/talent/events/loading.tsx`) → solo `<Spinner />`.
- **Detalle de evento público** (`events/[shareCode]/loading.tsx`) → tiene grid `aspect-square` pero con
  `max-w-[1400px]`/`container py-3` que hay que **verificar contra los márgenes actuales** de la página, y
  le faltan los elementos que rodean al grid (barra de búsqueda/dorsal, iconos de acción, área de título).
- **Detalle de evento talento** (`dashboard/talent/events/[id]/`) → revisar si tiene loading equivalente y
  alinearlo igual.
- Primitivo existente: `src/components/ui/skeleton.tsx` — **reutilizarlo**, no crear estilos nuevos.

## Criterio de aceptación (Definition of Done)
- [ ] **Home:** el skeleton de event-card refleja la card rediseñada actual — área de cover (aspect ratio
      correcto), espacio de **título de dos líneas**, filas de info, y sección de fotógrafo — más los
      márgenes/padding actuales de la página. No un bloque genérico.
- [ ] **Listado de eventos:** las cards del skeleton coinciden con la event card actual y los márgenes de
      página (reemplazar el `<Spinner />` por un grid skeleton que iguale el footprint).
- [ ] **Detalle de evento (público y talento):** el skeleton del grid de fotos coincide con el grid real
      (columnas, gaps, aspect ratios) y los márgenes actuales, incluyendo los elementos que lo rodean
      (título, acciones, sección de búsqueda/dorsal si aplica).
- [ ] Layout shift **mínimo/nulo** al reemplazar el skeleton por el contenido real en las tres páginas
      (mismo footprint).
- [ ] Los skeletons **reutilizan el primitivo existente** (`ui/skeleton.tsx`) y quedan visualmente
      consistentes entre páginas (mismo pulse/tonos neutros).
- [ ] Verificado en **mobile y desktop** (grids y márgenes difieren por viewport).
- [ ] test que falle antes / pase después donde tenga sentido (p. ej.: el skeleton de card usa el mismo
      aspect ratio de cover / clases de grid que la card real; el listado ya no es solo `<Spinner />`).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Solo loading states** — **sin cambios** a los componentes reales. Sin libs nuevas, sin estilos de
  skeleton nuevos. Igualar la estructura/márgenes **post-rediseño**, no reintroducir spacing viejo.
- **Ordenar después de T-127** (título de dos líneas): el skeleton de la card debe reservar el mismo espacio
  de título de dos líneas que la card final, si no vuelve a desalinear. Si T-127 aún no está mergeado al
  arrancar, coordinar (merge previo) o replicar la altura de dos líneas acordada allí.
- Relacionado con **T-123** (auditoría Lighthouse/CLS): reducir layout shift ayuda a CLS, pero este ticket
  es de fidelidad visual, no de la auditoría de perf en sí.
- Sin strings nuevos (no cambia copy visible). Sin `any`. Biome. **Sin otros cambios.**

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/sync-loading-skeletons`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
