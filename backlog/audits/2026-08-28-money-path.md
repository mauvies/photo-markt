# Auditoría de la ruta del dinero — 2026-08-28 (T-257)

**Estado del código auditado:** `main` en `28d52a0`, es decir **después** de mergear T-215 (#290),
T-261 (#314) y el archivado (#315).

**Método:** tres subagentes independientes en paralelo, cada uno con una lente distinta y con el
encargo de **refutar**, no de confirmar. A cada uno se le dio la lista de lo ya arreglado
(T-249, T-250, T-252, T-253, T-259, T-260, T-261) para que no lo re-reportara.

1. ¿Por dónde puede completarse un pedido **sin que se pague** al fotógrafo?
2. ¿Por dónde puede **pagarse o revertirse dos veces**?
3. ¿Qué **falla en silencio**?

**Superficie:** `webhook/route.ts` (1.933 líneas), `src/lib/payouts/*`, `retry-pending-payouts.ts`,
`report-money-incident.ts`, `queries/payouts.ts` · `orders.ts` · `guest-orders.ts`, ambos checkouts,
y las cuatro migraciones del ledger. ~7.000 líneas.

**Resultado:** 14 hallazgos brutos, 10 distintos tras deduplicar. **6 verificados a mano contra el
código** (abajo, con ticket). 3 quedan **sin confirmar** y necesitan su propia pasada antes de actuar.

---

## 0. Regresión encontrada y ya arreglada — PR #316

⚠️ **El hallazgo más urgente fue un defecto introducido esta misma mañana por T-261 (#314).**

`charge.refunded` mueve un pedido de invitado inacabado directo a `refunded` (`mayWriteOrderStatus`
deja pasar toda revocación), y Stripe reentrega hasta 3 días. El guard de T-261 cortaba **solo** en
`completed`, así que un pedido `refunded` caía por él: la reentrega lo reanudaba, emitía un token de
descarga nuevo para un comprador reembolsado, lo reescribía a `completed` y abría filas de payout
contra un cargo cuyo dinero ya había vuelto. Con reembolso parcial el cargo aún tiene margen, así que
la transferencia sale.

Arreglado en **PR #316**: solo `pending` reanuda; cualquier otro estado es terminal. Misma regla que
`mayPromoteOnPaymentSuccess` (T-259) en el lado autenticado.

**Lección, y es la que más vale de toda la auditoría:** la técnica de verificadores adversarios
encontró un fallo *que ella misma había introducido tres horas antes*. Merece correrse **después** de
cambiar la ruta del dinero, no solo antes.

---

## Hallazgos verificados (con ticket)

### T-262 · `createAuthenticatedOrder` se traga errores de lectura y no alerta nunca — P1

`route.ts:784` lee `carts` con `const { data: cart } = …` — **el `error` se descarta en la
desestructuración**. `route.ts:818` no distingue «error» de «carrito vacío». Ambos caminos hacen
`console.error` y devuelven `null`; el handler responde **200**.

Un fallo transitorio de PostgREST (T-239 fue exactamente eso, un error de caché de esquema) es
indistinguible de «no hay carrito». Comprador cobrado, sin pedido, sin `payouts`, sin email, sin
incidente. **Es la forma del incidente del 2026-07-28, una tabla más allá.**

Y hay una segunda mitad: el pedido se crea `status: 'completed'` (`:886`) **antes** de `addOrderItems`
(`:896`) y `clearCart` (`:907`), que lanzan. Si lanzan, la reentrega corta en el guard de
`existingOrder` (`:1384`) — el pedido queda sin ítems y el carrito **sin vaciar**, así que el
comprador puede volver a pagar lo mismo. El lado invitado recibió ese arreglo en T-261; el
autenticado no.

### T-263 · El pedido de invitado se marca `completed` antes de que se mueva el dinero — P1

`completeGuestOrder` en `route.ts:1213`; las transferencias en `:1311`. Entre medias:
`sendGuestPurchaseEmail`, `paymentIntents.retrieve`, y por fotógrafo
`reconcileAndPersistConnectStatus` + `openPayoutRow` + `createTransfer` + `settlePayoutPaid`.

La ruta **no exporta `maxDuration`** (verificado: no hay `vercel.json` ni `export const maxDuration`),
así que corre con el timeout por defecto de la plataforma. Un kill a mitad deja el pedido `completed`
con el comprador ya en posesión de su enlace y **cero filas de payout** para los fotógrafos aún no
alcanzados. No lo recoge nadie: los `reportMoneyIncident` de ese bloque están aguas abajo del punto
donde murió el proceso, la reentrega ya no reanuda un `completed` (correctamente, tras #316), y el
lado invitado **no tiene segundo driver** — `payment_intent.succeeded` solo lee `orders`.

Invertir el orden (transferir y **después** `completeGuestOrder`) convierte el mismo kill en
recuperable.

### T-264 · `listUnconfirmedReversals` no tiene ni un llamador — P1

`queries/payouts.ts:841`. Una sola aparición en todo el repo: su propia definición. Su docstring se
describe como *«the sweep that makes "visible in reconciliation" true»* — y esa barrida no existe.

`reservePayoutReversal` escribe **antes** de la llamada a Stripe (deliberado: fallar reclamando de
menos, no de más). Si la invocación muere en medio, la fila sobre-reporta la reversión con
`stripe_reversal_id` nulo: todo delta posterior calcula 0 y `getTotalPaidOut` descuenta dinero que
sigue en la cuenta del fotógrafo. Ningún selector la recoge.

⚠️ Al cablearla: tal cual está también casaría con todo hold reducido por `applyReversalToHolds`
(que pone `reversed_at` sin transferencia que revertir). Acotarla a `status in ('paid','reversed')`.

### T-265 · Un freeze/restore de disputa que falla deja la fila impagable para siempre — P1

`route.ts:1602` (freeze falla → solo `console.error`) y `:1716` (restore falla → solo
`console.error`), contra `queries/payouts.ts:300`, donde `listPayableHolds` **excluye explícitamente**
toda fila con `frozen_by_dispute_id`.

Disputa ganada + `restoreHoldsForCharge` lanza ⇒ la fila conserva la marca, sigue `pending`, y queda
fuera del único selector que paga holds. `restoreHoldsForCharge` es su **único** escritor y solo corre
desde esa rama ⇒ impagable para siempre. Y `getTotalPendingPayouts` la sigue contando, así que el
fotógrafo ve un «pendiente» plausible que no llega nunca.

El espejo (`:1602`): si el *freeze* falla y solo se loguea, el cron de reintentos paga un cargo
disputado.

### T-266 · El canal de alertas es opcional, no verificado, y degrada en silencio — P2

`report-money-incident.ts:181` (`if (!to) return;`), `env.mjs:64` (`MONEY_ALERT_EMAIL` opcional y `''`
aceptado), y el SDK de Sentry queda inerte sin DSN.

Sin `MONEY_ALERT_EMAIL` **ni** `SENTRY_DSN`, todo incidente de T-249/T-253 colapsa a un `console.error`
en los logs de Vercel — exactamente el modo de fallo de 13 días que el reporter existe para acabar.
Nada lo comprueba: ni CI, ni el arranque, ni `/api/health/ready` (verificado: no menciona ninguna de
las dos).

### T-267 · Un carrito de invitado de más de ~46 fotos no puede pagar — P2

`cart/actions.ts:268`. El metadata lleva `is_guest` + `cart_count` + 2 claves de consentimiento + una
`cart_<i>` por foto. Stripe topa el metadata en **50 claves**, así que a partir de 47 fotos
`sessions.create` lanza. Pero el código permite hasta **100** (`GUEST_CART_MAX_IDS = 100`).

No se pierde dinero — se pierde la venta, y nadie se entera: el throw de la Server Action se redacta
en producción (T-189) y no hay log que nombre la causa. **La Foto-Flat insignia (40 fotos) queda a
cuatro claves del techo.**

---

## Reportado pero SIN confirmar — confirmar antes de actuar

No los verifiqué contra el código; los dejo con su razonamiento para que quien los tome empiece por
ahí, no por cero.

1. **Anular del todo un hold `transfer_failed` nunca sondea Stripe** (`queries/payouts.ts:547`).
   Si `createTransfer` expiró *después* de que Stripe creara la transferencia y entra un reembolso
   total antes de que el worker sondee, la rama `fullyReversed` lo marca `cancelled` sin probar nada
   y `listReversibleRowsForCharge` lo excluye. El caso parcial sí se marca para revisión; el total no.
2. **Disputa ganada + cargo ilegible** (`route.ts:1655`): `fetchCharge` devuelve `null` ⇒ `target`
   nulo ⇒ el bloque de reconciliación se salta, pero `restoreHoldsForCharge` ya corrió y devolvió el
   hold a `pending`. El cron pagaría una venta ya reembolsada.
3. **`drivePayoutsForOrder` no está gateado por el estado del pedido** (`route.ts:1417`). T-259
   protege el *estado*, no el *dinero*: si el primer drive falló en la lectura de `order_items`, un
   `payment_intent.succeeded` reenviado tras un reembolso parcial re-dispara contra el margen
   restante del cargo.

---

## Verificado y descartado

Los tres auditores confirmaron sanas, por separado, estas propiedades — vale la pena registrarlo
porque es lo que **no** hay que volver a mirar:

- El índice único parcial `(stripe_charge_id, photographer_id)` sigue siendo la garantía de
  exactamente-una-vez, y `openPayoutRow` reserva antes de la llamada a Stripe.
- `payoutIdempotencyKey` / `payoutTransferGroup` los derivan **idénticamente** el webhook y el retry
  worker (la divergencia histórica que atascaba reintentos 24 h y luego pagaba dos veces).
- La clave de idempotencia de reversión está implementada **de verdad** como `(fila, total acumulado)`,
  no solo documentada así; dos reembolsos parciales sucesivos no colisionan.
- Refund↔dispute converge en ambos órdenes (`resolveClawbackTarget` capa en el total del cargo).
- El camino de lotes sub-50¢ reclama atómicamente y sondea antes de re-disparar.
- `reportMoneyIncident` efectivamente nunca lanza.
- Los sondeos del retry worker fallan cerrado ante `unknown`.

## Cobertura y límites

- Tres lentes sobre la misma superficie; **no** se auditaron suscripciones, ni el flujo de Connect
  onboarding, ni los cálculos de precio (bundles/fees), que tienen sus propias invariantes.
- Los hallazgos «sin confirmar» son exactamente eso: plausibles y razonados, no verificados.
- Un hallazgo sin escenario reproducible se descartó por norma; los tres auditores listaron
  explícitamente lo que descartaron.
