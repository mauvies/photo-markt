# T-148 · Arreglar el flujo de suscripción a plan para usuarios nuevos/no autenticados (preservar intención en signup + retorno post-pago)

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno (no existe un ticket separado del "bug RLS 42501 de subscriptions"; el concern es **in-scope** aquí — ver Parte 1)
- **Rama:** `feat/plan-subscription-intent-flow` (tipo = feat)
- **OpenSpec change:** sí (auth + pagos + multi-archivo + seguridad — capturar diseño/spec antes; `/opsx:propose` → `/opsx:apply`)
- **PR:** #206

## Requerimiento
Un usuario **no autenticado** en `/photographers` que elige un plan en pricing hoy **no tiene camino funcional para suscribirse** — ni Free ni de pago. El flujo correcto **preserva el plan elegido a través del signup**, ramifica por tipo de plan, y devuelve al usuario al dashboard en estado de éxito tras el pago — manejando el gap entre el redirect de Stripe y el provisioning por webhook. Investigar por qué nada funciona hoy e implementar el flujo estándar de preservación de intención end-to-end. **La activación del plan la hace SIEMPRE el webhook, nunca el `success_url`.**

## Parte 1 — Hallazgos de investigación (ya verificados en el código)
- **CTA de pricing** (`src/components/pricing-plan-button.tsx`): 
  - Free → `<Link href="/signup">` (**sin** intención de plan, sin rama).
  - Pago **logged-out** → `<Link href="/signup?plan={planId}&period={period}">` (la intención **ya se acarrea** por query param).
  - Pago **logged-in** → llama `createBillingCheckoutAction(planId, period)` (`billing/actions.ts`); en fallo cae a `/signup?plan=...`.
- **El gap central:** el signup/onboarding **no consume `?plan=`** → no hay lógica de **resume/branch** tras registrarse. Por eso "nada funciona" para un usuario nuevo: llega a `/signup?plan=starter` y ahí muere la intención.
- **Free NO necesita insert:** `getCurrentPlan` (`queries/subscriptions.ts`) **deriva** el plan y hace fallback a **Free cuando no hay fila** de subscription activa. Es decir, Free = ausencia de sub activa → el camino Free es "aterrizar en el dashboard", **sin** escribir nada, **sin** Stripe.
- **Activación de pago = webhook con `supabaseAdmin`:** el webhook (`api/stripe/webhook/route.ts`, `checkout.session.completed` mode `subscription`) escribe subscriptions vía **service role** (RLS-safe). O sea la activación **no** está bloqueada por RLS.
- **El "bug RLS 42501 on insert":** **no existe un ticket separado** para él. Casi seguro es un **insert de subscription con el cliente user-scoped** (subscriptions es system-managed; no hay policy INSERT para `authenticated` → 42501). El diseño correcto **evita** ese insert por completo: **Free no inserta** (default derivado) y **pago se activa por webhook/admin**. → Confirmar en la implementación que ningún camino inserta subscription con el cliente user-scoped; si aparece, arreglarlo aquí (service-role para estado system-managed), **no** debilitar RLS. No es blocker externo.

## Parte 2 — Implementar preservación de intención
- CTAs de pricing para logged-out **acarrean el plan** al signup (ya lo hacen para pago; **añadir** intención al Free también, o ramificar Free explícitamente post-signup).
- **Lógica de resume post-signup** (tras registro + verificación si aplica) ramifica por tipo:
  - **Free:** sin pago; asegurar que la cuenta queda en Free (su estado por defecto — **no** crear fila) y aterrizar en el dashboard. **No** rutear Free por Stripe.
  - **Pago (Starter/Pro):** ir **directo** al Stripe checkout de **ese** plan — no de vuelta a pricing a re-elegir.
- **Usuarios ya autenticados** que clican un CTA saltan el signup y van directo a la rama (Free o checkout). Verificar este camino también.

**Seguridad (crítico):**
- El destino post-signup se **valida server-side**: solo rutas internas conocidas de plan/checkout. **No** open-redirect que acepte una URL arbitraria del query string. **Whitelist de valores de plan** (`'free'|'starter'|'pro'` desde `src/lib/plans.ts`), no confiar en una URL cruda. Reusar el criterio de `src/lib/auth/safe-next.ts` para cualquier `next`/redirect.
- El plan/precio que termina cobrándose se **re-deriva/valida server-side** en la creación del checkout desde `src/lib/plans.ts` (fuente única) — **nunca** un precio/amount del cliente. Un usuario no debe poder manipular la intención hacia un precio más barato o un plan que no pagó.

## Parte 3 — Retorno post-pago y provisioning (gap redirect/webhook)
- El **redirect** (`success_url` de Stripe) devuelve el navegador al **dashboard/overview en estado de éxito**, inmediato.
- La **activación** la hace el **webhook** (`checkout.session.completed`), que puede llegar unos segundos después.
- Requisitos:
  - Tras completar checkout, el usuario aterriza en dashboard/overview en estado de éxito.
  - El dashboard **tolera el gap**: muestra "confirmando tu suscripción…"/estado pendiente o revalida el plan brevemente, en vez de renderizar un "sigues en Free" stale justo tras pagar. Al completar el webhook, ve su plan activo.
  - La activación la maneja **exclusivamente el webhook**, **nunca** llegar al `success_url` (se puede navegar a esa URL a mano → activar ahí regalaría plan sin pagar).
  - **Cancel/back:** si abandona el checkout (`cancel_url`), devolverlo a un lugar sensato (pricing o billing) sin estado roto ni subscription parcial.

## Alcance
- CTAs de pricing en `/photographers` (y donde compartan el mismo componente, p.ej. selección de plan en billing).
- Flujo de signup (acarrear + resumir intención).
- Transición a Stripe checkout (pago) / asignación Free (sin pago).
- Manejo de `success_url`/`cancel_url` y el estado post-pago del dashboard.

## Criterio de aceptación (Definition of Done)
- [ ] No-auth elige **Free** → signup → aterriza en dashboard en Free, **sin** paso de pago (sin fila de subscription creada).
- [ ] No-auth elige **Starter/Pro** → signup → aterriza **directo** en el Stripe checkout de ese plan (no en pricing), y tras pagar tiene el plan activo.
- [ ] El plan elegido se preserva a través del signup; nunca se devuelve al usuario a pricing a re-elegir.
- [ ] Usuarios ya autenticados que clican un CTA van directo a la rama correcta (Free o checkout de ese plan).
- [ ] El redirect post-signup se **valida server-side** a rutas internas de plan/checkout — **sin** open-redirect (whitelist de plan, no URL cruda).
- [ ] El plan y precio suscritos se derivan **server-side** de `plans.ts`, nunca del cliente.
- [ ] Tras completar el checkout, el usuario va a dashboard/overview en éxito; el dashboard **tolera el gap** redirect↔webhook (estado pendiente/confirmando o revalidación) y **nunca** muestra "sigues en Free" roto tras pagar.
- [ ] La activación la maneja el **webhook**, nunca el `success_url`.
- [ ] Abandonar el checkout (cancel) devuelve a un lugar sensato sin estado parcial/roto.
- [ ] Si el bug RLS 42501 de subscriptions resultara real, se identifica y arregla **aquí** (service-role para escritura system-managed; sin debilitar RLS) — no hay ticket separado que referenciar.
- [ ] strings nuevos (estado "confirmando suscripción", etc.) en `en.json` **y** `es.json`.
- [ ] test de regresión/feature: intención preservada Free vs pago (logged-out y logged-in); validación server-side del plan (whitelist, no open-redirect; precio desde `plans.ts`); dashboard tolera el gap (pendiente→activo); llegar al success_url **no** activa plan.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` (+ `build`) en verde.

## Constraints
- Comisión/precio/plan desde la fuente única `src/lib/plans.ts` — sin amounts del cliente.
- Escrituras de subscription con el cliente correcto por el modelo RLS (service-role para estado system-managed) — no debilitar RLS.
- Nunca tratar la llegada al `success_url` como prueba de pago ni como trigger de activación.
- Mutaciones vía Server Actions; queries en `/database/queries/`. Sin `any`; Biome. **Sin otros cambios.**

## Notas
- Reusar: `src/lib/plans.ts` (fuente de verdad), `createBillingCheckoutAction` (`billing/actions.ts`), `src/lib/auth/safe-next.ts` (validación de redirect), `getCurrentPlan` (default Free derivado).
- **Toca pagos + auth + seguridad (open-redirect / tamper de precio) → `/code-review` obligatorio antes de commitear; `/code-review ultra` recomendado (pagos).**
- No solapa con otro ticket abierto; complementa T-120 (landing de fotógrafos, que dejó `?plan=` como hint sin resume).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/plan-subscription-intent-flow`.
2. `/opsx:propose` → `/opsx:apply` (auth+pagos+seguridad).
3. Investigar/confirmar (Parte 1) → implementar Partes 2 y 3 + tests de regresión.
4. `pnpm typecheck && pnpm lint && pnpm test` (+ build).
5. `/code-review` sobre el diff (`ultra` recomendado por pagos) y arreglar findings reales.
6. Commit (Conventional Commits, **sin** `Co-Authored-By`); `git push -u origin <rama>`; `gh pr create --draft`.
7. Marcar ticket `done`, mover a Archivo con el nº de PR, mover el archivo a `backlog/tickets/done/`; `/opsx:archive`.
