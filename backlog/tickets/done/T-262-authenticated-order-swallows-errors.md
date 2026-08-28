# T-262 · `createAuthenticatedOrder` se traga errores de lectura y nunca alerta

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/authenticated-order-atomicity`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

Dos mitades del mismo agujero, en `src/app/api/stripe/webhook/route.ts`.

**(a) Errores descartados.** `:784` lee `carts` con `const { data: cart } = …` — el `error` se pierde
en la desestructuración. `:818` agrupa `cartItemsError || !cartItemsData || length === 0` en una sola
rama. Los dos hacen `console.error` y devuelven `null`; el handler responde **200**.

Un fallo transitorio de PostgREST es indistinguible de «no hay carrito». Comprador cobrado, sin
pedido, sin `order_items`, sin vaciar carrito, sin email, **sin fila en `payouts` y sin incidente**.
Y no hay recuperación: `payment_intent.succeeded` no encuentra pedido y calla a propósito (T-252).
Es la forma del incidente del 2026-07-28 una tabla más allá — y la clase de fallo es real: **T-239**
fue un error de caché de esquema en `order_items`.

**(b) Pedido a medias, terminal.** El pedido se crea `status: 'completed'` (`:886`) **antes** de
`addOrderItems` (`:896`) y `clearCart` (`:907`), que lanzan. Si lanzan → 500 → la reentrega corta en
el guard `if (existingOrder) break` (`:1384`). El pedido queda **sin ítems** y el carrito **sin
vaciar**, así que el comprador ve que no compró nada y **puede pagar otra vez lo mismo**.

El lado invitado recibió exactamente este arreglo en **T-261**; el autenticado se quedó fuera.

## Criterio de aceptación (Definition of Done)

- [ ] Un error de lectura se distingue de «no hay datos»: el error alerta vía `reportMoneyIncident`
      y **relanza** (para que la reentrega reintente); el vacío legítimo sigue siendo un `break`
- [ ] El pedido no queda `completed` sin ítems — o nace `pending` y se completa al final (patrón
      T-261), o la reentrega puede reanudarlo
- [ ] El carrito no queda sin vaciar tras un pedido que el comprador no puede ver
- [ ] Tests de regresión: (a) fallo de lectura ⇒ incidente; (b) `addOrderItems` falla ⇒ la reentrega
      no deja pedido cobrado, mudo y sin ítems
- [ ] Sin PII del comprador en el incidente
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Hallado por la auditoría **T-257** (informe: `backlog/audits/2026-08-28-money-path.md`), por dos
lentes independientes. **Pre-existente en `main`, vivo en producción.**

⚠️ Si se elige el patrón «nace `pending`», copiar el guard **corregido** de T-261: solo `pending`
reanuda, todo lo demás es terminal (ver PR #316 — el `completed`-only original era resucitable).

Relación: **T-261** (mismo arreglo, lado invitado) · **T-249** · **T-252** · **T-239**.
