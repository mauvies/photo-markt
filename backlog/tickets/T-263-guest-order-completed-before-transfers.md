# T-263 · El pedido de invitado se marca `completed` antes de que se mueva el dinero

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/guest-complete-after-transfers`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

En `src/app/api/stripe/webhook/route.ts`, `completeGuestOrder` corre en `:1213` y las transferencias
en `:1311`. Entre medias hay: `sendGuestPurchaseEmail`, `paymentIntents.retrieve`, y **por
fotógrafo** `reconcileAndPersistConnectStatus` + `openPayoutRow` + `createTransfer` +
`settlePayoutPaid`.

La ruta **no exporta `maxDuration`** (verificado: no hay `vercel.json` ni `export const maxDuration`),
así que corre con el timeout por defecto de la plataforma. Un carrito con 2–3 fotógrafos y un Resend
lento agotan el presupuesto con facilidad.

Si la invocación muere entre las dos líneas: pedido `completed`, comprador con su enlace de descarga,
y **cero filas de payout** para los fotógrafos aún no alcanzados. No lo recoge nada — los
`reportMoneyIncident` de ese bloque están **aguas abajo** del punto donde murió el proceso, la
reentrega ya no reanuda un `completed` (correcto desde PR #316), y el lado invitado **no tiene segundo
driver**: `payment_intent.succeeded` solo lee `orders`.

Invertir el orden hace que el mismo kill sea recuperable: si el pedido sigue `pending`, la reentrega
lo reanuda y las transferencias se re-disparan (`openPayoutRow` reserva antes de Stripe, así que
re-disparar es seguro — T-216).

## Criterio de aceptación (Definition of Done)

- [ ] `completeGuestOrder` corre **después** de las transferencias, no antes
- [ ] Un kill entre medias deja el pedido `pending` y la reentrega lo completa, incluidas las
      transferencias que faltaban
- [ ] Considerar además `export const maxDuration` en la ruta — decidir el valor en el ticket
- [ ] Test de regresión que pine el orden (las transferencias ocurren antes del cambio de estado)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Hallado por la auditoría **T-257** (`backlog/audits/2026-08-28-money-path.md`). Pre-existente.

⚠️ Ojo al mover la línea: el email de invitado **es** la entrega (T-253) y está acotado a 5 s
justamente para no empujar la invocación más allá del timeout de Stripe. Reordenar no debe dejar al
comprador sin su enlace si las transferencias fallan — son dos obligaciones distintas.

Relación: **T-261** · **T-253** · **T-216** · **T-252** (que da al lado autenticado el segundo driver
que el invitado no tiene).
