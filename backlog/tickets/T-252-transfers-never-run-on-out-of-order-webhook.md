# T-252 · Si Stripe entrega `payment_intent.succeeded` antes que `checkout.session.completed`, la transferencia no ocurre nunca

- **Prioridad:** P1
- **Estado:** doing
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/transfers-on-out-of-order-webhook`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

`createTransfersForOrderItems` es alcanzable desde **solo dos sitios**: el camino de invitado y
`payment_intent.succeeded`. El `checkout.session.completed` autenticado crea el pedido con
`status: 'completed'` y **nunca transfiere**.

**Stripe no garantiza el orden de entrega de eventos.** Si `payment_intent.succeeded` llega primero,
`getOrderByPaymentIntentId` devuelve null, el bloque `if (order)` entero se salta y el handler
responde 200. Después `checkout.session.completed` crea el pedido ya `completed` — y nadie transfiere
jamás. Comprador cobrado, fotógrafo sin pagar, cero filas en `payouts`, **y ni un log**.

Es exactamente la forma del incidente del 28-jul-2026, y **T-249 no lo cubre**: T-249 alerta en las
salidas que sí se ejecutan, y ésta consiste precisamente en no ejecutar ninguna.

Hallado por `/code-review xhigh` sobre el PR #306 (T-249).

## Criterio de aceptación (Definition of Done)

- [ ] Una entrega fuera de orden acaba con las transferencias hechas (o con una deuda `payouts`
      recuperable), no en silencio
- [ ] Sin doble pago: apoyarse en el índice único `(stripe_charge_id, photographer_id)` de
      `openPayoutRow`, que ya hace estructuralmente imposible pagar dos veces (T-216)
- [ ] No se alerta en los `payment_intent.succeeded` que legítimamente no tienen pedido
      (suscripciones — llevan `invoice`; invitados — tienen su `guest_orders`), o el ruido entierra
      la señal
- [ ] Test de regresión: los dos órdenes de entrega producen el mismo resultado final
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

⚠️ **Esto cambia el flujo del dinero**, no solo su visibilidad — por eso se separó de T-249, cuyo plan
aprobado tenía como propiedad explícita «el flujo no cambia». Merece su propia puerta de plan mode.

La reparación natural es llamar a `createTransfersForOrderItems` también desde el
`checkout.session.completed` autenticado: es **seguro por construcción** gracias al índice único de
T-216, que es justo la máquina que ese ticket construyó. Verificar antes si Stripe manda de verdad
`payment_intent.succeeded` para pagos de Checkout con `mode: 'payment'` en el orden que se asume.

Relación: **T-249** (PR #306, alerta las otras siete salidas) · **T-216** (el índice único que hace
segura la re-conducción) · **T-239** (cerrado).
