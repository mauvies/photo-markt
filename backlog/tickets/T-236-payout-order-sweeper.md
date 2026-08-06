# T-236 · Barrido de órdenes sin payout: las varadas que T-216 no cubre

- **Prioridad:** P2
- **Estado:** todo
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/payout-order-sweeper`  (tipo = fix)
- **OpenSpec change:** **sí** — introduce un barrido nuevo sobre órdenes completadas
- **PR:** —
- **Dep:** después de T-216 (PR #—), que introduce el ledger `payouts` sobre el que este barrido escribe

## Requerimiento

T-216 convirtió en deuda registrada las tres salidas del bucle de transferencias
(`createTransfersForOrderItems`) que perdían dinero con solo un `console.warn`. Pero el ledger solo se
escribe **dentro** de ese bucle, así que **todo lo que falla antes de llegar a él sigue sin dejar
rastro**. La revisión adversaria de T-216 encontró tres caminos:

1. **Sin `charge id` en el payment intent** (`route.ts:597-601`) — el handler hace `break` y no se
   crea ninguna transferencia. No hay fila, no hay reintento, nunca.
2. **Reentrega de una orden de invitado** — la primera entrega crea la `guest_order` y luego falla el
   bloque de transferencias; Stripe reentrega, `getGuestOrderBySessionId` encuentra la orden y hace
   `break` **antes** del bloque de transferencias. Esa orden nunca vuelve a intentarlo.
3. **Fotógrafo sin fila en `profiles`** — el bucle itera `connectStatuses`, así que ese fotógrafo se
   salta entero, antes incluso de las tres salidas que T-216 sí cubre.

Los tres dejan una venta **completada y cobrada** cuyo fotógrafo no tiene ni transferencia ni deuda
registrada. Son exactamente el agujero que T-216 cerró, por la otra puerta.

## Criterio de aceptación (Definition of Done)

- [ ] Un barrido (cron Inngest, hueco propio — `0,30` es storage cleanup, `15,45` reconciliación de
      indexado, `10,40` reintento de payouts) recorre `orders` y `guest_orders` **completadas** de más
      de ~1 h sin fila en `payouts` para cada fotógrafo con items en ellas
- [ ] Por cada hueco encontrado abre la fila del ledger con el `hold_reason` que corresponda, para que
      el worker de T-216 la pague — el barrido **detecta**, no transfiere
- [ ] Resuelve el `charge id` desde Stripe cuando la orden no lo tiene guardado, y si no se puede
      resolver deja la fila marcada para revisión en vez de inventarlo
- [ ] Es idempotente: correrlo dos veces no crea filas duplicadas (el índice único
      `(stripe_charge_id, photographer_id)` es la red, pero el barrido no debe depender solo de él)
- [ ] Test de integración: orden completada sin payout → barrido → fila `pending` con el neto correcto
- [ ] Test de integración: orden de invitado reentregada que hizo short-circuit → el barrido la recupera
- [ ] Test de integración: correr el barrido dos veces no duplica filas
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Separado de T-216 por decisión explícita del usuario: T-216 cubre las salidas que el ticket nombraba, y
este barrido es un subsistema aparte (recorre órdenes, no items de un webhook en curso) que habría
duplicado el tamaño de aquel PR en la ruta de pagos.

El caso (3) puede que sea imposible en la práctica (`profiles` se crea en el alta), pero el bucle no lo
comprueba, así que el barrido lo cubre gratis.

Ver `ARCHITECTURE.md` §4.3 y el `design.md` del change `stranded-photographer-transfers` (sección
Non-Goals), que ya documenta estos tres caminos como diferidos aquí.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
