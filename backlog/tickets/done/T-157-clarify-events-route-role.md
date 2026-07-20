# T-157 · [DISEÑO] Clarificar el papel de la ruta `/events` (¿mantener, diferenciar o podar?)

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ~~decisión de producto~~ **resuelta 2026-07-20 → ALIAS** (ver abajo)
- **Rama:** `refactor/events-route-role`  (tipo = refactor)
- **OpenSpec change:** —  (requerimiento ya claro tras la decisión; refactor de routing/SEO, no toca pagos/BD)
- **PR:** #220

## Decisión (2026-07-20): ALIAS

`/events` (el **índice**) pasa a ser un **alias de la home**, no una superficie propia:
- **Anónimo** (incl. Googlebot): `/events` renderiza el **mismo** `EventsExploreView` que la home
  (hero + búsqueda + "Latest events" + grid) — antes era un listado sin hero.
- **Autenticado**: `/events` **redirige** a `/[lang]/dashboard/talent/events` (su superficie logueada).
- **SEO**: `/events` lleva `rel=canonical` → `/[lang]` (la home) para que Google consolide la señal
  en la home en vez de tratarlo como contenido duplicado. Se **quita `/events` del sitemap** (no se
  listan URLs no-canónicas); las URLs de detalle `/events/<slug>` **se quedan** (son las páginas
  reales de cada evento). `robots.ts` sigue permitiendo `/events` (Google debe rastrearlo para ver
  el canonical).
- **Barra de búsqueda** en `/events`: `basePath=/[lang]/events` para que **se quede** en `/events`.
- **Filtro `?status=`**: se **elimina** (solo lo usaba `/events`, nada lo enlazaba).
- **`/events/[shareCode]` (detalle) intacto** — es el backbone del browsing/compra público.
- Entradas internas (footer, empty-state carrito invitado, success checkout invitado, default de
  `EventSearchBar`, rewrite de `safe-next`) siguen apuntando a `/events` válidamente (sigue vivo).

## Requerimiento
> ahora mismo no sé bien qué papel cumple la ruta `/events`, ya que estamos usando
> solo el home page y `/dashboard/talent/events` como la página para explorar eventos.

Aclarar la arquitectura de información: hoy hay **tres** superficies que exploran eventos y
comparten casi todo el código (`ExplorePageContent` / `EventsExploreView` /
`prefetchInitialEvents`). Decidir qué rol cumple `/events` y ejecutar la limpieza/dirección
que resulte.

## Estado actual (verificado en código)
- **Home `/[lang]`** (`page.tsx` → `EventsExploreView`): superficie de exploración pública
  principal. La barra de búsqueda **se queda en `/`** (`basePath=/${lang}`); las cards
  enlazan al detalle público `/events/<code>`. T-124 ya la hace SSR con prefetch de la
  primera página. Incluye hero + "Latest events" + grid.
- **Talent explore `/[lang]/dashboard/talent/events`** (`page.tsx` → `EventsExploreView`):
  equivalente logueado, dentro del chrome del dashboard (`basePath` y `eventLinkPrefix`
  apuntan a `/dashboard/talent/events`).
- **`/[lang]/events`** (`events/page.tsx` → `ExplorePageContent` directo): listado público
  **sin hero ni chrome de dashboard**. **No** es destino de ninguna barra de búsqueda.
  Diferencias reales frente a la home:
  - **Entradas in-app** (todas las que existen): footer "Browse events"
    (`footer.tsx:43`, `lp('/events')`) — la única del nav público; empty-state del carrito
    de invitado (`guest-cart-content.tsx:144`); guards + link de la success de checkout de
    invitado (`checkout/guest/success/page.tsx:26,40,119`); y el **default fallback** del
    search bar (`EventSearchBar.tsx:66`, siempre override­eado donde se monta).
  - **Ninguna barra de búsqueda navega a `/events`**: home → `/`, talent explore →
    `/dashboard/talent/events` (confirmado). Un usuario **logueado** que aterriza en
    `/events` es **reescrito a `/dashboard/talent/events`** (`safe-next.ts:44,49`,
    `rewritePostLoginNext`).
  - Está en el **sitemap** (`sitemap.ts:61`, priority 0.8, `daily`) y en el allow de
    **`robots.ts:10`** (`/events`, `/events/*`) → landing **crawlable/SEO**.
  - Soporta un filtro **`?status=upcoming|completed`** (mapeado a dateFrom/dateTo) que la
    vista de la home **no** pasa.
  - **Sin metadata propia**: no tiene `generateMetadata` ni `metadata` — hereda el default
    del `layout.tsx`, idéntico al de la home. O sea: separada en el sitemap pero sin
    título/descripción SEO distinto.
  - `nav.tsx:40` la trata como "shopping surface" (muestra el icono de carrito).

## Decisión pendiente (elegir una)
- **A) Mantener + diferenciar:** `/events` = catálogo público completo, filtrable y SEO
  (con `status`), enlazado desde el footer; la home queda como landing/marketing con
  "Latest events" destacados que enlazan a `/events`. Documentar la separación.
- **B) Podar/redirigir:** si la home ya es la exploración canónica, redirigir `/events`
  (y `?status=...`) a `/` (o a `/?status=`), quitar el link del footer o repuntarlo a `/`,
  y **actualizar el sitemap** (evitar que apunte a una URL que 301-redirige). Riesgo SEO:
  perder una URL indexada — evaluar antes de podar.
- **C) Invertir:** hacer `/events` la superficie canónica de exploración (con hero) y que
  la home sea marketing que enlaza a `/events`; alinear talent explore igual.

## Criterio de aceptación (Definition of Done)
- [ ] Decisión registrada (A/B/C) con su porqué, incluida la implicación de **SEO/sitemap**
      y del link del **footer**.
- [ ] Implementada la dirección elegida sin dejar rutas huérfanas ni redirects a URLs que
      siguen en el sitemap; `status`/`preset`/`photographer`/`where` se preservan.
- [ ] Si se poda o redirige: revisadas **todas** las entradas — `sitemap.ts`, `robots.ts`,
      `footer.tsx`, empty-state del carrito de invitado, success de checkout de invitado,
      el default de `EventSearchBar.tsx` y el rewrite de `safe-next.ts` — para que ninguna
      URL indexada quede en 404/redirect-loop y ningún link interno apunte a un destino muerto.
- [ ] Sin regresión en la navegación desde la barra de búsqueda (home y talent explore
      siguen navegando a donde deben) ni en `nav.tsx` (icono de carrito en superficies de compra).
- [ ] strings nuevos en `en.json` y `es.json` (si la IA cambia labels/CTAs).
- [ ] test de regresión que cubra el comportamiento elegido (redirect, o el filtro `status`
      exclusivo de `/events`, según el caso).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Solapa** con **T-156** (skeletons de home + talent explore): esa decisión afecta si
  `/events/loading.tsx` sigue existiendo o se alinea con el mismo shell. Coordinar: resolver
  T-157 antes de tocar `/events/loading.tsx` en T-156 (o al menos no podar `/events` sin
  revisar T-156).
- Tocar `/events` implica revisar sus tres consumidores compartidos
  (`ExplorePageContent`, `EventsExploreView`, `prefetchInitialEvents`) para no romper home
  ni talent explore.
- Mismo patrón que **T-129** (blocked por decisión de producto "implementar vs podar"):
  esto es captura + decisión, no implementación a ciegas. No toca pagos/auth/BD.

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
