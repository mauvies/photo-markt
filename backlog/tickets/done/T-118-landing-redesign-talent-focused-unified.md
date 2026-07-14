# T-118 · Rediseño del landing: enfocado en talento, home público/autenticado unificado, header simplificado

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/landing-explore-and-photographer-entry`
- **OpenSpec change:** — (se implementó directo; la unificación resultó un requerimiento claro apoyado en el patrón paginado ya existente)
- **PR:** #179

## Requerimiento
El landing actual mezcla dos audiencias (talentos que buscan fotos + fotógrafos, vía la sección de
pricing), lo cual confunde. Reenfocar el landing 100% en la experiencia de talento/búsqueda, **unificarlo**
con la página "Explore" del dashboard de talento (una sola página; el header se adapta al estado de auth),
achicar el hero, y simplificar el header de talento autenticado. Sacar el pricing del landing (pero
**conservar el componente** en el codebase para una futura página de fotógrafos).

### Parte 1 — Simplificar el contenido del landing (`/`)
De arriba a abajo queda: **hero compacto** (solo el título, achicarlo algo, **sin** el subtítulo
descriptivo; el hero **NO** debe ocupar el alto completo del viewport) → **search bar** (el `EventSearchBar`
existente) → **todos los eventos con paginación "Load more"** (reusar el patrón paginado existente, **no**
volcar todos los eventos de una) → **footer**. Quitar todo lo demás del landing: **pricing**, **How It
Works** (3 pilares) y **Final CTA**.
- El componente de pricing (`src/components/pricing-section.tsx`) **se conserva** en el codebase,
  **sin referenciar**, con un comentario indicando que queda reservado para la futura landing de
  fotógrafos. (No construir esa página aquí.)
- **Ojo (investigar):** el landing hoy muestra `FeaturedEvents` (solo top events, NO paginado). El
  requisito pide **todos los eventos con "Load more"** → reusar el listado paginado que ya existe en la
  "Explore" de talento (`/dashboard/talent/events`) o en `/events`, no `FeaturedEvents`.

### Parte 2 — Unificar landing público y "Explore" de talento en una sola página
La misma página sirve el landing público (`/`) y la experiencia "Explore"/home del talento autenticado. Un
talento que visita `/` **se queda en `/`** (sin redirect a una ruta de dashboard) — solo el **header** se
adapta al estado de auth. **No** cambia el redirect por-evento existente (talento autenticado en
`/events/[code]` → `/dashboard/talent/events/[code]` **se queda igual**). Este ticket unifica solo la
home/explore, no las páginas de detalle de evento.
- Hoy `/dashboard/talent/page.tsx` hace `redirect → /dashboard/talent/events` (esa es la "Explore" del
  talento). Tras la unificación, `/` cumple ese rol para el talento.

### Parte 3 — Header adaptativo por auth (reusar comportamiento existente)
- **No autenticado:** header con Login / Sign up (comportamiento actual del `Nav`).
- **Talento autenticado:** patrón autenticado actual — **carrito (solo cuando tiene ítems)** + **avatar** —
  **más** una nueva entrada de **favoritos** (heart). Sin Login/Sign up.
- **Orden (lado derecho), cuando hay ítems:** `[carrito si no-vacío] [ícono corazón/favoritos] [avatar]`.

### Parte 4 — Simplificar la navegación de talento autenticado
- **Quitar** los nav links de talento actuales (Explore, Favorites, Orders, Profile) — en
  `talent-dashboard-header.tsx` (`talentNavLinks`, líneas ~56-61) — ya que Explore ahora es la home (`/`) y
  el resto se mueve.
- **Favoritos:** deja de ser nav link. Añadir un **ícono corazón en el header, a la izquierda del avatar**
  (orden de la Parte 3), que enlaza a la página de favoritos existente (`/dashboard/talent/favorites`).
- **Orders y Profile:** mover al **dropdown del avatar** (`DashboardUserMenu`).
- **NO** reestructurar las rutas de favorites/orders/profile — siguen en sus URLs actuales; solo cambia el
  **punto de entrada** en el header (corazón + dropdown en vez de nav links). Cualquier reorg de rutas es
  otro ticket futuro.

## Criterio de aceptación (Definition of Done)
- [ ] El landing es: hero compacto (solo título, sin subtítulo, **no** full-height) → search → eventos
      paginados ("Load more") → footer. Sin pricing ni otras secciones de audiencia mixta.
- [ ] El componente de pricing sigue en el codebase, **sin referenciar**, comentado como reservado para la
      futura página de fotógrafos.
- [ ] La misma página sirve `/` para visitantes no autenticados **y** talentos autenticados; un talento en
      `/` se queda en `/` con header adaptado (sin redirect).
- [ ] Header: no autenticado muestra Login/Sign up; talento autenticado muestra `[carrito si no-vacío]
      [corazón favoritos] [avatar]`.
- [ ] Se quitan los nav links de talento; Favoritos se alcanza por el ícono corazón; Orders y Profile
      viven en el dropdown del avatar.
- [ ] Favorites/orders/profile siguen funcionando en sus URLs actuales (sin reorg de rutas, sin links
      rotos).
- [ ] El redirect por-evento (talento autenticado en `/events/[code]`) **no cambia**.
- [ ] Los eventos cargan con la paginación existente, no todos de una.
- [ ] Todos los strings en `en.json` y `es.json`.
- [ ] tests de regresión/feature que fallan antes y pasan después (p. ej.: el landing no renderiza pricing
      ni how-it-works; el header autenticado de talento muestra corazón + dropdown con Orders/Profile y
      **no** los nav links; el landing usa el grid paginado, no `FeaturedEvents`).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas (investigación previa)
- **Landing actual:** `src/app/[lang]/page.tsx` — hero full-height (`min-h-[calc(100svh-4rem)]`, título +
  subtítulo + `EventSearchBar`), `FeaturedEvents` (top events), `PricingSection`, "How It Works" (3
  pilares), "Final CTA". Quitar pricing/how-it-works/CTA; compactar hero; cambiar `FeaturedEvents` por el
  listado paginado de todos los eventos.
- **Headers (dos hoy):** el layout raíz (`src/app/[lang]/layout.tsx`) monta `<Nav />`
  (`src/components/nav.tsx`) en `/`. El dashboard de talento usa `src/components/talent-dashboard-header.tsx`
  (nav links + `CartLinkButton` + `DashboardUserMenu`). **Decisión de diseño a capturar en OpenSpec:** cómo
  queda el header unificado en `/` para el talento autenticado (¿el `Nav` adopta el patrón cart+heart+
  dropdown del talento? ¿o `/` usa el header de talento cuando hay sesión de talento?), y cómo se comporta
  el header en las demás páginas `/dashboard/talent/*` tras quitar los nav links. Coordinar con:
  `DashboardUserMenu` (dropdown), `bottom-nav-account.tsx` / bottom nav mobile (los links de talento
  también viven ahí en mobile), `CartLinkButton`, `UserAvatar`.
- **Listado paginado de eventos a reusar:** buscar el grid de eventos con "Load more" que ya existe (en
  `/dashboard/talent/events` o `/events`) — reusarlo en el landing, **no** reconstruirlo ni usar
  `FeaturedEvents`.
- **Favoritos:** la página existe (`/dashboard/talent/favorites`); solo cambia el punto de entrada (heart
  en el header). No tocar su lógica.
- **Solape con T-114** (el ícono del carrito desplaza los items del header): T-118 reestructura el mismo
  header derecho — si ambos siguen vivos, coordinar (T-114 es un fix acotado de layout-shift; podría
  absorberse o quedar obsoleto según cómo quede el header unificado). Revisar al ejecutar.
- **Mobile:** hoy el header de talento se cae en mobile y cart/avatar viven en la bottom nav
  (`bottom-nav-account.tsx`). Definir en OpenSpec el comportamiento mobile del header unificado + favoritos.

## Constraints
- Reusar search bar, event grid, paginación/"Load more", cart, favoritos y avatar-dropdown existentes — no
  reconstruirlos.
- Conservar el componente de pricing; solo quitar su uso del landing.
- Componentes Shadcn existentes; sin nuevas libs de UI. Sin `any`. Biome.
- No reestructurar rutas ni cambiar el redirect de detalle de evento. **Sin otros cambios.**

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/landing-redesign-talent-focused`.
2. `/opsx:propose` → `/opsx:apply` (feature grande/ambigua: capturar el diseño del header unificado y la unificación de páginas antes de codear).
3. Implementar + tests de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. `/opsx:archive` del change.
