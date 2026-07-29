# T-203 · Bundles · Ticket A — schema, kernel, asignación y configuración del fotógrafo

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno (gate de diseño de T-200 **aprobado** — PR #263 mergeado 2026-07-29)
- **Rama:** `feat/bundle-pricing-config`
- **OpenSpec change:** `photo-bundles` — **activo**; ejecutar con `/opsx:apply` (grupo 1 de `tasks.md`)
- **PR:** —

## Requerimiento
Primer hijo de **T-200**. Sienta la base del precio por volumen **shipeando dark**: el kernel de precio
existe y el fotógrafo ya puede configurar la escalera, pero **ningún checkout la lee todavía**, así que
ningún comprador paga distinto. Cambio visible = solo las superficies del fotógrafo + la sección de
precios (de solo lectura) en las vistas de evento.

Escalera = lista de peldaños `{ minQuantity, totalPriceCents }`, tantos como haga falta:
"1 foto €5 · 3+ fotos €12 · 8+ fotos €20" es un solo esquema.

## Alcance (grupo 1 de `openspec/changes/photo-bundles/tasks.md`)
1. Migración aditiva `events.bundle_tiers jsonb` (nullable, sin constraint — las reglas son de app, D14).
2. `src/lib/bundle-pricing.ts` **client-safe**: `getBundlePriceCents` (peldaño de **mayor** umbral
   alcanzado, luego `min(cantidad × unitario, total del peldaño)`), constante de kill switch, y
   `parseBundleTiers` que **falla cerrado** a "sin escalera".
3. Kernel de asignación por mayor-resto con `sum(asignado) === total` exacto y orden determinista.
4. `isValidBundleSchedule`: umbrales enteros ≥ 2 estrictamente crecientes; totales enteros positivos
   ≥ `MIN_PHOTO_PRICE_CENTS`; **totales estrictamente crecientes con el umbral**; cada total
   estrictamente por debajo de `minQuantity × price_per_photo`; tope de peldaños.
5. Capa de queries (`events.ts`), migration-gated al escribir como `session_end_time`.
6. `superRefine` en las actions de crear + editar; rechaza eventos `organizer` y eventos gratis.
7. Editor de escalera en el wizard (`step-3-details.tsx` + storage/types/schema) y en el form de edición.
8. Paso de revisión del wizard (`step-5-review.tsx`) muestra cada peldaño.
9. **Nuevo tab `Pricing`** en `dashboard/photographer/events/[id]`, **entre `Details` y `Share`**
   (`event-tab.ts` + `event-tabs.tsx`), de solo lectura + enlace **Edit pricing** a una **nueva sección
   de edición con alcance** `?section=pricing` (patrón `info`/`settings` de T-179 — `/edit` sigue siendo
   el único sitio que escribe).
10. **Nuevo `src/components/event-pricing-section.tsx`** (`Card`), montado en la **misma posición** —
    bajo `EventMetaLine`, sobre la galería — en la página pública **y** en la vista de talento.

## Criterio de aceptación (Definition of Done)
- [ ] `getBundlePriceCents` elige el peldaño de mayor umbral: con unitario €5 y `[{3,1200},{8,2000}]`,
      1 foto = 500, 3 = 1200, 7 = 1200, 8 = 2000, 20 = 2000 (el peldaño de 8+ **no** queda eclipsado)
- [ ] El precio es **no decreciente** en la cantidad para cualquier escalera válida
- [ ] Una escalera con totales no crecientes se **rechaza** al guardar
- [ ] Un total por debajo de `MIN_PHOTO_PRICE_CENTS`, o que no sea descuento, se rechaza sin crear ni
      mutar fila
- [ ] Eventos `organizer` y eventos gratis no pueden configurar escalera
- [ ] Datos corruptos en `bundle_tiers` → se precia `cantidad × unitario` (falla cerrado), nunca un precio erróneo
- [ ] El tab `Pricing` aparece entre `Details` y `Share`; `?section=pricing` abre solo el editor de escalera
- [ ] La sección de precios se ve igual en la página pública y en la vista de talento
- [ ] **Dark:** con escalera configurada, ni carrito, ni sesión de Stripe, ni fila de orden, ni payout cambian
- [ ] strings nuevos en `en.json` y `es.json`
- [ ] tests que fallan antes y pasan después (unit del kernel/asignación/validación + integración de ambas actions)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **`/code-review ultra` obligatorio** antes de commitear (toca precios).
- ⚠️ **Migración a prod a mano vía MCP** tras el merge — `migrate.yml` bloqueado por billing de Actions.
- Ejecutar con `/opsx:apply` sobre el change `photo-bundles`; **no archivar** el change (T-204 y T-205 lo consumen).
- Familia: T-200 (diseño) → **T-203** → T-204 (B) → T-205 (C). T-178 (tabs top-level, ya mergeado) /
  T-179 (patrón de sección de edición con alcance) / T-195 (piso de precio, misma constante).
