# T-204 · Bundles · Ticket B — carrito, ambos checkouts y webhook (aquí cambia el dinero)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** **Dep T-203** — necesita el kernel, la asignación y `events.bundle_tiers` ya mergeados
- **Rama:** `feat/bundle-checkout`
- **OpenSpec change:** `photo-bundles` — **activo**; ejecutar con `/opsx:apply` (grupo 2 de `tasks.md`)
- **PR:** —

## Requerimiento
Segundo hijo de **T-200**. El precio por volumen pasa a **cobrarse y mostrarse**: el comprador ve la
escalera mientras navega, el carrito desglosa el descuento antes de pagar, y ambos checkouts cobran el
total con descuento. **Este es el deploy donde cambia el dinero.**

## Alcance (grupo 2 de `openspec/changes/photo-bundles/tasks.md`)
1. Migración aditiva `cart_items.allocated_price_cents` (nullable).
2. Agrupar el carrito validado por `(evento, fotógrafo)` y preciar cada grupo con `getBundlePriceCents`.
3. Checkout invitado: line items desde los importes **asignados**; céntimos asignados en el campo `c`
   del metadata `cart_<i>` que ya se escribe (sin mecanismo nuevo); tarifa de servicio sobre el
   subtotal **con descuento**.
4. Checkout autenticado: mismo precio y line items; asignación persistida en
   `cart_items.allocated_price_cents` **antes** de crear la sesión.
5. Webhook: prefiere la asignación commiteada; fallback a `unit_price_cents` si no hay;
   **nunca** recalcula un precio de bundle desde los tramos del evento.
6. `CartTotals`: subtotal → descuento de bundle → tarifa → total (idéntico a hoy si no hay descuento).
7. Aviso de siguiente peldaño en el carrito, desde el mismo kernel.
8. Display restante: `event-meta-line.tsx` (forma compacta), JSON-LD `offers` de la página pública,
   `photo-detail-modal.tsx`, `photo-album-viewer.tsx`, `photo-selection-toolbar.tsx`.
9. **"Añadir todas mis fotos"** tras la búsqueda facial, en ambos visores, reusando multi-selección +
   `handleBulkAddToCart`. Ids desde lo que el comprador ya tiene: el match set del cliente en evento no
   gateado, `getProvenRevealIds` en evento gateado. **Nunca** una consulta nueva de las fotos del evento.

## Criterio de aceptación (Definition of Done)
- [ ] El total cobrado en ambos flujos es exactamente `getBundlePriceCents` del conjunto validado en servidor
- [ ] `sum(asignado) === total del bundle` exacto; los line items suman ese total
- [ ] **Una sola** línea de tarifa de servicio, calculada sobre el subtotal **con descuento**
- [ ] Un precio enviado por el cliente se ignora (el servidor re-deriva todo)
- [ ] Un carrito que cruza dos eventos descuenta **solo** el grupo que califica
- [ ] El transfer al fotógrafo es `getPhotographerNetCents(totalDelBundle, plan)`, **nunca** el total de lista
- [ ] Editar la escalera entre crear la sesión y la entrega del webhook **no** cambia la orden resultante
- [ ] Una sesión sin asignación produce exactamente la orden de hoy (retrocompatible)
- [ ] Un evento con reveal gate no expone ninguna affordance de bundle ni ids no revelados; "añadir todas
      mis fotos" en evento gateado añade solo ids del proven set
- [ ] Fotos ya compradas siguen excluidas y no cuentan para un umbral
- [ ] strings nuevos en `en.json` y `es.json`
- [ ] tests que fallan antes y pasan después (integración de ambos checkouts + webhook + transfer)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` **y `pnpm build`** en verde

## Notas
- **`/code-review ultra` obligatorio** — es el PR que mueve dinero.
- ⚠️ **Migración a prod a mano vía MCP** tras el merge.
- `pnpm build` es obligatorio aquí: `bundle-pricing.ts` lo importan componentes cliente y solo el build
  detecta una fuga server-only al grafo de cliente (memoria `build-catches-client-graph-errors`).
- Invariante a preservar: el webhook reconstruye órdenes desde metadata/`cart_items`, **nunca** desde
  `session.line_items` — y ahora tampoco desde un recálculo del esquema.
- Familia: T-200 (diseño) → T-203 (A) → **T-204** → T-205 (C).
