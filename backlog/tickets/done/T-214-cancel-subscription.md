# T-214 · Cancelar la suscripción de pago (cancel-at-period-end + reanudar)

- **Prioridad:** P1
- **Estado:** done
- **Riesgo:** alto — pagos + webhook de Stripe + RLS + migración de BD
- **Blockers:** ninguno
- **Rama:** `feat/cancel-subscription`
- **OpenSpec change:** sí — toca migración de BD, webhook de Stripe y pagos (criterio de CLAUDE.md)
- **PR:** #272

## Requerimiento
Hoy un fotógrafo con plan **Starter** o **Pro** no tiene **ninguna** forma de cancelar desde la app.
Añadir cancelación con el flujo SaaS estándar, **no** terminación inmediata:

- Cancelar = **`cancel_at_period_end`** en Stripe. El fotógrafo conserva su plan de pago hasta el final
  del periodo ya pagado y **después** baja a Free automáticamente. Sin reembolso, sin pérdida inmediata
  de acceso. **No** hard-delete ni flip local de la fila de `subscriptions`.
- El cambio de estado real lo conduce **el webhook** (`customer.subscription.updated` / `.deleted`),
  igual que la creación de suscripción: **Stripe es la fuente de verdad, la BD sigue**. Prohibido mutar
  el estado localmente por delante del webhook.
- **Dónde:** `/dashboard/photographer/settings/billing`, en la card del plan actual. La acción
  "Cancelar suscripción" **solo** se muestra en planes de pago (Free no cancela nada).
- **UX estándar, sin dark patterns:** **una** confirmación clara que diga en qué plan está, que mantiene
  acceso hasta *[fecha de fin de periodo real de Stripe]* y que después pasa a Free. Nada de laberintos.
- **Tras cancelar:** la página refleja la cancelación pendiente ("Tu plan Pro está activo hasta *[fecha]*,
  después pasa a Free") y ofrece **reanudar/deshacer** antes de que venza (`cancel_at_period_end: false`).

## Lo que YA existe (evidencia, no supuesto)
- **`cancelSubscriptionAction`** ya está escrita: `src/app/[lang]/dashboard/photographer/billing/actions.ts:224`.
  Ya hace exactamente lo pedido — `stripe.subscriptions.update(..., { cancel_at_period_end: true })`,
  **no** escribe en `subscriptions`, y lee con `supabaseAdmin` (tabla gestionada por el sistema, mismo
  patrón que `createBillingCheckoutAction`). **Tiene cero callers** — no hay UI en ninguna parte.
  T-202 detectó esto y aplazó a propósito la pregunta de producto a este ticket; **no la borres**.
- El webhook ya maneja `customer.subscription.created` / `.updated` / `.deleted`
  (`src/app/api/stripe/webhook/route.ts:589,675`) con `supabaseAdmin`.
- El webhook **ya persiste `current_period_end`** leyéndolo de `items.data[0].current_period_end`
  (la raíz desapareció en la API `basil`; ver comentario T-159 en `route.ts`). La fecha para la UI
  ya está en BD, no hay que ir a Stripe a buscarla.
- `getCurrentPlan` (`src/database/queries/subscriptions.ts:60`) resuelve el plan desde
  `subscriptions.status` contra `ACTIVE_SUBSCRIPTION_STATUSES`, con fallback a Free. En
  `subscription.deleted` el webhook pone `status: 'canceled'` → **el downgrade a Free ya funciona solo**.

## Huecos reales que hay que cerrar
1. **No existe la columna `cancel_at_period_end` en `subscriptions`** — la migración
   `20250217000000_create_subscriptions.sql` solo tiene `current_period_end`. Sin ella no se puede
   persistir el estado "cancelación pendiente" y la página no puede distinguir *activo* de
   *activo-pero-cancelado*. **Requiere migración additive + escribirla en el `subscriptionData` del
   handler `created/updated`** (hoy no se escribe).
2. **No existe acción de reanudar** (`cancel_at_period_end: false`). Hay que añadirla junto a la de
   cancelar, mismo patrón (Server Action, `supabaseAdmin` para leer, sin escribir estado local).
3. **No existe UI**: `settings/billing/page.tsx` solo pinta la card del plan y los planes disponibles.

## Criterio de aceptación (Definition of Done)
- [ ] Un fotógrafo en plan de pago puede cancelar desde `/dashboard/photographer/settings/billing`;
      en Free **no** aparece la opción
- [ ] Cancelar setea `cancel_at_period_end: true` en Stripe; el acceso sigue hasta fin de periodo;
      **no** se añade lógica de reembolso
- [ ] El estado en BD lo escribe **el webhook**, nunca la Server Action por delante de Stripe
      (test que lo pinche: la action no debe tocar `subscriptions`)
- [ ] Migración additive que añade `cancel_at_period_end` a `subscriptions`, y el handler
      `customer.subscription.created/updated` la persiste
- [ ] La página muestra la cancelación pendiente con la **fecha real** de fin de periodo y ofrece
      **reanudar** antes del vencimiento; reanudar vuelve a dejar la suscripción normal
- [ ] Una sola confirmación antes de cancelar, indicando plan, fecha de fin y que después pasa a Free
- [ ] Al vencer el periodo la cuenta queda en Free y **todo lo que depende del plan** recalcula:
      comisión (`PLANS[].salesFeePercent` → `PLATFORM_FEE_RATES`), límites (`plan-limits.ts`),
      features. Verificar que ninguna lectura del plan quede cacheada y se salte el downgrade
- [ ] El downgrade **nunca** borra fotos del fotógrafo; el caso "por encima del límite de Free" queda
      resuelto o explícitamente anotado en el PR (ver Notas)
- [ ] RLS intacta: cero escrituras de suscripción autoría del usuario; sigue todo por `supabaseAdmin`
- [ ] **Cambio de plan con cancelación pendiente** resuelto (ver Notas): o se bloquea, o se limpia
      `cancel_at_period_end` al cambiar de plan — pero no puede quedar en estado incoherente
- [ ] strings nuevos en `en.json` y `es.json`
- [ ] test de regresión/feature que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde (+ `pnpm build`: toca `src/lib`/queries)

## Verificación de que hoy NO existe (hecha, no supuesta)
- `cancelSubscriptionAction`: **cero callers** en `src/` y `test/` (solo su definición).
- **No hay portal de facturación de Stripe**: cero hits de `billingPortal` / `billing_portal` /
  `createPortalSession` en todo `src/`. No hay vía indirecta de cancelación.
- `settings/billing/page.tsx` no tiene ninguna acción de cancelar: card de plan actual, features,
  almacenamiento, `AvailablePlansSection` y un texto de ayuda en el footer. Nada más.
- Cero strings de cancelación de suscripción en `en.json` / `es.json`.

## Hallazgos nuevos de la revisión (no estaban contemplados)
1. **⚠️ Colisión de nombre con `billing/resume/`.** Ya existe una ruta llamada *resume*
   (`dashboard/photographer/billing/resume/page.tsx`) que **no** es "reanudar suscripción": es el
   chokepoint de *retomar el checkout* con la intención de plan tras signup/login/onboarding.
   **No llamar `resume` a la acción de des-cancelar** — usar algo inequívoco
   (`reactivateSubscriptionAction` / "Reactivar suscripción") o se confunden dos flujos distintos.
2. **⚠️ Cambio de plan con cancelación pendiente — hueco real.** `AvailablePlansSection` sigue
   ofreciendo los otros planes de pago, y `createBillingCheckoutAction` tiene una rama `updated`
   que hace `stripe.subscriptions.update` in-place (prorrateo) sobre una suscripción activa. Un
   fotógrafo que **cancela y luego cambia de plan** entra por esa rama con `cancel_at_period_end: true`
   puesto. Hay que decidir y cubrirlo con test: **o** se ocultan/bloquean los cambios de plan mientras
   haya cancelación pendiente (pidiendo reactivar primero), **o** el cambio limpia el flag
   explícitamente. Lo que no puede pasar es que quede un plan nuevo con una cancelación fantasma
   heredada del anterior.
3. **No hay ruta de bajada a Free en la UI:** `AvailablePlansSection` filtra `plan.id !== 'free'`, así
   que cancelar será **la única** forma de volver a Free. Correcto, pero significa que este flujo es
   el único camino de salida y no puede quedar a medias.
4. **Reutilizar el feedback existente, no inventar otro:** ya hay `BillingStatusToast` + patrón
   `?status=<code>` en `settings/billing/page.tsx` (`cancelled`, `updated`, `checkout_failed`,
   `yearly_unavailable`). Cancelar/reactivar deben añadir sus códigos ahí. Ojo: ya existe un código
   `cancelled` que significa **checkout abandonado**, no suscripción cancelada — elegir un código
   distinto o se pisan dos significados.

## Notas
- **`Riesgo: alto` → el paso 3 de `/work-next` entra en `EnterPlanMode` y espera tu aprobación antes
  de escribir una línea.** Solo después `/opsx:propose` transcribe el plan aprobado y `/opsx:apply`
  implementa. Antes de commitear, **`/code-review ultra`** (criterio del repo para pagos). El revisor
  tiene que verificar a mano dos cosas: que los cambios de estado son webhook-driven, y que el
  downgrade no destruye fotos.
- **Caso "por encima del límite de Free" — hoy NO es destructivo, y así debe quedarse.** El enforcement
  vive solo en gates de escritura: `assertCanUploadPhoto` / `assertCanCreateEvent`
  (`src/lib/plan-limits.ts:83,108`). No hay ninguna ruta que borre fotos por exceder cuota. Consecuencia
  real del downgrade: un Pro con 200 GB que cae a Free (20 GB) **conserva todas sus fotos** pero queda
  **bloqueado para subir más** hasta bajar de 20 GB. Eso es contención, no borrado. **Decisión de
  producto pendiente (no adivinar):** ¿se avisa de esto en la confirmación de cancelación? Recomendado
  sí — una línea del estilo "usas X GB; Free incluye 20 GB: conservarás tus fotos pero no podrás subir
  más hasta liberar espacio". `getUsageStats` (`plan-limits.ts:142`) ya da el dato.
- **Anuales:** mismo flujo; el fin de periodo es la fecha de renovación anual. `current_period_end` ya
  sale del item de Stripe, así que no hay rama especial — pero cubrirlo en test.
- **Cancelar y reanudar antes de vencer** debe dejar la suscripción exactamente como estaba (mismo
  `plan_id`, mismo `current_period_end`), sin cobro nuevo.
- **Relación con T-202** (podar `api/billing/checkout` + `api/billing/cancel`): independientes, sin dep
  dura. Ojo: la route muerta `api/billing/cancel/route.ts` hace **lo mismo** que la action. **No la
  revivas ni la uses como base** — el camino vivo es la Server Action. Si T-202 se ejecuta después de
  este ticket, su nota de "cero callers de `cancelSubscriptionAction`" queda obsoleta.
- **Verificar antes de dar por bueno el AC de recálculo:** dónde se lee el plan además de
  `getCurrentPlan` (`src/app/[lang]/dashboard/photographer/actions.ts`, `settings/billing/page.tsx`,
  `queries/earnings.ts` vía `PLATFORM_FEE_RATES`) y si alguna de esas lecturas está bajo `'use cache'`.
- Familia: T-202 (rutas muertas de billing), T-194/T-195/T-196/T-197 (billing v2), T-045 (error tipado
  en checkout de suscripción), T-159 (`current_period_end` movido a `items.data[0]`).
