# T-176 · El carrito parpadea el estado vacío antes de renderizar los ítems

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/cart-empty-state-flash`  (tipo = feat | fix | chore | refactor)
- **OpenSpec change:** —  (bug acotado; se decide al ejecutar si toca >1 archivo)
- **PR:** #235

## Requerimiento
Al navegar al carrito con ítems dentro, la página primero renderiza el estado "tu carrito está
vacío" y **después** salta al estado correcto con ítems. El estado vacío **nunca** debe mostrarse
cuando el carrito tiene ítems.

**Modo del ticket:** diagnóstico primero (la diagnosis determina el fix). NO arreglar con un delay
artificial ni ocultando el estado vacío brevemente — hay que **distinguir los estados** de verdad:
"todavía no cargó" ≠ "está vacío".

## Criterio de aceptación (Definition of Done)
- [ ] Navegar al carrito con ítems **nunca** muestra el estado vacío, ni momentáneamente.
- [ ] Un carrito genuinamente vacío sí muestra el estado vacío, y pronto.
- [ ] Mientras carga, se renderiza un **skeleton** consistente con el primitivo existente (`@/components/ui/skeleton`).
- [ ] Funciona para carritos autenticado **e** invitado.
- [ ] Causa raíz documentada; sin delays artificiales.
- [ ] Sin `any`; formato Biome; queries en `/database/queries/`.
- [ ] Test de regresión que falla antes y pasa después.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas — diagnóstico ya realizado
**El bug es del carrito de INVITADO, no del autenticado.**

- Dos rutas: invitado `src/app/[lang]/cart/` → `GuestCartContent` (`guest-cart-content.tsx`);
  autenticado `src/app/[lang]/dashboard/talent/cart/` → `CartContent` (`cart-content.tsx`). El page
  de invitado redirige a logueados al dashboard, así que `/cart` solo renderiza para invitados.
- **Causa raíz (invitado):** el estado vacío se gatea solo con `items.length === 0`
  (`guest-cart-content.tsx`, el `if (items.length === 0)` previo al return). Los ítems viven en
  `localStorage` y `GuestCartProvider` (`src/components/guest-cart-provider.tsx`) arranca en
  `useState([])` y solo los carga en un `useEffect` de montaje → en el primer render cliente
  `items === []` aunque el carrito tenga ítems. Ese `[] → items` es el parpadeo. El provider ya
  distingue el estado con un flag interno `hydrated`, **pero no lo expone** en el context value.
- **NO es un bug de fuentes divergentes:** el header de invitado (`GuestCartLinkButton`) lee del
  mismo `useGuestCart()` que la página, y solo se muestra con `count > 0`, así que nunca muestra un
  estado incorrecto. (A diferencia de bugs previos: auth page `['cart-data']` vs header `['cart-count']`.)
- **El autenticado NO parpadea:** `dashboard/talent/cart/page.tsx` es `force-dynamic`, hace
  `getCurrentCart()` server-side y lo pasa como `initialCartData` (`initialData` de la query), así que
  el primer paint ya trae datos; además el flash del merge post-login ya está cubierto por la vista
  `merging` (skeleton). O sea: el fix aplica **solo** al carrito de invitado.
- **Fix recomendado:** exponer el flag `hydrated` desde `GuestCartProvider` (agregarlo a
  `GuestCartContextValue` y al value; ya está trackeado) y, en `GuestCartContent`, antes del check de
  vacío, `if (!hydrated) return <skeleton>` reusando el primitivo `Skeleton` (espejar el bloque
  skeleton de tres filas del carrito autenticado, `cart-content.tsx` rama `merging`). Así el estado
  vacío solo aparece cuando la hidratación confirma que el carrito realmente está vacío.
- Test: ya existe `test/unit/components/guest-cart-content.test.tsx` (`@vitest-environment happy-dom`,
  RTL) — extenderlo con la regresión (no-hidratado ⇒ skeleton, no estado vacío).

## Notas de cluster
Familia **Carrito** (T-111/T-112, T-162/T-163/T-165) — toca `guest-cart-content.tsx` /
`guest-cart-provider.tsx`. Coordinar merge si algún otro ticket de carrito está en vuelo.

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
