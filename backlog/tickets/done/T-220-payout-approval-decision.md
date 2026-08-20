# T-220 · Decidir el flujo de payouts `pending` o eliminar la ruta admin vestigial

- **Prioridad:** P2
- **Estado:** done
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `refactor/payout-approval-decision`  (tipo = refactor)
- **OpenSpec change:** **sí** — `openspec/changes/prune-manual-payout-approval/`
- **PR:** #312
- **Dep:** ejecutar junto a T-216

## Requerimiento

Existe infraestructura completa para un flujo de aprobación manual de payouts que **no puede ocurrir**:

- La ruta `/api/admin/payouts/[id]`
- La política RLS "los fotógrafos pueden cancelar sus payouts pendientes"
- El estado `pending` en el esquema

Pero **nada inserta filas `pending`** — cada payout se escribe directamente como `paid` desde la
transferencia por orden (`createPayoutFromTransfer`). No hay nada que aprobar, ni UI admin.

Es superficie de ataque y de confusión sin contrapartida: un endpoint admin vivo que opera sobre un
flujo inexistente.

## Decisión tomada (2026-08-19) — **(b) podar**, con la premisa corregida

⚠️ **El planteamiento original quedó obsoleto cuando T-216 se mergeó.** De los tres elementos que el
requerimiento lista, dos ya no son decidibles como los describe:

| Elemento del requerimiento | Realidad al ejecutar |
|---|---|
| La política RLS «los fotógrafos pueden cancelar sus payouts pendientes» | **Ya eliminada** por la migración `20260807000000` (T-216), junto con la de INSERT |
| El estado `pending` en el esquema | **Es el núcleo del ledger**: es el estado de hold que drena `retry-pending-payouts`. Quitarlo destruiría T-216 |
| La ruta `/api/admin/payouts/[id]` | Lo único que quedaba por decidir |

Por eso **la opción (a) no se eligió** pese a que las Notas la daban por natural: su premisa era que
T-216 *necesitaría* filas `pending` que un humano aprobara, y T-216 les dio sentido **sin** la ruta.
Y **la opción (b) no se ejecutó al pie de la letra**: eliminar el estado `pending` o darle a T-216
«una tabla ledger propia» hoy sería romper el ledger.

Lo que se hizo: borrar la ruta y las dos funciones que solo existían para servirla
(`updatePayoutStatus`, `createPayout`), sin tocar el ledger, el worker, la RLS ni el esquema. La
razón de fondo no es «estaba sin uso» sino que **un cambio de estado no es una transferencia**: la
ruta escribía una columna y no llamaba a Stripe, así que su único poder distintivo era hacer que el
ledger —la autoridad contra la que un operador reconcilia Stripe (T-249)— afirmara un pago que nunca
ocurrió. Además ya era inerte para toda fila con `stripe_charge_id`, que es todas las que crea
`openPayoutRow`.

Detalle completo en `openspec/changes/prune-manual-payout-approval/` (proposal · design · spec ·
tasks) y en `ARCHITECTURE.md` §4.3.

## Criterio de aceptación (Definition of Done)

Elegir una rama y ejecutarla entera:

**(a) Revivir** — T-216 inserta filas `pending` para las transferencias varadas, y entonces:
- [ ] La ruta admin obtiene UI, test de autorización y rate limit
- [ ] El flujo de aprobación se documenta en `ARCHITECTURE.md` §4.3

**(b) Podar** —
- [ ] Eliminar la ruta, la política RLS y el estado `pending` del esquema
- [ ] T-216 usa una tabla ledger propia en su lugar

En ambos casos:
- [ ] `ARCHITECTURE.md` §4.3 deja de describir el flujo admin como si funcionara
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

La resolución natural es **(a)**: T-216 *necesita* filas `pending` para las transferencias varadas. O
sea, esta infraestructura no está muerta — está esperando al ticket que le da sentido. Por eso van
juntos y por eso T-216 debe decidirse primero.
