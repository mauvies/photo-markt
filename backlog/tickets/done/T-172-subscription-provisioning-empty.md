# T-172 · Plan Pro no da eventos ilimitados: tabla `subscriptions` vacía en prod → todos resuelven a Free

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno (pero el **primer paso es verificar Stripe** — de eso depende la severidad real; ver Notas)
- **Rama:** `fix/subscription-provisioning`  (tipo = fix)
- **OpenSpec change:** —  (evaluar al ejecutar: toca pagos/webhook → **`/code-review` obligatorio** antes de commit)
- **PR:** —

## Requerimiento (reporte del usuario)
> Como fotógrafo, ¿por qué solo me deja crear **5 eventos** si tengo el plan **Pro**, que debería
> dejarme crear eventos ilimitados?

## Causa raíz (verificada — código + datos de prod)
El límite de eventos es correcto en config: `src/lib/plans.ts` — Free `maxEvents: 5`, Starter y Pro
ambos `maxEvents: null` (ilimitado). La verificación (`assertCanCreateEvent` en `src/lib/plan-limits.ts`)
también es correcta: `plan.maxEvents === null` → pasa siempre. El plan se resuelve con
`getCurrentPlan` (`src/database/queries/subscriptions.ts`), que **cae a Free** si no hay fila de
`subscriptions` en estado activo.

**Datos de prod (MCP, read-only, `yzdlueeeizdqwuicydbr`):**
- El fotógrafo `mauricioviera` (`user_id 2e9c5d23-fbad-4076-8214-365789cd4f59`) **no tiene fila en
  `subscriptions`** (`plan_id null`), y tiene **2 eventos** creados. → se resuelve como **Free** → tope 5.
- **`select count(*) from subscriptions` = 0**: la tabla `subscriptions` está **completamente vacía en
  prod**. **Nadie** tiene fila → **todos** los fotógrafos resuelven a **Free** (5 eventos, 20GB, y —
  crítico — **12% de comisión** en vez del 5%/8% de Pro/Starter).

El **webhook de Stripe** SÍ tiene el código para escribir la fila (`src/app/api/stripe/webhook/route.ts`
~595-625, `upsert` con `plan_id`), y el checkout de suscripción vive en
`src/app/api/billing/checkout/route.ts`. Que la tabla esté vacía significa que ese **upsert nunca corrió
con éxito en prod** — el webhook no está llegando/procesándose (endpoint no configurado, `STRIPE_WEBHOOK_SECRET`
mismatch, o el handler falla), **o** nadie completó un checkout de pago todavía.

## Dos escenarios (el paso 1 los distingue — define la severidad)
1. **Hay suscripciones pagas reales en Stripe pero 0 filas en la BD** → **bug de provisioning P1/P0**:
   los suscriptores pagos reciben límites **y comisión** de Free → sub-entitlement + **sobrecobro de
   comisión** (12% en vez de 5%/8%) en cada venta. Arreglar el webhook + backfillear las filas.
2. **No hay ninguna suscripción activa en Stripe** (el usuario cree que es Pro pero nunca completó el
   checkout, o asumió que un trial/algo lo hizo Pro) → **no es bug funcional**; el tope de 5 es el
   comportamiento correcto de Free. El trabajo pasa a: (a) verificar end-to-end que un checkout de
   Pro/Starter **sí** provisiona la fila (hoy sin evidencia en prod), y (b) claridad de UX/estado del
   plan.

## Criterio de aceptación (Definition of Done)
- [ ] **Paso 1 (decisivo):** verificar en **Stripe** (dashboard/API) si `mauricioviera` — y cualquier
      otro — tiene una **suscripción activa** de Pro/Starter. Documentar el hallazgo en el PR/ticket.
- [ ] Si hay suscripciones activas en Stripe sin fila en la BD → **arreglar el webhook de subscription
      provisioning** (`api/stripe/webhook/route.ts`): confirmar endpoint configurado en prod, signing
      secret correcto, mapeo `price_id → plan_id` (incl. **precios yearly** `STRIPE_PRICE_*_YEARLY`),
      y que el `upsert` a `subscriptions` corre en los eventos correctos (`checkout.session.completed`
      y `customer.subscription.created/updated/deleted`). **Backfillear** las filas de los suscriptores
      afectados (incl. este usuario) para restaurar entitlement.
- [ ] Un fotógrafo con suscripción Pro/Starter activa resuelve a `maxEvents: null` → puede crear
      **>5 eventos**, y `getPlatformFeeRate` usa su tarifa real (5%/8%), no la de Free (12%).
- [ ] Verificar el **impacto en comisión**: si hubo ventas de suscriptores pagos cobradas al 12% por
      este bug, dejar registrado (posible reconciliación — coordinar con el usuario/owner; fuera del
      alcance de código pero **documentar**).
- [ ] test de regresión: (a) unit/integración de que un `subscriptions` con `plan_id='pro'` activo →
      `getCurrentPlan` devuelve Pro y `assertCanCreateEvent` no topa; (b) test del handler del webhook:
      un `checkout.session.completed`/`customer.subscription.updated` de Pro **escribe** la fila con
      `plan_id='pro'`, `status='active'` (incl. el price yearly). Falla antes / pasa después.
- [ ] **`/code-review high`** antes de commit (toca pagos/webhook). `pnpm typecheck && pnpm lint &&
      pnpm test` en verde.

## Notas
- **P1** — potencial bug de **dinero/entitlement** en un producto en vivo: si existen suscriptores
  pagos, reciben límites de Free **y** se les aplica 12% de comisión en vez de 5%/8% (sobrecobro). La
  tabla `subscriptions` vacía en prod es señal fuerte de que el path de provisioning nunca funcionó
  end-to-end. Si el paso 1 revela que **no hay** suscripciones pagas, bajar a P2 (verificación del
  flujo pre-lanzamiento, no incidente).
- Relacionado con la memoria **"Inngest prod sync drift"** y config de webhooks en prod — el webhook de
  Stripe es distinto de Inngest, pero el patrón (funciones/endpoints no configurados en prod) es el
  mismo sospechoso. Verificar en el dashboard de Stripe que el endpoint del webhook de prod existe y
  entrega OK (no 4xx/5xx).
- El `billing/checkout/route.ts` tenía **0% de cobertura** (auditoría de tests reciente) — el flujo de
  checkout→webhook→`subscriptions` es justamente el que no está verificado por tests; este ticket cierra
  parte de eso.
- No confundir con Stripe **Connect** (`profiles.stripe_connect_*`, payouts) — eso es otra cosa; el plan
  vive en `subscriptions`.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. **Verificar Stripe** (paso decisivo) antes de tocar código.
2. `git checkout main && git pull` → crear rama `fix/subscription-provisioning`.
3. Según el hallazgo: arreglar el webhook de provisioning + backfill, o cablear/verificar el flujo end-to-end + test.
4. `/code-review high` (pagos/webhook) + `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
7. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
