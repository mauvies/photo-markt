# T-205 · Bundles · Ticket C — ganancias y ventas dicen la verdad sobre una venta con descuento

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** **Dep T-204** — necesita que las ventas con bundle existan para poder reportarlas
- **Rama:** `feat/bundle-earnings-breakdown`
- **OpenSpec change:** `photo-bundles` — activo; ejecutar con `/opsx:apply` (grupo 3). **Al cerrar este
  ticket se archiva el change** con `/opsx:archive`
- **PR:** —

## Requerimiento
Tercer y último hijo de **T-200**. Las pestañas Ventas y Ganancias del fotógrafo reportan el **bruto con
descuento** de una venta con bundle — el dinero que realmente entró — y explican que el descuento es una
rebaja de precio **suya**, no una deducción de la plataforma ni algo relacionado con la tarifa del comprador.

## Alcance (grupo 3 de `openspec/changes/photo-bundles/tasks.md`)
1. Ambas pestañas usan el importe **asignado** (cobrado) como bruto, con la comisión derivada como
   `bruto − getPhotographerNetCents(bruto)` para que `bruto = comisión + neto` siga siendo cierto **por
   construcción** (la invariante que T-197 estableció tras el descuadre de un céntimo).
2. Copy en ambas pestañas explicando qué es el descuento de bundle y qué no es.

## Criterio de aceptación (Definition of Done)
- [ ] Una venta con bundle muestra el **mismo** bruto/comisión/neto en Ventas y en Ganancias
- [ ] El bruto reportado es el total cobrado, nunca el total de lista sin descuento
- [ ] `bruto = comisión + neto` se cumple en ventas con y sin bundle
- [ ] La suma de un periodo mixto (ventas sueltas + con bundle) cuadra con los payouts realmente transferidos
- [ ] El copy deja claro que el descuento es del fotógrafo y que la tarifa de servicio del comprador
      sigue sin sumarse ni restarse a sus cifras
- [ ] strings nuevos en `en.json` y `es.json`
- [ ] tests que fallan antes y pasan después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **`/code-review ultra` obligatorio** (superficie de pagos).
- Al terminar: **`/opsx:archive`** del change `photo-bundles` — es el último hijo. Antes de archivar,
  volcar los delta specs a `openspec/specs/` (las 2 capabilities nuevas), como hizo T-197.
- Queda pendiente el **gate de rollout del usuario** (grupo 4 de `tasks.md`): activar una escalera en un
  evento real, completar una compra con bundle y verificar que carrito, recibo de Stripe, filas de orden,
  transfer y fila de ganancias concuerdan — **antes** de ofrecer el feature a los fotógrafos en general.
- Familia: T-200 (diseño) → T-203 (A) → T-204 (B) → **T-205**. T-197 (invariante `bruto = comisión + neto`).
