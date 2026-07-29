# T-202 · Podar las API routes muertas `api/billing/checkout` y `api/billing/cancel`

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno para empezar — **gate de verificación en Stripe antes de borrar** (ver DoD)
- **Rama:** `chore/remove-dead-billing-api-routes`
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** —

## Requerimiento
Eliminar `src/app/api/billing/checkout/route.ts` y `src/app/api/billing/cancel/route.ts`: son el
remanente de antes de migrar la facturación a Server Actions. **Cero callers** en todo `src/`, y su
funcionalidad ya vive en `src/app/[lang]/dashboard/photographer/billing/actions.ts`
(`createBillingCheckoutAction` / `cancelSubscriptionAction`).

Antes de borrar, **verificar que nada externo las apunte** (dashboard de Stripe, config de entorno).

## Verificación ya hecha en el repo (evidencia, no supuesto)
- `grep` de `billing/checkout` / `billing/cancel` en todo `src/`, `test/` y `docs/`: **ningún caller**.
  Único hit fuera de las propias rutas es `docs/CACHING_AUDIT.md:281`, que ya las marcó como riesgo.
- `next.config.ts` `redirects()` tiene **una sola** entrada (`talent/photos` → `talent/favorites`); no hay
  redirect ni rewrite hacia `/api/billing/*`. No hay `vercel.json`.
- `git log -- src/app/api/billing/`: los últimos dos commits que las tocan son un upgrade de Biome
  (`e2aa988`) y el movimiento del código a `src/` (`13e51a9`) — ningún cambio funcional en mucho tiempo.
- **Ambas leen la sesión de Supabase por cookie** (`supabase.auth.getUser()` → 401 sin sesión) y **solo
  exportan `POST`**. Consecuencia: un webhook de Stripe daría **401** (Stripe no manda cookies de sesión)
  y un `success_url`/`cancel_url` de Stripe daría **405** (son navegaciones GET). Es decir: **ninguna
  integración externa puede estar funcionando contra ellas hoy** — si alguna URL quedó registrada, está
  fallando en silencio, no sirviendo tráfico.

## Riesgo real que justifica borrarlas (no es solo higiene)
No son inertes: son endpoints `POST` vivos y alcanzables por **cualquier usuario autenticado**, y
**escriben**. `api/billing/checkout` crea un **Stripe customer** e **inserta una fila en `subscriptions`**.
Además está **divergente** de la action que la reemplazó:
- `success_url` apunta a `/dashboard/photographer/settings?status=success` — **sin prefijo de locale** y a
  una ruta distinta de la que usa la action (`/dashboard/photographer?checkout=success`).
- **No soporta facturación anual** (la action tiene `billing_period` y el error tipado `yearly_unavailable`).
- No pasa por el manejo de errores tipado de la action (`BillingCheckoutError`).
Un usuario que la golpee directo obtiene un flujo de suscripción viejo y roto contra datos reales.

## Criterio de aceptación (Definition of Done)
- [ ] **GATE (usuario, requiere acceso al dashboard de Stripe — yo no lo tengo):** confirmar que **ningún
      endpoint de webhook** en Stripe (test **y** live) apunta a `/api/billing/checkout` o
      `/api/billing/cancel`, y que ningún Payment Link / Price / portal config los use como redirect.
      Mismo patrón manual que T-192, donde el endpoint mal registrado fue la causa raíz. Dejar el
      resultado escrito en el PR.
- [ ] Revisar variables de entorno en Vercel (los 3 entornos) por cualquier URL que contenga
      `/api/billing` — no debería haber ninguna (`env.mjs` no declara ninguna)
- [ ] `src/app/api/billing/checkout/route.ts` y `src/app/api/billing/cancel/route.ts` eliminados
      (y el directorio `src/app/api/billing/` si queda vacío)
- [ ] `POST /api/billing/checkout` y `POST /api/billing/cancel` devuelven **404** tras el cambio
- [ ] El flujo de suscripción vivo sigue intacto: `createBillingCheckoutAction` desde
      `/dashboard/photographer/settings/billing` crea la sesión de Stripe y redirige igual que antes
- [ ] `docs/CACHING_AUDIT.md:281` actualizado (el hallazgo queda resuelto por eliminación, no pendiente)
- [ ] strings nuevos en `en.json` y `es.json` (N/A — no hay UI)
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Test sugerido:** guard source-level de que no existe ningún `route.ts` bajo `src/app/api/billing/`
  (rojo antes / verde después), en la línea del `stripe-webhook-setup-doc.test.ts` de T-192. Un test que
  haga fetch a la ruta no sirve: en unit no hay servidor.
- **Hallazgo colateral, decidir en el PR:** `cancelSubscriptionAction` (`billing/actions.ts:224`) **también
  tiene cero callers** — no hay UI de cancelación en ninguna parte. Borrar la route no quita ninguna
  capacidad que el usuario tenga hoy (no la tiene). **No borrar la action en este ticket**: la pregunta
  "¿debe haber botón de cancelar suscripción?" es de producto y merece su propio ticket. Solo dejarlo
  anotado.
- Si el gate de Stripe revela que **sí** hay algo apuntando a esas URLs: **parar y no borrar** —
  convertirlo en un ticket de migración de ese consumidor primero.
- Sin OpenSpec. **Sí correr `/code-review`** pese a ser un borrado: toca superficie de pagos, y el
  criterio del repo es que pagos se revisa (lo lanza el usuario, no el agente).
- Correr también `pnpm build`: eliminar file conventions de `app/` solo se valida al buildear
  (memoria `build-catches-client-graph-errors`).
- Familia: T-192 (webhook mal registrado — mismo tipo de deriva entre URL registrada y código),
  T-045 (error tipado en checkout de suscripción).
