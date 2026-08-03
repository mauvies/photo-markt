# T-220 · Decidir el flujo de payouts `pending` o eliminar la ruta admin vestigial

- **Prioridad:** P2
- **Estado:** todo
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `refactor/payout-approval-decision`  (tipo = refactor)
- **OpenSpec change:** **sí** — decisión de producto
- **PR:** —
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
