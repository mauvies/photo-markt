# T-259 · `payment_intent.succeeded` resucita un pedido reembolsado o disputado, y le devuelve el acceso al comprador

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** alto  (pagos · acceso a contenido pagado)
- **Blockers:** ninguno
- **Rama:** `fix/guard-order-status-promotion`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

`src/app/api/stripe/webhook/route.ts` (~1334) promociona a `completed` **cualquier** pedido que no lo
esté ya:

```ts
if (order && order.status !== 'completed') {
  await updateOrderStatus(supabaseAdmin, order.id, 'completed', { ... });
}
```

Sin guard. Y PR #290 (T-215) introduce **`mayWriteOrderStatus`** (`route.ts:231`) justo para impedir
eso — «`completed` es un resultado COMPUTADO, no un estado al que se vuelva» — pero solo lo aplica
dentro de su propio `moveOrdersTo`, no al escritor viejo.

**Escenario reproducible**, íntegramente dentro de la ventana de reentrega de 3 días de Stripe:

1. El comprador paga. La entrega de `payment_intent.succeeded` falla (deploy, blip de BD) y Stripe la
   encola para reintento.
2. `checkout.session.completed` sí entra: crea el pedido y los payouts.
3. Una hora después se reembolsa. `charge.refunded` deja el pedido `refunded` y anula el hold.
4. Entra el reintento encolado de `payment_intent.succeeded` → el pedido **vuelve a `completed`**.

El comprador reembolsado recupera acceso permanente al ZIP y a su biblioteca, y la venta reentra en
`getCompletedSaleItems`/`net` con su fila de payout en `cancelled`.

El dinero está a salvo (el índice único bloquea el re-drive), **el acceso no**.

Encontrado por dos verificadores independientes, por separado, al revisar el merge de PR #290.

## Criterio de aceptación (Definition of Done)

- [ ] El escritor de `payment_intent.succeeded` pasa por `mayWriteOrderStatus` (o equivalente): nunca
      promociona a `completed` un pedido `refunded` o `disputed`
- [ ] Mismo trato para el camino de invitado si aplica
- [ ] Test de regresión con la secuencia exacta de arriba: refund → reentrega tardía de
      `payment_intent.succeeded` → el pedido **sigue** `refunded` y el acceso **sigue** revocado
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

⚠️ **El bug del caso `refunded` YA ESTÁ EN PRODUCCIÓN** — la línea sin guard es pre-existente en
`main` (allí, línea ~1059). Lo que añade T-215 es el estado `disputed`, que pasa a ser igual de
resucitable, y la propia función `mayWriteOrderStatus` que demuestra que la regla estaba entendida
pero no aplicada en todas partes.

Se puede arreglar **antes** de mergear PR #290 (en `main`, cubriendo solo `refunded`) o **dentro** de
él (cubriendo también `disputed`). Preferible dentro: es donde está el guard.

Relación: **T-215** (PR #290, introduce el guard) · **T-252** (ambos handlers disparan payouts) ·
**T-257** (auditoría de la ruta del dinero — este hallazgo es exactamente su clase).
