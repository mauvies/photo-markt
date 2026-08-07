# T-215 · Un reembolso TOTAL debe revertir la transferencia y el acceso

- **Prioridad:** P1
- **Estado:** doing
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno para implementar; **T-239 (P0) bloquea el DESPLIEGUE** — si prod tiene el esquema desincronizado con T-216, la migración de este ticket se apila sobre una base rota
- **Rama:** `fix/clawback-disputes-and-refunds`  (tipo = fix)
- **OpenSpec change:** `clawback-disputes-and-refunds` (existe; hay que recortarlo al alcance nuevo)
- **PR:** #290 (draft, WIP — hay que podarlo a este alcance)

## Requerimiento

`charge.refunded` se maneja a medias: la orden pasa a `refunded` —lo cual sí revoca el acceso— pero
**la transferencia ya enviada al fotógrafo no se revierte nunca**. Documentado como «revertir a mano
desde el dashboard», o sea, dependiente de que alguien se acuerde. El comprador recupera su dinero de
la cuenta de plataforma y el fotógrafo conserva su neto: la plataforma absorbe el 100 % de la pérdida.

**Alcance recortado a propósito (2026-08-07).** Este ticket llevaba también los reembolsos parciales y
todo el ciclo de vida de disputas. Tres pasadas de `/code-review` encontraron ~25 defectos de dinero
entre las tres, y cada ronda de arreglos introducía fail-opens nuevos. La causa no era la dificultad de
cada defecto sino el tamaño del alcance: reembolso total, reembolso parcial y disputas tienen
invariantes distintos y se estaban resolviendo a la vez. Se parten:

- **este ticket** — solo reembolso **total**;
- **T-237** — reembolso **parcial** (proporcional) + cuadrar el saldo, que se rompe por su culpa;
- **T-243** — ciclo de vida de disputas.

**Por qué el total es el caso fácil, y no es casualidad:** en un reembolso total la orden entera sale
de `net` **y** el payout entero se revierte, así que la identidad
`withdrawable = net − paidOut − pending` se mantiene sin hacer nada. Todos los defectos de
proporcionalidad, redondeo y cuadre del saldo pertenecen al caso parcial.

## Criterio de aceptación (Definition of Done)

- [ ] `charge.refunded` con `amount_refunded >= amount` revierte la transferencia completa
      (`transfers.createReversal`) y anula el hold pendiente entero
- [ ] Un reembolso **parcial** no hace nada en este ticket salvo registrarlo y alertar — es T-237
- [ ] La reversión es idempotente ante redelivery de Stripe (hasta 3 días): aplicar el mismo evento N
      veces mueve dinero una vez
- [ ] Se revoca también el acceso de **órdenes de invitado** (`guest_orders`), que hoy no se tocan: no
      existe lookup por payment intent, así que un invitado reembolsado conserva su página de token
- [ ] Una reversión fallida no tumba el webhook: se registra, se alerta y la fila queda marcada para
      conciliación
- [ ] El histórico de `payouts` refleja la reversión
- [ ] ⚠️ Escribir el estado de la orden **nunca puede promover** una orden que no estaba `completed`
      (una `pending` cuyo `payment_intent.succeeded` se perdió no puede ganar acceso por un reembolso)
- [ ] Tests de integración: reembolso total, redelivery del mismo evento, orden de invitado, reversión
      que falla
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

**La rama ya existe y contiene el rediseño completo** (reembolsos + parciales + disputas), con ~10
defectos conocidos de la tercera revisión, la mayoría específicos de disputas. Hay que **podarla** a
este alcance, no empezar de cero: el kernel de objetivos (`clawback.ts`), la inmutabilidad de
`amount_cents` y el modelo derivado de estado son la parte que sí conviene conservar.

⚠️ **Al desplegar:** la migración amplía tres CHECK de `status` y debe aplicarse **antes** del deploy;
las aplica la GitHub Action, no Vercel.

Contexto: `src/app/api/stripe/webhook/route.ts` (`charge.refunded`), `src/lib/payouts/`,
`src/database/queries/payouts.ts`, `ARCHITECTURE.md` §4.3.
