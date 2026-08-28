# T-261 · Un pedido de invitado puede quedar `completed` sin ítems, sin token de descarga y sin payouts — en silencio

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/guest-order-completion-atomicity`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

En `src/app/api/stripe/webhook/route.ts`, la rama de invitado de `checkout.session.completed` hace:

1. `createGuestOrder(...)` — que escribe **`status: 'completed'`** ya en el insert
   (`src/database/queries/guest-orders.ts:146`)
2. `addGuestOrderItems(...)` — **lanza** ante cualquier error de Postgres
3. `createDownloadToken(...)` — **lanza** igual

Ninguna de las dos está envuelta. Un throw llega al catch exterior → **500** → Stripe reentrega → el
guard `existingGuestOrder` encuentra el pedido y hace `break`. **El bloque de transferencias no corre
en ninguna de las dos entregas.**

Resultado: fila en `guest_orders` con `status: 'completed'`, comprador cobrado, **sin fila en
`payouts`, sin `reportMoneyIncident`, y sin las fotos** (no hay ítems ni token).

Y no hay recuperación: `payment_intent.succeeded` solo lee `orders`
(`getOrderByPaymentIntentId`); `getGuestOrderByPaymentIntentId` existe pero está cableado únicamente
a `resolveOrdersForCharge`, para reembolsos y disputas.

La clase de fallo no es hipotética: **T-239 fue exactamente un error de caché de esquema de
PostgREST sobre `order_items`**; `download_tokens` está igual de expuesta.

## Criterio de aceptación (Definition of Done)

- [ ] Un fallo al escribir ítems o token de un pedido de invitado **alerta** vía `reportMoneyIncident`
      (`payout-not-recorded` o el kind que corresponda), sin PII del comprador
- [ ] O bien el pedido de invitado no nace `completed`, o bien la reentrega puede completar lo que
      faltó en lugar de cortar en el guard — decidir cuál en el ticket, no ambas a medias
- [ ] Test de regresión: `addGuestOrderItems` falla → se levanta incidente; la reentrega no deja el
      pedido cobrado y mudo
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

⚠️ **Pre-existente en `main`, en producción hoy.** No lo introduce PR #290 — se encontró revisando
ese merge.

Es la misma forma que el incidente del 2026-07-28 (T-249: venta completada, cero filas en `payouts`,
trece días sin que nadie lo supiera), pero por el lado de invitado, que T-249 no cubrió: sus siete
salidas alertan las rutas que **se ejecutan**, y aquí la ruta nunca llega a ejecutarse.

Solapa con **T-255** (reconciliación de pedidos completados sin payouts), que lo **detectaría** a
posteriori pero no lo evita. Ejecutar T-255 primero da red de seguridad; este cierra la causa.

Relación: **T-249** · **T-252** · **T-255** · **T-239** (la clase de fallo).
