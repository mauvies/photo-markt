# T-237 · Reembolso parcial: proporcional, y cuadrar el saldo que eso rompe

- **Prioridad:** P2
- **Estado:** doing — **absorbido en T-215** (2026-08-10): misma rama, mismo PR. No abrir rama aparte.
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/partial-refund-payout-hold`  (tipo = fix)
- **OpenSpec change:** sí — la decisión de qué hacer con el acceso en un parcial cambia el modelo
- **PR:** —
- **Dep:** después de T-215 (comparten el kernel de clawback)

## Requerimiento

`charge.refunded` **también se dispara en reembolsos parciales**, y hoy `voidHoldsForCharge` anula el
hold **entero** sin mirar el importe: si se reembolsan 5 € de una venta de 20 €, el fotógrafo pierde su
neto sobre los 15 € restantes. Y lo pierde de forma **irrecuperable por diseño**: el índice único
parcial `(stripe_charge_id, photographer_id)` impide crear una fila de reemplazo.

**Este ticket ya no va dentro de T-215** (2026-08-07). Se intentó, y el resultado fue que el caso
parcial arrastró consigo un problema que no es del clawback sino de la contabilidad, y que se rompe en
las **dos** direcciones según lo que se decida:

- si un parcial **revoca** el acceso (comportamiento actual): la venta entera sale de `net` pero solo
  vuelve la fracción reembolsada de `paidOut`, así que al fotógrafo se le come la diferencia de sus
  **otras** ventas;
- si un parcial **no revoca** (lo que se probó en T-215): la venta entera sigue en `net` mientras
  `paidOut` baja por la fracción, así que el saldo retirable **crece** justo en el dinero que se le
  devolvió al comprador.

O sea que `withdrawable = net − paidOut − pending` no aguanta un reembolso parcial en ninguna de las
dos configuraciones. Arreglar la proporcionalidad sin arreglar la identidad solo cambia el signo del
error.

## Criterio de aceptación (Definition of Done)

- [ ] Decidir y documentar si un reembolso parcial revoca el acceso (Stripe no dice **qué** fotos cubre
      un parcial: son importes, no líneas de pedido)
- [ ] `withdrawable = net − paidOut − pending` cuadra tras un reembolso parcial, sea cual sea esa
      decisión — probablemente exige que `net` deje de moverse por órdenes enteras
- [ ] El hold pendiente se reduce en proporción en vez de anularse, y la reducción es **idempotente**
      ante redelivery
- [ ] ⚠️ Una fila cuya clave de idempotencia de Stripe ya se gastó no puede cambiar de importe: el
      worker de reintentos reenviaría un cuerpo distinto bajo la misma clave y Stripe la rechaza 24 h,
      para después emitir una segunda transferencia real. Vale para **cualquier** `hold_reason`, no
      solo `transfer_failed`
- [ ] Tests: parcial reduce y no anula; N redeliveries mueven dinero una vez; el saldo cuadra

## Notas

El kernel de T-215 (`clawback.ts`, objetivos en vez de deltas; `amount_cents` inmutable) es la base
correcta para esto y no hay que rehacerlo.

Contexto: `applyReversalToHolds` en `src/database/queries/payouts.ts`, `src/lib/payouts/clawback.ts`,
`src/database/queries/earnings.ts` (`getEarningsSummary`), `src/lib/inngest/functions/retry-pending-payouts.ts`.
