# T-254 · El worker de reintentos de payouts solo escribe en consola — un hold atascado para siempre no avisa a nadie

- **Prioridad:** P2
- **Estado:** done
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/alert-on-stuck-payout-retries`  (tipo = fix)
- **OpenSpec change:** `alert-stuck-payout-holds`
- **PR:** #326

## Requerimiento

T-249 (PR #306) cableó `reportMoneyIncident` en el webhook, y sus alertas le dicen al operador que
la deuda quedará en `payouts` para que **`retry-pending-payouts`** la drene. Pero ese worker sigue
siendo **solo consola**: `[retry-payouts] transfer for payout <id> failed`
(`src/lib/inngest/functions/retry-pending-payouts.ts`, líneas ~232 · 352 · 418) y
`transfer lookup inconclusive, skipping` (~212 · 326).

Así que un hold `transfer_failed` cuyo `createTransfer` falla siempre (destino inválido, capability
revocada) se reintenta cada 30 minutos **indefinidamente**, sin evento en Sentry, sin email y sin
contador. La deuda es real, está registrada y no se paga nunca — el mismo estado «el dinero no se
movió y nadie lo sabe», justo en el camino al que apuntan las alertas nuevas.

Hallado por `/code-review xhigh` sobre el PR #306.

## Criterio de aceptación (Definition of Done)

- [x] Un hold que agota N reintentos alerta por `reportMoneyIncident` (`needs-reconciliation` ya
      existe en el tipo y hoy no tiene productor)
- [x] No alerta en cada pasada del cron — la alerta es «esto lleva atascado», no «este intento falló»
- [x] Sin PII del comprador
- [x] Test de regresión
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

⚠️ Cuidado con el ruido: el cron corre a `10,40 * * * *`, así que una alerta por intento fallido son
48 al día por fila. Hace falta un umbral (nº de intentos o antigüedad del hold), no un alerta-por-fallo.

Relación: **T-249** (PR #306) · **T-216** (introdujo el worker) · **T-220** (decide el destino de los
`pending`).
