# T-249 · Una venta que se salta la transferencia al fotógrafo no avisa a nadie

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/alert-on-sale-without-payout`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

En el webhook, `openPayoutRow` está envuelto en `try/catch` con `continue`
(`src/app/api/stripe/webhook/route.ts`). La decisión es **correcta** —un fallo del ledger no debe
reventar el webhook y provocar que Stripe reentregue un pago que quizá ya se hizo— pero su efecto es
que **una venta puede saltarse por completo la transferencia al fotógrafo dejando solo un
`console.error`**: sin transferencia, sin fila de deuda, y sin que nadie se entere.

**Ya ocurrió.** La venta del 28 de julio (€0,99) quedó `completed` con **cero filas en `payouts`**, y
nadie lo supo hasta que se auditó producción trece días después. Esa vez fue una prueba del propio
usuario; la próxima puede ser un fotógrafo real preguntando por su dinero.

Separado de **T-239** al cerrarlo: aquel resultó ser una caché de esquema que se curó sola, pero esta
parte de su DoD no dependía del diagnóstico y sigue abierta.

## Criterio de aceptación (Definition of Done)

- [ ] Un fallo al abrir la fila de payout **alerta** (Sentry + el canal que se decida), con el charge,
      el pedido y el fotógrafo en el contexto
- [ ] El webhook **sigue devolviendo 200** — la alerta no cambia el flujo, solo lo hace visible
- [ ] Ninguna alerta lleva PII del comprador (ids e importes, nunca email ni nombre)
- [ ] Test de regresión: `openPayoutRow` falla ⇒ se reporta el incidente y el webhook responde 200
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

⚠️ **La pieza que hace esto está escrita pero parada.** `reportMoneyIncident`
(`src/lib/observability/report-money-incident.ts`) vive en la rama de **T-215 / PR #290**, que está
aplazada. Dos opciones al ejecutar: rescatar ese único fichero a `main`, o escribir uno mínimo aquí. La
primera evita que existan dos implementaciones distintas cuando #290 se retome.

Relación: **T-216** (introdujo `openPayoutRow`) · **T-239** (cerrado) · **T-248** (la causa viva de que
se creen holds).
