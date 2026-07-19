# T-156 · Skeletons de home y talent/events no cubren hero + heading

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/skeletons-explore-hero-heading`  (tipo = feat | fix | chore | refactor)
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** #215

## Requerimiento
> ajustar bien el layout los loading skeletons de las rutas del home y page
> /dashboard/talent/events, ya que no se están tomando en cuenta todos los
> componentes que se muestran.

Ambas rutas comparten `EventsExploreView` (`src/components/events-explore-view.tsx`),
que renderiza **cuatro** bloques: (1) hero — título grande (`home.heroHeadline1` +
`heroHeadline2`) + subtítulo (`home.heroSubtitle`), (2) barra de búsqueda (con botón
Filters), (3) heading **"Latest events"** (`home.featuredEventsTitle`), (4) grid de cards.

Los skeletons actuales solo dibujan un placeholder de la barra de búsqueda + el grid
de cards (`EventGridSkeleton`), y **omiten el hero (título + subtítulo) y el heading
"Latest events"** → layout shift visible al cargar la página real. Ver screenshots
adjuntos (home pública y explore de talento) para el texto/orden exacto a espejar.

Superficies:
- **Home** (`/[lang]`, `src/app/[lang]/page.tsx`): **no tiene `loading.tsx`** — hay que
  crear `src/app/[lang]/loading.tsx` que espeje el shell + los 4 bloques.
- **Talent explore** (`src/app/[lang]/dashboard/talent/events/loading.tsx`): existe pero
  solo tiene barra + grid; añadir placeholders de hero (título/subtítulo) + heading.

## Criterio de aceptación (Definition of Done)
- [ ] El skeleton de la home (`/[lang]/loading.tsx`, creado) replica el **wrapper actual**
      de `page.tsx` — `mx-auto w-full max-w-[1300px] px-4 pb-10 pt-4 sm:pt-6 sm:px-6 lg:px-8`
      (post-ajuste de padding, ver Notas) — y dentro espeja el shell de `EventsExploreView`:
      placeholders de hero (título + subtítulo), barra de búsqueda, heading "Latest events"
      y grid — sin layout shift al hidratar.
- [ ] `dashboard/talent/events/loading.tsx` añade placeholders de hero (título +
      subtítulo) y del heading "Latest events" sobre lo que ya tiene (barra + grid). El
      wrapper con márgenes lo pone el layout (`talent/layout.tsx`, `pt-4 pb-20 px-4 sm:pt-6
      sm:px-6 lg:px-8` + `gap-6`), así que el loading solo aporta el body espejando el shell.
- [ ] El shell de ambos skeletons usa `flex flex-col gap-6` (valor **actual** de
      `EventsExploreView` tras el ajuste — ya **no** `gap-8`); spacing, `max-w` y alturas
      coinciden con lo real para que el swap no mueva contenido (consistencia con T-128).
- [ ] (Consistencia opcional) revisar `src/app/[lang]/events/loading.tsx`, que comparte
      el mismo shell y omite hero + heading igual — aplicar el mismo fix si es trivial.
- [ ] test de regresión: el markup de cada `loading.tsx` incluye los placeholders de
      hero + heading (no solo barra + grid) — falla antes, pasa después (patrón T-128).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Ajuste de padding previo (2026-07-19, tener en cuenta al ejecutar):** el usuario ya
  ajustó el padding de ambas superficies — mirror estos valores **actuales**, no los viejos:
  - `EventsExploreView` (`events-explore-view.tsx`): shell exterior `gap-8` → **`gap-6`**.
  - Home (`page.tsx`): wrapper `pt-2 sm:pt-10` → **`pt-4 sm:pt-6`** (queda
    `mx-auto w-full max-w-[1300px] px-4 pb-10 pt-4 sm:pt-6 sm:px-6 lg:px-8`).
  - Talent (`talent/layout.tsx`): wrapper `sm:pt-10` → **`sm:pt-6`** (queda
    `pt-4 pb-20 px-4 sm:pt-6 sm:px-6 lg:px-8` + `gap-6`).
  - Estos cambios están **sin commitear** en el working tree al capturar el ticket; si al
    ejecutar ya están en `main`, leer los valores vigentes de esos 3 archivos como fuente
    de verdad en vez de fiarse de estos números.
- Follow-up directo de **T-128** (PR #193), que sincronizó el card skeleton y creó estos
  `loading.tsx` pero dejó fuera el hero y el heading del shell compartido. **No es
  duplicado:** T-128 alineó las cards; esto alinea los bloques de texto que las rodean.
- Solo UI/skeletons — no toca pagos/auth/BD → sin `/code-review`, sin OpenSpec.
- Reusar `Skeleton` (`@/components/ui/skeleton`) y `EventGridSkeleton`
  (`@/components/event-card-skeleton`); no strings visibles nuevos (los skeletons no
  llevan texto).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
