# T-195 · Billing v2 · Ticket A — config, punto de cálculo, precio mínimo y nuevas comisiones

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno (gate de diseño de T-194 aprobado por el usuario el 2026-07-28)
- **Rama:** `feat/buyer-service-fee-config`
- **OpenSpec change:** `billing-model-v2` (activo, NO archivar — lo consumen A, B y C). Ejecutar con `/opsx:apply` sobre el grupo **1** de `tasks.md`
- **PR:** #258 (draft)

## Requerimiento
Primer hijo de **T-194** (rediseño del modelo económico). Sienta la base **sin cambio visible para el comprador**:
las tres env vars del service fee, el **punto único de cálculo** `getBuyerServiceFeeCents`, el **precio mínimo por foto**,
y la **bajada de comisiones** a Free 8 / Starter 4 / Pro 0 % + reprecio de Starter a €9.99.

Ships **dark**: con los defaults (fee = 0) el comportamiento de compra es byte-a-byte el de v1. El fee real se
enciende después vía env, cuando el usuario mida la distribución de fees de Stripe (gate 0.1/0.2 de `tasks.md`, paso 4.2).

## Criterio de aceptación (Definition of Done)
- [x] `env.mjs` valida `BUYER_SERVICE_FEE_FIXED_CENTS`, `BUYER_SERVICE_FEE_BPS`, `MIN_PHOTO_PRICE_CENTS` (Zod, defaults **0** = kill-switch)
- [x] `getBuyerServiceFeeCents(subtotalCents)` en `src/lib/plans.ts` = `FIXED + round(subtotal × BPS / 10000)`, regla de redondeo **única y determinista** (el cobrado y el mostrado son siempre el mismo entero); nadie re-deriva el fee inline
- [x] `PLATFORM_FEE_RATES` → Free 8 % / Starter 4 % / Pro 0 %; el % anunciado en la UI sigue **derivado** de esa fuente única (sin divergencia copy ↔ fee aplicado)
- [x] `MIN_PHOTO_PRICE_CENTS` aplicado en las actions/schemas de **crear** y **editar** evento: rechaza precio positivo bajo el piso con error localizado; evento gratis (`null`/0) exento; piso 0 lo desactiva; filas existentes bajo el piso **no** se rechazan retroactivamente (solo al re-escribir el precio)
- [x] Starter mostrado a €9.99/mes (€95.88/año) en `plans.ts`/pricing
- [x] strings nuevos en `en.json` y `es.json` (error de precio mínimo)
- [x] tests que fallan antes y pasan después: unit de `getBuyerServiceFeeCents` (combina fijo+%, redondeo, 0 = desactivado), unit de `getPhotographerNetCents` por tier (8/4/0), regresión del piso de precio (rechaza bajo, acepta en el piso, exento gratis, piso 0)
- [ ] **`/code-review ultra`** (cambio de modelo de ingresos) — **PENDIENTE: solo lo puede lanzar el usuario** (comando facturado, no lanzable por el agente). Correr sobre la rama **antes de mergear** el draft
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde (+ `pnpm build`)

## Notas
- **⚠️ Prerequisito de deploy (no es código):** recrear los Price objects `STRIPE_PRICE_AMATEUR` / `STRIPE_PRICE_AMATEUR_YEARLY` a **€9.99 EUR** en el dashboard de Stripe. Mismo patrón manual que T-193 (migración de moneda) y T-192 (URL del webhook).
- **BREAKING de modelo de ingresos:** 12/8/5 → 8/4/0. La bajada solo es sostenible con el fee del comprador; por eso A puede mergear dark pero **el flip de env (4.2) no debe hacerse hasta que B esté en producción**, o las ventas Pro quedarían a 0 % de comisión y sin fee que cubra Stripe.
- Moneda EUR ya shipeada en T-193 (prerequisito, fuera de alcance).
- Specs: `openspec/changes/billing-model-v2/specs/buyer-service-fee/spec.md` (requirements 1 y 5) + `minimum-photo-price/spec.md`.
- Siguientes: **T-196** (line item + display en ambos checkouts) → **T-197** (desglose de ganancias). No ejecutar en paralelo — los tres tocan `plans.ts`/checkout.
