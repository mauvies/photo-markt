# T-045 · Checkout de upgrade: manejar fallos de Stripe sin crash opaco

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno (el deliverable de código no depende de nada; ver Nota operativa)
- **Rama:** `fix/billing-checkout-stripe-error-handling`
- **OpenSpec change:** —  (se crea al ejecutar si toca >1 archivo)
- **PR:** —

## Requerimiento
Al intentar hacer upgrade al plan **Starter**, la app revienta con un error opaco:
*"An error occurred in the Server Components render. The specific message is omitted in
production builds…"* (con `digest`). En los logs de Vercel el error real es de Stripe:
`StripeAuthenticationError` → `Expired API Key provided: sk_test_…cFgYOv` (`code:
api_key_expired`, 401).

Causa raíz **inmediata**: la `STRIPE_SECRET_KEY` en Vercel es una **test key expirada** →
desbloqueo operativo (rotar la key), **no** código (ver Nota operativa).

Gap de **código** a corregir: en `createBillingCheckoutAction`
(`src/app/[lang]/dashboard/photographer/billing/actions.ts`) la ruta "sin suscripción
activa → crear customer + checkout session" (≈ líneas 104‑143) **no tiene try/catch**. Solo
la ruta "actualizar suscripción existente" (72‑101) lo tiene. Por eso un fallo de Stripe en
`stripe.customers.create()` / `stripe.checkout.sessions.create()` se propaga crudo fuera del
Server Action, Next lo redacta en producción y el usuario ve el mensaje genérico en vez de
uno traducido y accionable. Hay que blindar **toda** llamada a Stripe del flujo de billing
para que cualquier fallo (key expirada/inválida, red, config) degrade con un mensaje claro.

## Criterio de aceptación (Definition of Done)
- [ ] La ruta de creación de customer + checkout session en `createBillingCheckoutAction`
      está envuelta en manejo de error: un fallo de Stripe lanza/devuelve un error de
      dominio limpio (p. ej. `throw new Error('checkout_failed')`), **nunca** deja propagar
      el error crudo de Stripe fuera del Server Action.
- [ ] El usuario ve un mensaje **traducido** y accionable (toast) en lugar del genérico de
      Server Components. `UpgradeHandler` (y el resto de call sites de
      `createBillingCheckoutAction`) ya hacen `try/catch` + toast — el mensaje que reciben
      debe ser uno controlado, no el `digest` redactado.
- [ ] Auditar el resto de llamadas a Stripe del flujo de billing/settings por el mismo
      patrón (`cancelSubscriptionAction` ya está envuelto; revisar `payout-profile/actions.ts`
      `getStripeConnectStatusAction` y `earnings/actions.ts` `getStripeConnectBalanceAction`,
      que corren server-side y podrían tumbar el render si Stripe falla).
- [ ] strings nuevos en `en.json` y `es.json` (mensaje de error de checkout)
- [ ] test de regresión: mockear `stripe.customers.create` (o `checkout.sessions.create`)
      para que lance `api_key_expired`/`StripeAuthenticationError` y assertear que la acción
      devuelve/lanza el error de dominio limpio (no filtra el mensaje crudo de Stripe). Falla
      antes del fix, pasa después.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

### Nota operativa (desbloqueo inmediato — fuera del alcance del código)
Esto NO lo resuelve `/work-next`; hazlo en el dashboard, restablece upgrades en prod ya:
1. Rotar `STRIPE_SECRET_KEY` en Vercel (Project → Settings → Environment Variables).
2. En **producción** usar una **live key** (`sk_live_…`), no una test key. Confirmar que
   `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_AMATEUR`, `STRIPE_PRICE_PRO` corresponden al mismo
   modo (live) — una key live con price IDs de test (o viceversa) también rompe el checkout.
3. Redeploy para tomar la env nueva.

El ticket de código es defensa en profundidad: aunque se rote la key, hoy cualquier fallo de
Stripe en el alta de checkout tumba el flujo con un error ilegible.

### Contexto de código
- `createBillingCheckoutAction` — `src/app/[lang]/dashboard/photographer/billing/actions.ts`
- Cliente Stripe: `src/lib/stripe/config.ts` (`new Stripe(env.STRIPE_SECRET_KEY, …)`)
- Disparador: `UpgradeHandler` (`settings/upgrade-handler.tsx`) ya tiene `try/catch` + toast.
- `priceIdFor` ya lanza un error limpio para el caso yearly — replicar ese estilo.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
