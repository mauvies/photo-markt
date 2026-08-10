# T-248 · Un evento con precio puede publicarse sin cuenta de cobro

- **Prioridad:** P1
- **Estado:** done
- **Riesgo:** alto  (la segunda mitad quita el gate de Connect de los dos checkouts — pagos)
- **Blockers:** ninguno
- **Rama:** `fix/priced-event-needs-payout-account`  (tipo = fix)
- **OpenSpec change:** `allow-sale-without-connected-payout`
- **PR:** #305

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

- [x] Al publicar o poner precio a un evento sin `stripe_connect_status = 'active'`, el fotógrafo ve un
      aviso claro con el enlace para conectar su cuenta
- [x] Decidido y documentado: **no se bloquea nada** — ni el guardado ni la venta. Se avisa. El aviso
      sigue visible mientras el evento esté vivo, encima de los tabs, no en un toast
- [x] El dashboard del fotógrafo lo hace visible, y **en proporción**: rojo solo cuando hay dinero
      realmente retenido (`money_held`); ámbar cuando aún es un pronóstico (`sales_will_hold`)
- [ ] ⚠️ **Pendiente, y no es código:** onboardar a `tom256_sa`, o despublicar su evento
- [x] Test de regresión sobre la decisión (escalado de severidad, exenciones, singular/plural)
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde (1378 unit + 780 integration) + `pnpm build`

## Hallazgo durante la ejecución, y giro de producto

La consecuencia real era **más grave** que la descrita arriba: los dos checkouts devolvían
`photographer_not_connected`, así que el evento con precio **no es que pagara tarde — no se podía
comprar**. En producción eso eran 5 de los 6 eventos con precio.

Al verlo, el usuario decidió lo contrario de lo que asumía el ticket: **que la compra sí pueda
hacerse**, y gestionar el hueco con avisos. Y el destino ya estaba construido — T-216 dejó lista toda
la ruta: el webhook abre la fila `payouts` con `hold_reason='connect_inactive'` y
`retry-pending-payouts` la drena en cuanto `account.updated` marca la cuenta activa. El gate del
checkout era anterior a T-216 y era lo único que impedía que esa maquinaria se usara.

Ese giro convirtió el ticket en `Riesgo: alto` a mitad de camino: plan mode + OpenSpec
(`allow-sale-without-connected-payout`) + `/code-review ultra`, como manda el flujo para pagos.

**Lección:** el ticket describía la consecuencia de oídas («el dinero queda retenido») sin comprobarla
en el código. Era peor, y la premisa equivocada casi hace que se enviara un aviso que decía algo falso.

## Notas

⚠️ La nota original decía que cerrar esto **eliminaría la razón por la que el worker de reintentos
importa**. Ha pasado justo lo contrario: al quitar el gate, `connect_inactive` deja de ser un caso
casi imposible y pasa a ser **la vía normal** por la que nace un hold, y el worker deja de ser un
rescate para ser la forma en que se completa una venta corriente.

Riesgo aceptado: la plataforma retiene dinero de alguien que quizá nunca conecte. Sin reembolso
automático — el comprador ya tiene sus fotos, así que reembolsar le regala el producto y castiga a la
plataforma, no al fotógrafo que no conectó.

Hueco conocido y diferido: quien no entra al dashboard no ve ningún aviso. El único canal que le
alcanza es el email, y hoy no existe ninguno dirigido a fotógrafos — capturado como ticket aparte.

Relación: **T-216** (crea los holds) · **T-239** (el worker que los drena, ya resuelto) · **T-249** (que
una venta sin payout deje de ser silenciosa).
