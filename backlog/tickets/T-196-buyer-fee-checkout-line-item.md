# T-196 · Billing v2 · Ticket B — line item de Stripe + display del fee + bajada de comisiones

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** Dep **T-195** (necesita `getBuyerServiceFeeCents` y las env vars)
- **Rama:** `feat/buyer-service-fee-checkout`
- **OpenSpec change:** `billing-model-v2` (activo, NO archivar). Grupo **2** de `tasks.md`
- **PR:** —

## Requerimiento
Segundo hijo de **T-194**. Cobra y **muestra** el service fee del comprador: un `line_item` de Stripe propio y visible
(no plegado en el precio de la foto) en los **dos** flujos de checkout, más el desglose subtotal + fee + total
**antes** de ir a Stripe. La divulgación up-front es el requisito legal (PSD2: un fee de servicio plano y uniforme es
lícito; el riesgo es la sorpresa de precio, no el fee en sí).

**Además absorbe la mitad vendedora del modelo, movida desde T-195** (tarea 1.3 de `tasks.md`):
comisiones **12/8/5 → 8/4/0**. Se hace aquí y no antes porque esa bajada **no está gateada** por el fee:
el webhook transfiere `getPhotographerNetCents(bruto)` y la plataforma absorbe el costo de Stripe, así que
Pro al 0 % sin fee vivo = **pérdida en cada venta Pro**. Las dos mitades del modelo tienen que entrar en el
mismo despliegue. (El reprecio de Starter a €9.99 ya entró con T-195 — es precio de suscripción, no economía por venta.)

## Criterio de aceptación (Definition of Done)
- [ ] Checkout de **invitado** (`src/app/[lang]/cart/actions.ts`) añade un `line_item` "service fee" cuyo importe = `getBuyerServiceFeeCents(subtotal validado)` — nunca recalculado inline
- [ ] Checkout **autenticado** (`src/app/[lang]/dashboard/talent/cart/actions.ts`) hace lo mismo
- [ ] Fee = 0 ⇒ **no** se añade line item (kill-switch: sesión idéntica a v1)
- [ ] UI de carrito/checkout muestra **subtotal + línea de service fee etiquetada + total** (= su suma) antes del paso final; la línea se oculta cuando el fee es 0
- [ ] El subtotal usado para el fee es el **validado en servidor** (el que sobrevive a la re-validación de acceso/disponibilidad del carrito), no el que manda el cliente
- [ ] **`PLATFORM_FEE_RATES` → Free 8 % / Starter 4 % / Pro 0 %** (vía `salesFeePercent`, la fuente única); copy anunciada sincronizada en ambos diccionarios (`*Feature1`, `trustEconomicsBody`, FAQ) — el guard `pricing-consistency.test.ts` falla si divergen
- [ ] strings nuevos en `en.json` y `es.json`
- [ ] tests que fallan antes y pasan después: la sesión de Stripe itemiza el fee y su importe == `getBuyerServiceFeeCents` (invitado + autenticado), config en 0 no añade line item, total mostrado == subtotal + fee, `getPhotographerNetCents` por tier a las tarifas nuevas
- [ ] **`/code-review ultra`** antes de commitear (movimiento de dinero)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Ambos checkouts ya devuelven error tipado (`CheckoutResult`, T-189) y crean `line_items` en EUR (`PLATFORM_CURRENCY`, T-193) — reusar, no re-derivar.
- Los valores del fee son **constantes** en `plans.ts` (no env vars — decisión revisada en T-195), y `plans.ts` **no es server-only**: el carrito puede llamar a `getBuyerServiceFeeCents` directamente, así que lo mostrado y lo cobrado salen de la misma función sin prop drilling.
- **Prerequisito de Stripe ya hecho:** los Price de Starter se recrearon a €9.99 EUR el 2026-07-28 y T-195 ya alineó el display, así que no queda nada pendiente de Stripe para este ticket.
- El fee es **ingreso de plataforma**: no entra en el `transfer` al fotógrafo (ese sigue siendo `price × (1 − comisión)`); verificar que el path de transfer del webhook no lo arrastre.
- Specs: `buyer-service-fee/spec.md`, requirements 2, 3 y 4.
- Con B en producción y los fees medidos, el usuario puede encender v2 (paso 4.2): un PR de una línea subiendo las constantes; rollback = revertir ese commit.
