# T-264 · `listUnconfirmedReversals` no tiene ni un llamador — la barrida que promete no existe

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/sweep-unconfirmed-reversals`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

`src/database/queries/payouts.ts:841`. Un `grep` sobre `src/` y `test/` devuelve **una sola
aparición: su propia definición**.

Su docstring se describe como *«This is the sweep that makes the docstring's "visible in
reconciliation" true»* — es decir, es la pieza que otros comentarios dan por existente.

`reservePayoutReversal` escribe **antes** de la llamada a Stripe, deliberadamente (fallar reclamando
de menos, no de más). Si la invocación muere entre la reserva y `confirmPayoutReversal` —timeout de
Vercel sobre una llamada colgada— la fila queda con `reversed_amount_cents` inflado y
`stripe_reversal_id` nulo. A partir de ahí todo delta posterior calcula `target − already` = 0 y
`getTotalPaidOut` descuenta dinero que sigue en la cuenta Stripe del fotógrafo: **saldo retirable
permanentemente incorrecto**.

Ningún selector la recoge: `listPayableHolds` pide `pending` + `hold_reason`, y los de `processing`
piden `status='processing'`.

## Criterio de aceptación (Definition of Done)

- [ ] `retry-pending-payouts` (o un cron propio) llama a la barrida y **alerta** vía
      `reportMoneyIncident` sobre lo que encuentra
- [ ] ⚠️ Acotar el selector a `status in ('paid','reversed')`: tal cual está también casaría con todo
      hold reducido por `applyReversalToHolds`, que pone `reversed_at` sin que haya transferencia que
      revertir — falsos positivos garantizados
- [ ] Decidir si además se **reconcilia** contra Stripe (`findTransferByGroup` / listar reversiones)
      o solo se reporta para intervención humana
- [ ] Sin alerta repetida en cada pasada del cron — umbral por antigüedad, como pide T-254
- [ ] Test de integración con una fila reservada-y-no-confirmada
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Hallado por la auditoría **T-257** (`backlog/audits/2026-08-28-money-path.md`), por dos lentes
independientes.

Clúster con **T-254** (holds atascados) y **T-255** (pedidos sin payouts): los tres añaden barridas y
alertas sobre la misma superficie y se disputan el `kind` `needs-reconciliation`. Ejecutar contiguos y
acordar los `kind` una sola vez.

Relación: **T-260** (hizo atómica la reserva, pero no cubrió la muerte entre reserva y confirmación) ·
**T-215**.
