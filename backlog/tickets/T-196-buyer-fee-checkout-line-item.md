# T-196 · Billing v2 · Ticket B — line item de Stripe + display del fee en ambos checkouts

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

## Criterio de aceptación (Definition of Done)
- [ ] Checkout de **invitado** (`src/app/[lang]/cart/actions.ts`) añade un `line_item` "service fee" cuyo importe = `getBuyerServiceFeeCents(subtotal validado)` — nunca recalculado inline
- [ ] Checkout **autenticado** (`src/app/[lang]/dashboard/talent/cart/actions.ts`) hace lo mismo
- [ ] Fee = 0 ⇒ **no** se añade line item (kill-switch: sesión idéntica a v1)
- [ ] UI de carrito/checkout muestra **subtotal + línea de service fee etiquetada + total** (= su suma) antes del paso final; la línea se oculta cuando el fee es 0
- [ ] El subtotal usado para el fee es el **validado en servidor** (el que sobrevive a la re-validación de acceso/disponibilidad del carrito), no el que manda el cliente
- [ ] strings nuevos en `en.json` y `es.json`
- [ ] tests que fallan antes y pasan después: la sesión de Stripe itemiza el fee y su importe == `getBuyerServiceFeeCents` (invitado + autenticado), config en 0 no añade line item, total mostrado == subtotal + fee
- [ ] **`/code-review ultra`** antes de commitear (movimiento de dinero)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Ambos checkouts ya devuelven error tipado (`CheckoutResult`, T-189) y crean `line_items` en EUR (`PLATFORM_CURRENCY`, T-193) — reusar, no re-derivar.
- El fee es **ingreso de plataforma**: no entra en el `transfer` al fotógrafo (ese sigue siendo `price × (1 − comisión)`); verificar que el path de transfer del webhook no lo arrastre.
- Specs: `buyer-service-fee/spec.md`, requirements 2, 3 y 4.
- Con B en producción y las env medidas, el usuario puede hacer el flip del paso 4.2 (rollback = env de vuelta a 0, sin revert de código).
