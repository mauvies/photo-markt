# T-216 · Ganancias varadas: transferencias omitidas sin registro ni reintento

- **Prioridad:** P1
- **Estado:** doing
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/stranded-photographer-transfers`  (tipo = fix)
- **OpenSpec change:** **sí** — introduce estado persistente nuevo (cola/ledger de pendientes)
- **PR:** —
- **Dep:** ejecutar junto a T-215 y T-220 (comparten el modelo de estado de `payouts`)

## Requerimiento

El bucle de transferencias tiene **dos salidas que solo hacen `console.warn`** y pierden el dinero de
vista para siempre:

1. **Neto < 50 céntimos** (`route.ts:153-158`) — por debajo del mínimo de Stripe. Se omite. Nadie vuelve.
2. **Fotógrafo sin Connect activo** (`route.ts:144-149`) — tras reconciliar contra Stripe, si sigue sin
   estar activo la transferencia queda "retenida en la cuenta de plataforma". No hay fila, no hay cola,
   no hay reintento.

El segundo es el grave: un fotógrafo que sube fotos, vende, y **completa su onboarding de Connect
después** nunca cobra esas ventas. Nada en el sistema sabe que se le debe dinero. La única prueba es
una línea de log en Vercel.

## Criterio de aceptación (Definition of Done)

- [ ] Ambas salidas escriben una fila `payouts` en estado `pending` (o tabla ledger equivalente) con
      importe, fotógrafo, orden y motivo
- [ ] Un cron de Inngest reintenta las pendientes: acumula los sub-50¢ hasta superar el mínimo y
      reintenta las retenidas cuando `stripe_connect_status` pasa a `active`
- [ ] El webhook `account.updated` dispara el reintento al activarse una cuenta, sin esperar al cron
- [ ] El fotógrafo ve el importe pendiente en su dashboard de ganancias, distinguido del disponible
- [ ] El reintento es idempotente — no puede pagar dos veces la misma venta
- [ ] Test de integración: venta con cuenta no activa → fila pendiente → activación → transferencia emitida
- [ ] Test de integración: dos ventas sub-50¢ del mismo fotógrafo se acumulan y se pagan juntas
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

`ARCHITECTURE.md` §4.3 describe este caso como "recuperable vía endpoint admin más tarde" — pero ese
endpoint no tiene nada que aprobar porque **nadie inserta filas `pending`** (ver T-220). Este ticket es
lo que le daría sentido a esa infraestructura, o lo que confirma que hay que podarla.

El cron nuevo debe elegir un slot que no contienda con los existentes (`0,30` limpieza de storage,
`15,45` reconciliación de indexado).

Contexto: `src/app/api/stripe/webhook/route.ts:144-158`.
