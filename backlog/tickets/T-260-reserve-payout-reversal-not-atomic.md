# T-260 · `reservePayoutReversal` es un read-modify-write sobre una columna de dinero

- **Prioridad:** P1
- **Estado:** blocked
- **Riesgo:** alto  (pagos)
- **Blockers:** depende de T-215 (PR #290) — el código aún no está en `main`
- **Rama:** `fix/atomic-payout-reversal-reserve`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

`reservePayoutReversal` (`src/database/queries/payouts.ts`, ~780) lee y luego escribe, sin condición
en el UPDATE:

```ts
const { data: current } = await supabase.from('payouts')
  .select('amount_cents, reversed_amount_cents').eq('id', payoutId).maybeSingle();
const totalReversed = Math.min(row.amount_cents, (row.reversed_amount_cents ?? 0) + Math.max(0, reversedCents));
await supabase.from('payouts').update({ reversed_amount_cents: totalReversed, ... }).eq('id', payoutId);
```

El call site (`apply-clawback.ts`, ~231) pasa un **delta**, calculado a partir de una lectura
*anterior* (`listReversibleRowsForCharge`). Así que hay dos lecturas separadas de
`reversed_amount_cents` y una suma entre medias.

**Escenario reproducible:** dos entregas concurrentes sobre el mismo cargo (`charge.refunded`
compitiendo con `charge.dispute.closed`-won, ambas llamando a `applyClawback`) se intercalan como
lectura A → escritura A → lectura B (que ya ve la escritura de A) → escritura B, mientras el `delta`
de B se calculó contra la lectura vieja. La fila acaba registrando `delta` dos veces.

**Stripe está protegido**: la clave de idempotencia es `(fila de payout, total acumulado objetivo)`,
así que solo se ejecuta una reversión real. **El ledger no**: `reversed_amount_cents` sobre-reporta,
`getTotalPaidOut` infravalora el saldo de forma **permanente**, y los deltas posteriores calculan 0
— es decir, la siguiente reversión legítima no se aplica.

El arreglo es un UPDATE condicional único (o un RPC), no un read-then-write.

## Criterio de aceptación (Definition of Done)

- [ ] La reserva es una sola sentencia atómica: `update ... set reversed_amount_cents = least(amount_cents, coalesce(reversed_amount_cents,0) + $delta) where id = $id` (o un `SECURITY DEFINER` RPC), devolviendo el valor resultante
- [ ] Si es RPC nuevo en `public`: `revoke execute ... from anon, authenticated` (convención del repo)
- [ ] Test que ejerza dos reservas concurrentes sobre la misma fila y compruebe que el total no excede el objetivo
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

⚠️ **Código nuevo de PR #290** — cero apariciones de `reservePayoutReversal` en `main`. No está en
producción, así que **no hay exposición hoy**; el momento de arreglarlo es antes de mergear ese PR.

`releasePayoutReversal` y `confirmPayoutReversal` comparten la forma — revisarlas en el mismo ticket.

Hallado por el verificador de doble-pago al revisar el merge de PR #290, que por lo demás salió
limpio (el índice único parcial `(stripe_charge_id, photographer_id)`, la paridad de
`payoutTransferGroup`/`payoutIdempotencyKey` entre webhook y worker, y la convergencia
refund↔dispute en ambos órdenes están todos intactos).

Relación: **T-215** (PR #290) · **T-216** (el ledger y su índice exactamente-una-vez).
