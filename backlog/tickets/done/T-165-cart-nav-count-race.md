# T-165 · El contador del carrito en el nav queda pegado (race al borrar varios ítems rápido)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/cart-nav-count-race`  (tipo = fix)
- **OpenSpec change:** —  (bug de estado en cliente; no toca pagos/BD/auth de fondo)
- **PR:** —

## Requerimiento (reporte del usuario)
> Si tengo por ejemplo 4 ítems en el carrito y los borro todos rápidamente, en el nav vuelve a
> aparecer el botón del carrito con el contador en 2, a pesar de que ya no tengo más ítems.

## Causa raíz (confirmada leyendo el código)
Los guards del borrado optimista (T-162) se aplicaron a la query `['cart-data']` pero **no** a
`['cart-count']` (la fuente del contador del nav). El contador vive **solo** en el cache de react-query
`['cart-count']` (`src/hooks/use-cart-item-count.ts:11-25`, `staleTime 30s`, `refetchOnWindowFocus`),
sin seed desde props del server. Dos huecos en `handleRemove`
(`src/app/[lang]/dashboard/talent/cart/cart-content.tsx:186-245`):

1. **`cancelQueries` (línea 192) solo cancela `['cart-data']`, no `['cart-count']`.** Un refetch de
   count en vuelo nunca se aborta al llegar el siguiente borrado → puede resolver tarde y pisar un valor
   optimista más nuevo.
2. **El reconcile del count (línea 240, `invalidateQueries(['cart-count'])`) dispara en cualquier
   ventana momentánea de `pendingRemovalsRef.current === 0` y NO se hace `await`.** Con server actions
   rápidas relativas a los clics, corre a mitad de secuencia; `getCartItemCount`
   (`actions.ts:296-317` → `queries/carts.ts:359`) hace un `SELECT count` **absoluto** que observa el
   set **parcialmente committeado** y devuelve un número obsoleto (p. ej. 2), que sobrescribe el 0
   optimista ya asentado.

Como el botón del nav se **gatea en `count > 0`** (`src/components/cart-link-button.tsx:31` y el badge
del bottom-nav mobile `src/components/talent-dashboard-header.tsx:146`), ese 2 obsoleto hace que el
botón **reaparezca pegado en 2** aunque el carrito esté vacío.

**Secuencia (server actions veloces):** clic 1 → count 4→3, action1 dispara; action1 resuelve antes del
clic 2 → `pending` vuelve a 0 → arranca refetch de `['cart-count']` cuyo SELECT corre con solo algunas
DELETEs committeadas; clics 2,3,4 → count 3→2→1→0, botón se oculta; el refetch que vio 2 filas escribe
`['cart-count']=2` **después** del 0 → botón reaparece en 2.

**El carrito de invitado NO tiene el bug:** el count sale directo de `GuestCartProvider`
(`items.length`) y `removeItem` es `setItems(filter)` síncrono, sin server action ni react-query
(`guest-cart-provider.tsx`, `guest-cart-content.tsx:220`). El bug es **exclusivo del carrito
autenticado**.

## Criterio de aceptación (Definition of Done)
- [ ] Borrar rápido N ítems del carrito autenticado deja el contador del nav en **0** de forma estable
      (botón desaparece y **no** reaparece con un valor obsoleto); reproducible antes del fix.
- [ ] El fix cubre las dos superficies gateadas en `count > 0`: el botón del header
      (`cart-link-button.tsx`) y el badge del bottom-nav mobile (`talent-dashboard-header.tsx`).
- [ ] Cerrar los dos huecos: (a) `cancelQueries` debe cancelar también `['cart-count']`; (b) el
      reconcile absoluto de `['cart-count']` debe correr **solo cuando todas las remociones
      committearon** (gate por `pendingRemovalsRef`) y de forma que un refetch tardío no pise un valor
      optimista más nuevo (p. ej. await + cancel del anterior, o reconciliar contra el mismo snapshot
      que `['cart-data']`). Evaluar derivar el count de `['cart-data']` para tener **una sola fuente de
      verdad** en vez de dos caches que se pueden desincronizar.
- [ ] El "clear all" (`handleClearCart`) queda consistente con el mismo criterio (no debe dejar count
      residual).
- [ ] test de regresión que falla antes / pasa después: simular borrados concurrentes donde el refetch
      absoluto resuelve un conteo parcial (p. ej. 2) tras el 0 optimista → el contador final debe ser 0
      (mockear la server action / react-query para forzar el orden de resolución).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **P2** — bug de correctitud de estado (muestra un carrito fantasma con conteo erróneo) en una
  superficie de compra; se auto-cura al refetchear (navegación / window focus), por eso no es P1, pero
  es visiblemente incorrecto y erosiona confianza.
- **Cluster / merge:** toca el **mismo `handleRemove`** de `cart-content.tsx` que **T-163** (toast de
  borrado, en `doing`) y la familia T-162/T-146 (borrado optimista, éxito silencioso). **Coordinar el
  merge** con T-163: idealmente ejecutar este **después** de T-163 (o rebase) para no chocar en el
  mismo handler. Reusa el patrón `pendingRemovalsRef` que T-162 ya introdujo — este ticket lo extiende
  a `['cart-count']`.
- Archivos involucrados: `cart-content.tsx:192/203/238-241`, `use-cart-item-count.ts`, `cart/actions.ts`
  (`getCartItemCountAction`), `queries/carts.ts:359` (`getCartItemCount`),
  `cart-link-button.tsx:31`, `talent-dashboard-header.tsx:146`.
- No confundir con T-146 (borrado optimista de fotos del **fotógrafo** en el grid del evento) — otra
  superficie; aquí es el carrito del **talent** + su contador en el nav.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cart-nav-count-race`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
