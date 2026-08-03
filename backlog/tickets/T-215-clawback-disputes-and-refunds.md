# T-215 · Clawback: disputas y reembolsos deben revertir transferencia y acceso

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/clawback-disputes-and-refunds`  (tipo = fix)
- **OpenSpec change:** **sí** — hay una decisión de producto que el código no puede tomar (ver Notas)
- **PR:** —
- **Dep:** ejecutar junto a T-216 (comparten el modelo de estado de `payouts`)

## Requerimiento

El webhook maneja 8 eventos de Stripe y **ninguno es de disputa**. Cuando se pierde un chargeback:

| Qué pasa | Estado en el sistema |
|---|---|
| Stripe retira el importe de la cuenta plataforma | — |
| Stripe cobra la tasa de disputa (~15 €) | — |
| La orden sigue en `completed` | 🔴 el comprador **conserva** el acceso de descarga |
| El fotógrafo conserva su transferencia | 🔴 nadie la revierte |
| Nadie se entera | 🔴 ni log, ni alerta, ni fila |

Una foto de 5 € disputada cuesta ~20 € y deja al comprador con acceso indefinido.

Y en `charge.refunded` (que sí se maneja) la orden pasa a `refunded` —lo cual **sí** revoca el acceso,
verificado: `getTalentPurchasedPhotos`, `getPurchasedPhotoIdsForEvent` y el historial filtran
`status = 'completed'`— pero **la transferencia al fotógrafo no se revierte**. El comprador recupera
su dinero de la cuenta de plataforma y el fotógrafo conserva su neto: la plataforma absorbe el 100 %
de la pérdida más la comisión de Stripe. Documentado como "revertir a mano desde el dashboard", lo que
depende de que alguien se acuerde.

**Este ticket aplica aunque no se ofrezcan reembolsos voluntarios.** Una disputa la fuerza el
comprador unilateralmente a través de su banco: no pasa por los términos ni por la política de la
plataforma. Es precisamente el camino que usaría quien quiera descargar y no pagar.

## Criterio de aceptación (Definition of Done)

- [ ] `charge.dispute.created` → marcar la orden, **revocar el acceso de inmediato**, alertar (Sentry + email)
- [ ] `charge.dispute.closed` con `status='lost'` → revertir la transferencia al fotógrafo, registrar la tasa
- [ ] `charge.dispute.closed` con `status='won'` → restaurar el acceso
- [ ] `charge.refunded` → revertir la transferencia (`stripe.transfers.createReversal`) con clave de
      idempotencia derivada de `(transfer_id, charge_id)`
- [ ] Reembolso **parcial** revierte proporcionalmente, o se documenta por qué no y se marca para
      revisión manual
- [ ] Una reversión fallida (saldo insuficiente en la cuenta conectada) **no** tumba el webhook: se
      registra, alerta y la orden queda marcada para conciliación
- [ ] El histórico de `payouts` refleja la reversión
- [ ] La lista de eventos documentada en la cabecera del handler se actualiza —
      `test/unit/api/stripe-webhook-setup-doc.test.ts` la valida contra el `switch`
- [ ] Tests de integración en `test/integration/api/stripe-webhook.test.ts`: disputa abierta, perdida,
      ganada, y reembolso total y parcial
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

**Decisión de producto que justifica el OpenSpec change:** ¿quién asume la pérdida de una disputa
perdida? Hoy la asume la plataforma al 100 %. Opciones: revertir la transferencia (la asume el
fotógrafo, que puede quedar en saldo negativo — Stripe lo permite), repartirla, o asumirla como coste
de plataforma por debajo de cierto umbral. También hay que decidir si la tasa de disputa se repercute.

Ver también el hallazgo relacionado sobre desistimiento (T-228): la política de "sin reembolsos" es
defendible para contenido digital pero **no es exigible** sin la casilla de consentimiento en el
checkout. Son tickets independientes — este es técnico y aplica pase lo que pase con aquel.

Contexto: `src/app/api/stripe/webhook/route.ts:591-604` y `:35-36`; `ARCHITECTURE.md` §4.3.
