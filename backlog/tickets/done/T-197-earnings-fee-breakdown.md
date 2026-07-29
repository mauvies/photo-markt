# T-197 · Billing v2 · Ticket C — desglose de ganancias del fotógrafo (el fee no es suyo)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno — T-196 mergeado en `main` (PR #259)
- **Rama:** `feat/earnings-fee-breakdown`
- **OpenSpec change:** `billing-model-v2` (activo → **archivar con `/opsx:archive` al cerrar este ticket**, es el último hijo). Grupo **3** de `tasks.md`
- **PR:** #260 (draft)

## Requerimiento
Tercer y último hijo de **T-194**. La vista de ventas/ganancias del fotógrafo debe dejar claro que el **service fee del
comprador no es dinero suyo**: su neto es `precio × (1 − comisión)` y el fee es ingreso de plataforma — ni se suma ni se
resta de su cifra. Con Pro al 0 % el fotógrafo cobra el precio íntegro, y sin desglose parecería que el fee se le descuenta.

## Criterio de aceptación (Definition of Done)
- [x] La vista de ganancias/ventas muestra el neto = `precio × (1 − comisión)`, con copy de desglose que no presenta el fee del comprador como ingreso ni como descuento del fotógrafo
- [x] strings nuevos en `en.json` y `es.json`
- [x] test de regresión: una venta Pro (0 %) de €10.00 con fee de comprador de €0.45 muestra neto €10.00 — el fee no se suma ni se resta al total del fotógrafo
- [ ] **`/code-review ultra`** (superficie de pagos) — **PENDIENTE: solo lo puede lanzar el usuario**. Revisión del diff hecha a mano
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde (+ `pnpm build`)
- [ ] `/opsx:archive` de `billing-model-v2` — **no archivado a propósito**: los delta specs SÍ se sincronizaron a `openspec/specs/` (nuevas capabilities `buyer-service-fee` y `minimum-photo-price`), pero el change sigue activo hasta que **T-199** encienda el fee (tarea 4.2)

## Notas
- Ventas y ganancias comparten página con tabs en `/dashboard/photographer/sales/` (`?tab=earnings`).
- Specs: `buyer-service-fee/spec.md`, requirement 6.
- Fuera de alcance (capturar aparte si interesa): bundles / "compra todas mis fotos" (grupo 5.1 de `tasks.md`) — amortiza el fijo entre más fotos.

## Hallazgo de la revisión del diff
- **Bug encontrado y corregido (las dos pestañas de la misma página se contradecían):** `calculatePlatformFee` en `queries/earnings.ts` calculaba la comisión como `round(bruto × tasa)` mientras el pago real es `getPhotographerNetCents` (un `floor`). Los dos redondeos podían discrepar en 1 céntimo, así que **el desglose no cuadraba**: una venta de €0.06 en Free mostraba €0.00 de comisión contra €0.05 de neto. Y la pestaña **Ventas** ya derivaba su comisión como `bruto − neto`, así que ambas pestañas reportaban cifras distintas para la misma venta. Ahora la comisión se deriva del pago (`bruto − neto`), con lo que `bruto = comisión + neto` es cierto por construcción y las dos pestañas coinciden. De paso, `calculatePlatformFee`/`calculateNetEarnings` pasan a recibir `planId` en vez de una tasa: el default `feeRate = 0.1` era una tasa hardcodeada stale que no correspondía a ningún plan (el mismo tipo de deriva que el string `tenPercentFee` eliminado en T-195).
