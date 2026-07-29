# T-197 · Billing v2 · Ticket C — desglose de ganancias del fotógrafo (el fee no es suyo)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** Dep **T-196** (el fee ya se cobra y se muestra al comprador)
- **Rama:** `feat/earnings-fee-breakdown`
- **OpenSpec change:** `billing-model-v2` (activo → **archivar con `/opsx:archive` al cerrar este ticket**, es el último hijo). Grupo **3** de `tasks.md`
- **PR:** —

## Requerimiento
Tercer y último hijo de **T-194**. La vista de ventas/ganancias del fotógrafo debe dejar claro que el **service fee del
comprador no es dinero suyo**: su neto es `precio × (1 − comisión)` y el fee es ingreso de plataforma — ni se suma ni se
resta de su cifra. Con Pro al 0 % el fotógrafo cobra el precio íntegro, y sin desglose parecería que el fee se le descuenta.

## Criterio de aceptación (Definition of Done)
- [ ] La vista de ganancias/ventas muestra el neto = `precio × (1 − comisión)`, con copy de desglose que no presenta el fee del comprador como ingreso ni como descuento del fotógrafo
- [ ] strings nuevos en `en.json` y `es.json`
- [ ] test de regresión: una venta Pro (0 %) de €10.00 con fee de comprador de €0.45 muestra neto €10.00 — el fee no se suma ni se resta al total del fotógrafo
- [ ] **`/code-review ultra`** antes de commitear (superficie de pagos)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde
- [ ] al mergear: `/opsx:archive` del change `billing-model-v2` (A, B y C completos)

## Notas
- Ventas y ganancias comparten página con tabs en `/dashboard/photographer/sales/` (`?tab=earnings`).
- Specs: `buyer-service-fee/spec.md`, requirement 6.
- Fuera de alcance (capturar aparte si interesa): bundles / "compra todas mis fotos" (grupo 5.1 de `tasks.md`) — amortiza el fijo entre más fotos.
