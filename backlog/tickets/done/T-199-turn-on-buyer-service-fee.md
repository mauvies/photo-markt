# T-199 · Billing v2 · Encender el service fee (subir las constantes de 0 a los valores medidos)

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno — valores acordados con el usuario el 2026-07-29: **€0.25 fijo + 3%**, piso **€1.50**
- **Rama:** `feat/enable-buyer-service-fee`
- **OpenSpec change:** `billing-model-v2` — **archivado** en `openspec/changes/archive/2026-07-29-billing-model-v2/` (cierra 0.2 y 4.2; solo queda 5.1, bundles, capturado como T-200)
- **PR:** (draft)

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
- [x] Las tres constantes puestas a los valores decididos, con un comentario que registre **de qué medición salen**
- [x] Verificado contra el peor caso: **Pro (0 % de comisión) + foto al precio mínimo + tarjeta cara** → el margen de plataforma sigue siendo ≥ €0 (es el caso límite: en Pro el fee del comprador es lo **único** que cubre Stripe)
- [x] Test que fija los valores nuevos y el margen en el peor caso (el guard de `plans.test.ts` que hoy comprueba que shipean en 0 hay que actualizarlo a propósito)
- [ ] Revisión visual (para el reviewer): carrito invitado y autenticado, desktop y móvil, con la línea de tarifa y el total ya visibles
- [ ] **`/code-review ultra`** — **PENDIENTE: solo lo puede lanzar el usuario**. Cambia lo que se le cobra a cada comprador; revisión del diff hecha a mano
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde (+ `pnpm build`)
- [x] Al mergear: `/opsx:archive` de `billing-model-v2` (cierra 0.2 y 4.2, los últimos pendientes)

## Notas
- **Lo único que falta para desbloquear:** los tres números. Si no hay una preferencia clara, el diseño propone **€0.30 + 1.5 %** con piso de **€1.50** como punto de partida provisional.
- El fijo debe dimensionarse al **peor caso realista** (tarjeta no-EEA / cross-border / conversión), no a la media: una venta Pro con la tarjeta más cara es donde el margen se estrecha.
- El piso de precio solo aplica **al escribir** el precio de un evento; los eventos existentes por debajo siguen funcionando hasta que alguien los reedite, y entonces habrá que subirles el precio.
- Familia: T-195 (config + cálculo) / T-196 (cobro + display + comisiones 8/4/0) / T-197 (desglose de ganancias).

## Decisión de los números (con el usuario, 2026-07-29)
- **Descartado 3% pelado:** un fee solo-porcentaje es el mismo bug que v2 arregla, movido del vendedor al comprador — no cubre el fijo de Stripe en ventas baratas (con 3% solo se cubre a partir de ~€16.67 por foto) y **cobra de más** en las caras (3% de €50 = €1.50 contra un coste de ~€1.02).
- **Descartado el provisional €0.30 + 1.5%:** el 1.5% queda por debajo de lo que cuesta una tarjeta cara, así que las ventas grandes pierden — en una foto de €50 con tarjeta de fuera de la UE daba ≈ **−€0.86**. Con €0.25 + 3% la misma venta queda en ≈ −€0.18.
- **Descartado variar el fee por tarjeta/país:** técnicamente imposible en este flujo (el fee se fija al crear la sesión, antes de que el comprador introduzca la tarjeta) y además es *surcharging*, restringido en la UE para tarjetas de consumidor del EEE. La tarifa plana y uniforme es justo lo que el diseño eligió por eso.
- **Cola negativa aceptada:** una tarjeta que cobre por encima del 3% sigue dejando pérdida pequeña en ventas grandes. Se acepta con el mix de tráfico actual; subir los bps si crece.
- **Sobre Pro al 0%:** con cualquier fee dimensionado para cubrir Stripe y nada más, una venta Pro deja ≈ €0 por construcción. Es coherente **si el margen de Pro es la suscripción de €29.99/mes**, no la venta. Si en algún momento se quiere margen por venta también en Pro, la palanca es que Pro deje de ser 0 %.

## Notas de ejecución
- **PR apilado sobre #260** (T-197), que todavía no estaba mergeado y contenía un test afirmando que la tarifa estaba apagada. Base del PR = `feat/earnings-fee-breakdown`; GitHub la reapunta a `main` sola cuando #260 mergee.
- Tests actualizados a propósito (los guards del dark launch existen justo para saltar aquí): los dos de `buyer-service-fee.test.ts`, el de `earnings-breakdown.test.ts`, el bloque kill-switch de `buyer-service-fee-checkout.test.ts` (ahora fuerza el fee a 0 con el mock en vez de depender de la config real) y `authenticated-cart-previews.test.ts` (afirmaba 1 line item; ahora filtra el de la tarifa y cuenta solo fotos).
- El test de integración del piso deja de mockear `MIN_PHOTO_PRICE_CENTS`: el valor real ya es 150, así que ahora prueba la constante desplegada de verdad.
