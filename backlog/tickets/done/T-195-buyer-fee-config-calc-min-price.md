# T-195 · Billing v2 · Ticket A — config, punto de cálculo y precio mínimo

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno (gate de diseño de T-194 aprobado por el usuario el 2026-07-28)
- **Rama:** `feat/buyer-service-fee-config`
- **OpenSpec change:** `billing-model-v2` (activo, NO archivar — lo consumen A, B y C). Grupo **1** de `tasks.md`
- **PR:** #258 (draft)

## Requerimiento
Primer hijo de **T-194** (rediseño del modelo económico). Sienta la base **sin cambio visible para nadie**:
los tres valores de configuración del service fee, el **punto único de cálculo** `getBuyerServiceFeeCents`
y el **precio mínimo por foto**.

Ships **dark**: los tres valores shipean en **0**, y 0 reproduce v1 exacto (no se cobra fee, no hay line item,
no hay piso). Encenderlo es un PR de una línea; el rollback es revertir ese commit.

**Alcance recortado durante la ejecución** (ver Notas): la **bajada de comisiones se movió a T-196** — no está
gateada por el fee, así que shipearla antes haría cada venta Pro una pérdida. El **reprecio de Starter sí queda aquí**:
es precio de suscripción, no economía por venta, y Stripe ya cobra €9.99.

## Criterio de aceptación (Definition of Done)
- [x] `BUYER_SERVICE_FEE_FIXED_CENTS`, `BUYER_SERVICE_FEE_BPS`, `MIN_PHOTO_PRICE_CENTS` declarados como **constantes** en `src/lib/plans.ts`, shipeando en 0 (decisión revisada — ver Notas)
- [x] `getBuyerServiceFeeCents(subtotalCents)` = `FIJO + round(subtotal × BPS / 10000)`, regla de redondeo **única y determinista** (el cobrado y el mostrado son siempre el mismo entero); nadie re-deriva el fee inline
- [x] `MIN_PHOTO_PRICE_CENTS` aplicado en las actions de **crear** y **editar** evento: rechaza precio positivo bajo el piso; evento gratis (`null`/0) exento; piso 0 lo desactiva; filas existentes bajo el piso **no** se rechazan retroactivamente (solo al re-escribir el precio)
- [x] Starter mostrado a €9.99/mes (€95.88/año) en `plans.ts` — cierra el desajuste con los Price de Stripe ya recreados
- [x] strings nuevos en `en.json` y `es.json` (error de precio mínimo)
- [x] tests que fallan antes y pasan después: unit del kernel puro (combina fijo+%, redondeo, fijo-solo, %-solo, 0 = desactivado, subtotal no positivo), unit del piso y del canal de error, integración de ambas actions
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde (+ `pnpm build`)
- [x] revisión del diff antes de mergear — **hecha a mano** (`/code-review ultra` es un comando facturado que solo puede lanzar el usuario; no es invocable por el agente). Dos hallazgos materiales aplicados: el alcance recortado y la decisión de constantes

## Notas
- **Decisión revisada: constantes, no env vars.** El diseño original (T-194, D2) pedía env vars para poder fijar los números tras medir sin tocar código. En la práctica en Vercel un cambio de env necesita redeploy igual, así que lo que ahorraba era el ciclo de PR/review — y para números que deciden cuánto se le cobra a cada comprador ese ciclo es una ventaja: da diff, revisor y commit revertible, evita el drift silencioso staging↔prod, y pone a un humano entre un typo (3000 en vez de 30) y la tarjeta de todos. Bonus: `plans.ts` deja de necesitar `env.mjs`, así que **ya no es server-only** y el carrito de T-196 puede calcular lo que muestra con la misma función que cobra el checkout. Spec de `billing-model-v2` enmendado en consecuencia.
- **Alcance movido a T-196:** comisiones 12/8/5 → 8/4/0. Motivo (hallazgo del review): el fee al comprador está gateado por constante, pero **la bajada de comisiones no**. El webhook transfiere `getPhotographerNetCents(bruto)` con `source_transaction` y la plataforma absorbe el costo de Stripe por diseño → con Pro al 0 % pagas el bruto íntegro recibiendo bruto − (~€0.25 + 1.5 %): **pérdida en cada venta Pro** hasta que el fee esté vivo. Ambas mitades tienen que desplegarse juntas.
- **⚠️ Limitación conocida del error localizado:** Next redacta los mensajes de error lanzados desde Server Actions en prod (hallazgo de T-189), así que el sentinel `MIN_PHOTO_PRICE:<cents>` puede no llegar al navegador y el fotógrafo vería el error genérico. Afecta igual a todas las validaciones de esas actions y a `PlanLimitError`; no es regresión, pero la copy localizada solo se ve fiable en dev. El fix durable es un retorno tipado (patrón `CheckoutResult` de T-189) o validar el piso en cliente — más grande que este ticket.
- El piso viaja en **cents** y el precio del formulario en **euros** (columna `numeric(10,2)`) → conversión explícita en ambas actions.
- Moneda EUR ya shipeada en T-193 (prerequisito, fuera de alcance).
- Siguientes: **T-196** (line item + display + comisiones) → **T-197** (desglose de ganancias).
