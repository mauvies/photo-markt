# T-257 · Auditoría de la ruta del dinero: buscar los huecos que quedan, no esperar al siguiente incidente

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `chore/money-path-audit`  (tipo = chore — la salida son hallazgos y tickets, no código)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

Agosto de 2026 fueron **ocho** arreglos de payouts encontrados de uno en uno, cada uno reaccionando a
un síntoma: T-249 (pérdida silenciosa), T-250 (holds sin avisar), T-252 (cobrado sin pagar), T-253
(email de entrega no enviado), T-254 (holds atascados), más los de UI de saldo.

Todos comparten forma: son **ausencias** — un handler que no dispara, un `catch` que no avisa, una
fila que ningún selector de recuperación recoge. Y una revisión de diff **no puede ver lo que no está
escrito**: los dos peores (T-249, T-252) estaban en código que ya había pasado revisión.

Quiero una pasada de auditoría sobre la ruta del dinero **tal como está hoy**, sin diff de por medio,
que busque los que quedan.

**Alcance:** webhook de Stripe (`src/app/api/stripe/webhook/route.ts`), `createTransfersForOrderItems`
y `drivePayoutsForOrder`, `retry-pending-payouts`, `voidHoldsForCharge`, y ambos checkouts
(`cart/actions.ts` invitado · `dashboard/talent/cart/actions.ts` autenticado).

**Método** (el del paso 6 de `/work-next`): tres verificadores independientes en paralelo, cada uno
con el encargo de **refutar**, no de confirmar —

1. ¿Por dónde puede completarse un pedido **sin que se pague** al fotógrafo?
2. ¿Por dónde puede **pagarse dos veces**? — idempotencia, reintentos, redelivery de Stripe, orden de
   eventos no garantizado.
3. ¿Qué **falla en silencio**? — `catch` que no alerta, salidas sin log, filas que ningún selector de
   recuperación recoge.

## Criterio de aceptación (Definition of Done)

- [ ] Informe con cada hallazgo en formato `archivo:línea` + **escenario de fallo reproducible**
- [ ] Se descarta explícitamente lo que suene plausible pero no tenga mecanismo — un hallazgo sin
      escenario no cuenta
- [ ] Cada hallazgo real se convierte en su **propio ticket** (`/ticket`), no se arregla aquí:
      un arreglo de pagos merece su rama, su test de regresión y su PR
- [ ] Si no queda ningún hueco, el informe lo dice y queda archivado como evidencia con la fecha
- [ ] El informe vive en el repo (`backlog/audits/` o similar), no solo en una conversación

## Notas

**Esto no sustituye al paso 6 de `/work-next`** — aquel revisa diffs de tickets de pagos; este mira el
estado completo. Repetir tras cambios grandes en el webhook, no en cada PR.

⚠️ **No usar `/code-review ultra`** (descartado por coste, 2026-08-27). Los verificadores corren en la
sesión con el Agent tool.

Invariantes que la auditoría **debe** dar por buenos y no "simplificar" (están en CLAUDE.md §payouts):
la fila se abre **antes** de la llamada a Stripe y su id **es** la clave de idempotencia; el
`transfer_group` sale de `payoutTransferGroup(row.id)` en **ambos** escritores; el `try/catch` +
`continue` del ledger es correcto (un 500 hace que Stripe reentregue) y por eso tiene que alertar;
solo la entrega que **crea** el pedido dispara sus payouts.

Relación: **T-249** · **T-252** · **T-253** · **T-254** · **T-255** (reconciliación) · **T-216**.
