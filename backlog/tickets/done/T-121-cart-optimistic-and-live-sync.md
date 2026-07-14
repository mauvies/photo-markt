# T-121 · Carrito: updates optimistas (add/remove) + fix "la página del carrito no refleja ítems nuevos hasta refrescar"

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/cart-optimistic-and-live-sync`
- **OpenSpec change:** —  (estado de cliente + reuso del hook optimista existente; UI/bug con requerimiento claro)
- **PR:** #181
- **Cluster:** Carrito/previews & integridad — coordinar con T-115/T-116/T-117 (mismo código de carrito; merge previo)

## Requerimiento
Dos problemas relacionados de estado del carrito.

### Parte 1 — Bug: la página del carrito no refleja los ítems recién agregados hasta refrescar
Con el carrito vacío, agregar fotos desde un evento y luego navegar a la página del carrito → se ve vacía
(o stale) hasta un **refresh manual**, aunque el **ícono/contador del header sí actualiza al instante**. Esa
inconsistencia es la pista: header y página del carrito leen de **fuentes distintas**.

### Parte 2 — Updates optimistas (add y remove) con rollback + toast al fallar
Hacer **ambas** mutaciones optimistas: al click, el ítem aparece/desaparece y el contador incrementa/
decrementa **antes** de la confirmación del server. Al fallar: **rollback exacto** al estado previo + **toast**
("No se pudo añadir la foto al carrito, inténtalo de nuevo" / "Couldn't add the photo to your cart, please
try again"; equivalente para remove). El rollback debe restaurar el estado exacto (ítem dentro/fuera,
contador corregido) para que la UI nunca diverja del server.

**Requisito de consistencia:** tras este ticket, el **contador del header**, la **página del carrito**, y
cualquier **indicador "en carrito"** por-foto leen de **una sola fuente reactiva** compartida — no de
snapshots separados.

## Estado actual (verificado en el código)
- **Contador del header:** `useCartItemCount()` (`src/hooks/use-cart-item-count.ts`) → React Query
  `['cart-count']` (solo un **número**), con `getCartItemCountAction`.
- **Página del carrito autenticado** (`/dashboard/talent/cart`): `page.tsx` es server component, llama
  `getCurrentCart()` y pasa `initialCartData` a `CartContent`, que usa su **propio** `useQuery`
  (`queryFn: getCurrentCart`, `initialData: initialCartData`). → **Fuente distinta** al `['cart-count']` del
  header. **Causa raíz probable:** la página sirve un **snapshot server/RSC (router cache) stale** al navegar
  (renderizado cuando el carrito estaba vacío) y/o su `useQuery` no re-fetchea ni se invalida al agregar; el
  header sí actualiza porque el hook optimista escribe en `['cart-count']`.
- **Hook optimista ya existente:** `src/hooks/use-optimistic-photos-in-cart.ts` — ya hace add/remove
  optimista del badge `['cart-count']` (`setQueryData`) + un `Set` para el indicador "en carrito"
  (`PhotoIconButtons`), con **rollback** en `onError` y `toastLabels` (failedAdd/failedRemove). **PERO** no
  actualiza la lista de ítems de la **página** del carrito. → **Reusar/extender este hook, no crear uno
  paralelo.**
- **Carrito de invitado** (`/cart`, `guest-cart-content.tsx`): lee `useGuestCart()` (context reactivo,
  `guest-cart-provider.tsx`) → ya actualiza en vivo. El bug es principalmente el **carrito autenticado**
  (snapshot server). Igual verificar que el invitado también quede optimista con rollback+toast.
- **Nota:** T-101 (PR #166) ya quitó el `router.refresh()` del `add-to-cart-button` (dejó la invalidación de
  `['cart-count']`). No reintroducir refresh global.

## Criterio de aceptación (Definition of Done)
- [ ] Agregar fotos a un carrito vacío y navegar a la página del carrito **muestra los ítems al instante**,
      sin refresh manual.
- [ ] El ícono/contador del header, la página del carrito y los indicadores "en carrito" leen de **la misma
      fuente reactiva** y quedan en sync (a través del optimismo y de cualquier rollback).
- [ ] Add-to-cart optimista: ítem + contador actualizan al instante al click.
- [ ] Remove-from-cart optimista: ítem + contador actualizan al instante al click.
- [ ] Al fallar la mutación: rollback al estado exacto previo + toast informando (add y remove con su
      mensaje apropiado).
- [ ] Funciona para carrito **autenticado** y **de invitado**.
- [ ] Sin regresión en checkout, persistencia del carrito, ni exactitud del contador.
- [ ] strings nuevos en `en.json` y `es.json` (los toasts de fallo).
- [ ] test de regresión/feature que falla antes y pasa después (p. ej.: agregar → la lista de la página del
      carrito incluye el ítem sin refetch server; fallo de add → rollback del ítem + contador y toast).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Dirección de fix (a decidir/afinar al ejecutar):** consolidar la página del carrito para que lea el
  estado reactivo compartido — opciones: (a) que la lista de ítems del carrito viva también en React Query
  (una query de "cart items" que el hook optimista actualice con `setQueryData`, no solo `['cart-count']`),
  y la página consuma esa query en vez del snapshot server; y/o (b) invalidar/revalidar la ruta/query del
  carrito al agregar/quitar (evitando el `router.refresh` global que T-101 quitó). Preferir una **única
  fuente reactiva** sobre mantener dos.
- **Archivos:** `src/hooks/use-optimistic-photos-in-cart.ts` (extender a la lista de ítems), 
  `src/hooks/use-cart-item-count.ts`, `src/app/[lang]/dashboard/talent/cart/page.tsx` +
  `cart-content.tsx` + `actions.ts` (`getCurrentCart`/`getCartItemCountAction`), 
  `src/app/[lang]/cart/guest-cart-content.tsx` + `guest-cart-provider.tsx` (invitado),
  `src/components/add-to-cart-button.tsx` (T-101) y las superficies que agregan (galerías, `PhotoDetailModal`).
- **Solape a coordinar (cluster Carrito):** T-115 (preview en vivo, *doing*), T-117 (limpieza de ítems
  huérfanos, *doing*) y este ticket tocan `cart-content.tsx`/`guest-cart-content.tsx`/`cart/actions.ts`/el
  hook optimista → **merge previo**, ejecutar contiguos. La resolución en vivo de preview de T-115 y la fuente
  reactiva única de este ticket deberían converger (una sola query de cart items con previews resueltas).
- Usar el sistema de toast existente (`sonner`), sin libs nuevas. Mutaciones autenticadas vía Server Actions;
  invitado vía el localStorage existente. Sin `any`. Biome. **Sin otros cambios.**

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cart-optimistic-and-live-sync`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
