# T-199 · Billing v2 · Encender el service fee (subir las constantes de 0 a los valores medidos)

- **Prioridad:** P1
- **Estado:** blocked
- **Blockers:** **falta un dato del usuario** — los tres números concretos (fijo en céntimos, porcentaje en bps, precio mínimo). La medición de fees de Stripe ya está hecha (2026-07-29); falta decidir los valores
- **Rama:** `feat/enable-buyer-service-fee`
- **OpenSpec change:** `billing-model-v2` (activo — este ticket cierra la tarea 4.2 y es el que lo archiva)
- **PR:** —

## Requerimiento
Toda la maquinaria de billing v2 está construida y desplegada, pero **apagada**: las tres constantes de
`src/lib/plans.ts` valen 0, y en 0 el comportamiento es idéntico al de v1 (no se cobra fee, no aparece
línea de fee en el carrito ni en el recibo, no hay piso de precio).

Encenderlo es **cambiar tres números**:

```ts
// src/lib/plans.ts
export const BUYER_SERVICE_FEE_FIXED_CENTS = 0;  // → p.ej. 30  (€0.30 fijo por compra)
export const BUYER_SERVICE_FEE_BPS = 0;          // → p.ej. 150 (1.5% del subtotal)
export const MIN_PHOTO_PRICE_CENTS = 0;          // → p.ej. 150 (no se puede vender una foto por menos de €1.50)
```

Con esos valores de ejemplo, un carrito de €10 pasa a cobrar **€10.45** al comprador: €10.00 de fotos
+ €0.45 de tarifa de servicio, desglosado en el carrito antes de pagar y como línea aparte en el recibo
de Stripe. El fotógrafo sigue cobrando exactamente lo mismo que antes del cambio (`precio × (1 − comisión)`);
el fee es ingreso de plataforma y cubre el coste fijo de Stripe.

**Rollback:** revertir el commit. No hay migración, no hay datos que deshacer.

## Criterio de aceptación (Definition of Done)
- [ ] Las tres constantes puestas a los valores decididos, con un comentario que registre **de qué medición salen**
- [ ] Verificado contra el peor caso: **Pro (0 % de comisión) + foto al precio mínimo + tarjeta cara** → el margen de plataforma sigue siendo ≥ €0 (es el caso límite: en Pro el fee del comprador es lo **único** que cubre Stripe)
- [ ] Test que fija los valores nuevos y el margen en el peor caso (el guard de `plans.test.ts` que hoy comprueba que shipean en 0 hay que actualizarlo a propósito)
- [ ] Revisión visual: carrito invitado y autenticado, desktop y móvil, con la línea de tarifa y el total ya visibles
- [ ] **`/code-review ultra`** — cambia lo que se le cobra a cada comprador
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde
- [ ] Al mergear: `/opsx:archive` de `billing-model-v2` (cierra 0.2 y 4.2, los últimos pendientes)

## Notas
- **Lo único que falta para desbloquear:** los tres números. Si no hay una preferencia clara, el diseño propone **€0.30 + 1.5 %** con piso de **€1.50** como punto de partida provisional.
- El fijo debe dimensionarse al **peor caso realista** (tarjeta no-EEA / cross-border / conversión), no a la media: una venta Pro con la tarjeta más cara es donde el margen se estrecha.
- El piso de precio solo aplica **al escribir** el precio de un evento; los eventos existentes por debajo siguen funcionando hasta que alguien los reedite, y entonces habrá que subirles el precio.
- Familia: T-195 (config + cálculo) / T-196 (cobro + display + comisiones 8/4/0) / T-197 (desglose de ganancias).
