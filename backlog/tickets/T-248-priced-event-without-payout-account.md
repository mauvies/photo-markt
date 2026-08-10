# T-248 · Un evento con precio puede publicarse sin cuenta de cobro

- **Prioridad:** P1
- **Estado:** doing
- **Riesgo:** normal  (UI + una validación; no toca el camino del dinero)
- **Blockers:** ninguno
- **Rama:** `fix/priced-event-needs-payout-account`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

En producción, ahora mismo:

| Fotógrafo | Fotos públicas | Precio | Connect |
|---|---|---|---|
| `tom256_sa` | **228** | €6,50 | 🔴 `not_connected` |

**Es el mayor catálogo vendible de la plataforma y su autor no puede cobrar.** Si alguien compra hoy,
el dinero se cobra, el comprador recibe su foto, y el neto queda retenido en una fila `payouts` con
`hold_reason = 'connect_inactive'` hasta que ese fotógrafo complete el onboarding — algo que quizá no
haga nunca, porque nada se lo pide.

El producto permite **publicar un evento con precio sin tener forma de recibir el dinero**, y no avisa
en ningún momento. El fotógrafo no tiene por qué saber que le falta un paso; se entera cuando alguien
le pregunta por qué no ha cobrado.

Descubierto al auditar producción tras verificar el camino del dinero (2026-08-10).

## Criterio de aceptación (Definition of Done)

- [ ] Al publicar o poner precio a un evento sin `stripe_connect_status = 'active'`, el fotógrafo ve un
      aviso claro con el enlace para conectar su cuenta
- [ ] Decidir y documentar **si se bloquea o solo se avisa**. Bloquear es más seguro para el comprador;
      avisar es más amable con un fotógrafo que quiere preparar el evento antes de cobrar. ⚠️ No dejarlo
      a medias: si se avisa y se permite, el aviso tiene que seguir visible mientras el evento esté vivo
- [ ] El dashboard del fotógrafo hace visible el estado «tienes eventos a la venta y no puedes cobrar»
- [ ] Acción inmediata y sin código: **onboardar a `tom256_sa`, o despublicar su evento** hasta que lo esté
- [ ] Test de regresión sobre la validación
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Es la única vía viva por la que hoy se crea un hold: los otros dos casos (`below_minimum`,
`transfer_failed`) requieren circunstancias que no se dan. Cerrar esto **elimina la razón por la que el
worker de reintentos importa** — arreglar la causa en vez del rescate.

Relación: **T-216** (crea los holds) · **T-239** (el worker que los drena, ya resuelto) · **T-249** (que
una venta sin payout deje de ser silenciosa).
