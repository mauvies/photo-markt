# T-215 · Clawback: reembolsos y disputas deben revertir transferencia y acceso

- **Prioridad:** P1
- **Estado:** blocked — aplazado por el usuario (2026-08-10). Implementado y pusheado en **PR #290 (draft)**, verde (2151 tests + build). Falta **solo** `/code-review ultra` antes de mergear. Motivo del aplazamiento: sin ventas reales no puede haber disputas, así que la exposición es cero hasta validar el producto.
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno para implementar; **T-239 (P0) bloquea el DESPLIEGUE** — si prod tiene el esquema desincronizado con T-216, las migraciones de este ticket se apilan sobre una base rota
- **Rama:** `fix/clawback-disputes-and-refunds`  (tipo = fix)
- **OpenSpec change:** `clawback-disputes-and-refunds` (activo)
- **PR:** #290 (draft)
- **Absorbe:** **T-237** (reembolso parcial) y **T-243** (ciclo de vida de disputas)

## Requerimiento

El webhook manejaba 8 eventos de Stripe y **ninguno era de disputa**. Al perder un chargeback: Stripe
retira el importe de la cuenta de plataforma, cobra ~15 € de tasa, la orden sigue `completed` —o sea que
**el comprador conserva el acceso indefinidamente**—, el fotógrafo conserva su transferencia, y no queda
ni log, ni alerta, ni fila. Una foto de 5 € cuesta ~20 € y el archivo se va igual. Aplica **aunque no se
ofrezcan reembolsos**: la disputa la fuerza el comprador por su banco, sin pasar por los términos.

Y `charge.refunded` se manejaba a medias: la orden pasa a `refunded` —lo cual sí revoca el acceso— pero
**la transferencia ya enviada al fotógrafo no se revierte nunca**. Documentado como «revertir a mano
desde el dashboard», o sea, dependiente de que alguien se acuerde.

## Criterio de aceptación (Definition of Done)

- [ ] `charge.refunded` revierte la transferencia (`transfers.createReversal`) y anula/reduce el hold
- [ ] Reembolso **parcial**: proporcional en ambos lados (dinero enviado y retenido), y **no revoca el
      acceso** — los reembolsos de Stripe son importes, no líneas de pedido (T-237)
- [ ] `charge.dispute.created` congela el pago; revoca el acceso **solo** en un chargeback real, no en una
      inquiry (T-243)
- [ ] `charge.dispute.updated` manejado — es como llega el **escalado** de inquiry a chargeback (T-243)
- [ ] `charge.dispute.closed` trata los **cuatro** cierres (`lost`, `won`, `warning_closed`, `prevented`)
- [ ] Congelar/descongelar **no altera el saldo retirable** del fotógrafo (T-243)
- [ ] Todo movimiento es un **target** derivado del estado de Stripe, no un delta: aplicar el mismo evento
      N veces mueve dinero una vez, y reembolso↔disputa convergen en cualquier orden
- [ ] Se revoca también el acceso de **órdenes de invitado** (`guest_orders`)
- [ ] Una reversión fallida no tumba el webhook: se registra, se alerta y la fila queda para conciliación
- [ ] ⚠️ Escribir el estado de la orden **nunca promueve** una orden que no estaba `completed`
- [ ] Un fallo de lectura contra Stripe nunca restaura acceso ni paga un hold: al no poder decidir, no se
      toca nada
- [ ] El histórico de `payouts` refleja la reversión
- [ ] La lista de eventos documentada en la cabecera del handler se actualiza —
      `test/unit/api/stripe-webhook-setup-doc.test.ts` la valida contra el `switch`
- [ ] Tests de integración por cada cruce, no solo por cada evento
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde (+ `pnpm build`)

## Notas

**Historia del alcance (importa para no repetirla).** El 2026-08-07 se decidió **partir** el ticket en
tres (total / parcial / disputas) porque el PR llevaba «10 defectos conocidos» pendientes. Al retomarlo el
2026-08-10 se comprobó que esa premisa ya no era cierta: esos 10 son los que reportó la **2ª** revisión, y
el commit inmediatamente anterior a la partición (`b04c886`, *derive clawback state instead of applying
deltas*) es justamente el rediseño que los corrige uno por uno con tests. La 3ª revisión (tarea 7.9) nunca
llegó a correrse. El estado real era **implementación completa, sin verificar** — con 1277 unit tests en
verde. **Decisión del usuario: terminarlo entero**, absorbiendo T-237 y T-243, en vez de podar código que
funciona y volver a derivar los mismos invariantes en dos tickets más.

**Lo que hace correcto el alcance grande** (y por qué partirlo tenía su propio riesgo): reembolso y
disputa **se cruzan** — reembolsar *para* zanjar un chargeback es el camino normal—, así que resolverlos
por separado es justo lo que produjo los fail-opens de las dos primeras rondas. El modelo unificado de
**target derivado** los hace converger en cualquier orden por construcción.

⚠️ **Al desplegar:** aplicar **las dos** migraciones antes del deploy (amplían tres CHECK de `status`; las
aplica la GitHub Action, no Vercel) y **suscribir el endpoint de Stripe a los tres eventos de disputa** —
sin `charge.dispute.updated` el escalado de una inquiry no revoca nada.

Contexto: `src/app/api/stripe/webhook/route.ts`, `src/lib/payouts/`,
`src/database/queries/payouts.ts`, `ARCHITECTURE.md` §4.3.
