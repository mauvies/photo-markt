# T-265 · Un freeze/restore de disputa que falla deja la fila impagable para siempre, en silencio

- **Prioridad:** P1
- **Estado:** done
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/alert-on-dispute-freeze-failures`  (tipo = fix)
- **OpenSpec change:** `alert-on-dispute-freeze-failures`
- **PR:** #323

## Requerimiento

Dos `catch` de solo consola en `src/app/api/stripe/webhook/route.ts`, y una exclusión de selector que
los vuelve terminales.

- `:1602` — `freezeHoldsForCharge` falla → `console.error`.
- `:1716` — `restoreHoldsForCharge` falla → `console.error`.
- `queries/payouts.ts:300` — `listPayableHolds` **excluye explícitamente** toda fila con
  `frozen_by_dispute_id` no nulo (correcto: un hold congelado por una investigación abierta debe
  quedarse fuera).

**Caso A (dinero atascado para siempre).** Disputa cerrada como ganada → `restoreHoldsForCharge`
lanza (blip de BD) → la fila conserva `frozen_by_dispute_id`, sigue `pending`, y queda fuera del
único selector que paga holds. `restoreHoldsForCharge` es su **único** escritor y solo corre desde esa
rama ⇒ **impagable para siempre**. Peor: `getTotalPendingPayouts` la sigue contando, así que el
fotógrafo ve un «pendiente» plausible que no llegará nunca.

**Caso B (espejo).** Si el *freeze* falla y solo se loguea, la fila queda pagable y el cron de
reintentos **paga un cargo disputado**.

## Criterio de aceptación (Definition of Done)

- [ ] Los dos `catch` llaman a `reportMoneyIncident` (el 200 y el `continue` se mantienen — no
      cambiar el flujo, solo hacerlo visible)
- [ ] Una barrida detecta filas congeladas desde hace demasiado (`frozen_by_dispute_id` no nulo y
      antiguas) y alerta — sin ella, el caso A sigue sin tener salida
- [ ] Decidir si esa barrida además consulta el estado real de la disputa en Stripe o solo reporta
- [ ] Sin alerta repetida en cada pasada
- [ ] Tests de regresión para A y B
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Hallado por la auditoría **T-257** (`backlog/audits/2026-08-28-money-path.md`).

⚠️ La exclusión de `listPayableHolds` **es correcta y no se toca** — es lo que mantiene el hold fuera
del saldo retirable mientras la disputa está viva. El fallo no es la exclusión, es que nada la
deshace cuando el restore no llega.

Clúster con **T-254**, **T-255** y **T-264**: cuatro barridas/alertas sobre la misma superficie.
Acordar los `kind` de `reportMoneyIncident` entre todos, una vez.

Relación: **T-215** (introdujo el freeze) · migración `20260809000000`.
