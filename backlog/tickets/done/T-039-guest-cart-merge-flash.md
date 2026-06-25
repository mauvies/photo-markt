# T-039 · Merge del carrito invitado→autenticado sin parpadeo (mostrar el carrito ya fusionado)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/guest-cart-merge-flash`  (tipo = fix)
- **OpenSpec change:** —  (no aplicó: fix de render en cliente)
- **PR:** #93

> **Resuelto (enfoque #1, mínimo/cliente):** el skeleton de merge ahora gatea **todo** el carrito, no solo
> la rama vacía. Helper puro `cartView(isMerging, itemCount)` (`src/lib/cart-view.ts`) donde `merging` gana
> sobre lista no-vacía → skeleton → carrito ya fusionado (nunca parcial→completo). Timeout de seguridad en
> el `useLayoutEffect` por si el `SIGNED_IN` nunca llega (autenticado con localStorage rancio) → no deja el
> skeleton pinchado ocultando ítems reales. No se tocó la lógica de merge. Tests: `cart-view.test.ts` +
> `mergeGuestCartAction` (unión/dedup/re-precio/no-auth) en `cart.test.ts`.

## Requerimiento
Sin estar autenticado, visito un evento y agrego fotos al carrito (carrito de invitado). En la página del
carrito inicio sesión; los ítems de invitado se fusionan al carrito del usuario autenticado. **El problema:**
al redirigir de vuelta al carrito tras autenticarse, primero se ven los ítems que ya tenía el usuario
autenticado y **después** aparecen, encima, los ítems que venían del carrito de invitado — hay una
transición/parpadeo visible.

Lo deseado: que esa fusión ocurra **antes de mostrar contenido en el cliente** (idealmente en el servidor o
previo al renderizado), de modo que al volver al carrito se muestre **directamente el carrito ya completo**
(ítems del invitado + ítems del usuario autenticado), sin pop-in ni transición de "parcial → completo".

## Criterio de aceptación (Definition of Done)
- [ ] Tras login en la página del carrito con ítems de invitado pendientes, **no** se muestra el carrito
      parcial (solo los del usuario autenticado) seguido del salto a la lista completa. Se ve **una** de
      dos cosas: el carrito ya fusionado en el primer render, o un único skeleton → carrito completo
      (nunca "parcial → completo").
- [ ] El resultado de datos sigue siendo correcto: unión de ítems de invitado + ítems previos, sin
      duplicados (un `photo_id` que ya estaba no se duplica), y el `localStorage` del carrito invitado se
      limpia solo tras confirmar el merge en servidor (comportamiento actual a preservar).
- [ ] El subtotal y el contador (`cart-count`) reflejan el total fusionado sin parpadeo intermedio.
- [ ] test de regresión/feature que falla antes y pasa después (cubrir la corrección del merge — ver Notas).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas

**Causa raíz (confirmada en el código):**
- El carrito de invitado vive **solo en `localStorage`** (`GuestCartProvider`, `src/lib/guest-cart.ts`).
  El servidor no lo ve en SSR, así que la página del carrito renderiza solo los ítems del usuario
  autenticado y la fusión corre **en el cliente** después.
- El merge se dispara en `src/components/guest-cart-merge.tsx` con `onAuthStateChange('SIGNED_IN')` →
  `mergeGuestCartAction(items)` → invalida `['cart-data']`.
- Existe ya un mecanismo de skeleton (`CART_MERGE_STATE_KEY`) y un `useLayoutEffect` en
  `cart-content.tsx` que marca "merging" antes del paint si hay ítems en `localStorage`. **PERO** ese
  skeleton solo gatea la **rama de carrito vacío** (`if (cartData.items.length === 0) { if (isMerging) … }`).
  Si el usuario autenticado **ya tenía** ítems (`cartData.items.length > 0`), se salta el skeleton y pinta
  la lista existente de inmediato → exactamente el "parcial → completo" que se reporta.

**Dos enfoques (decidir al ejecutar; recomendado empezar por el mínimo):**
1. **Mínimo / cliente (recomendado primero):** gatear con `isMerging` **toda** la lista del carrito, no
   solo la rama vacía. Mientras haya merge en curso (detectado por el `useLayoutEffect` que lee
   `localStorage` antes del paint), mostrar el skeleton completo y revelar el carrito ya fusionado al
   terminar. Reusa la infraestructura existente; bajo riesgo; elimina el pop-in. Cumple "no mostrar
   contenido parcial".
2. **Servidor / pre-render (más fiel al "en el servidor", más invasivo):** persistir el carrito invitado
   también en una **cookie** legible en SSR, fusionar en el servidor (server action / en `auth/callback`
   antes de redirigir) y renderizar el carrito ya completo en el primer paint. Toca dónde se guarda el
   carrito invitado y el flujo de OAuth callback → considerar OpenSpec. Preferible si producto quiere un
   merge real pre-render, pero más superficie de cambio.

**Test:** el "no parpadeo" es de render/timing (verificación manual). Lo testeable de verdad es la
**corrección del merge** (`mergeGuestCartAction`): unión correcta, idempotencia/dedup de `photo_id` ya
presentes, y limpieza de invitado solo tras éxito. Cubrir eso como regresión (data flow — CLAUDE.md exige
test en flujos de carrito).

**Relación con T-038 (mismo cluster de carrito):** T-038 (ítems navegables/lightbox) toca
`cart-content.tsx` y `guest-cart-content.tsx`; este toca `cart-content.tsx` y `guest-cart-merge.tsx`.
Hay solape de archivos → ejecutar **contiguos y mergeando entre uno y otro** (regla anti-conflicto). No es
duplicado: T-038 es navegación de ítems, T-039 es el flujo de fusión post-login.

**Archivos probables:**
- `src/app/[lang]/dashboard/talent/cart/cart-content.tsx` (gatear render con `isMerging`)
- `src/components/guest-cart-merge.tsx` (timing del flag de merge)
- `src/app/[lang]/dashboard/talent/cart/actions.ts` (`mergeGuestCartAction`, `getCurrentCart`)
- (si enfoque 2) `src/lib/guest-cart.ts`, `src/components/guest-cart-provider.tsx`, `auth/callback`,
  cookie de carrito invitado.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/guest-cart-merge-flash`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del
   ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
