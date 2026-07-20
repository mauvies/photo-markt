# T-159 · El webhook de suscripción guarda `current_period_end` siempre null (campo movido a los items en la API basil)

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/subscription-current-period-end`  (tipo = fix)
- **OpenSpec change:** —  (probable: toca el webhook de pagos; crear al ejecutar)
- **PR:** #219

## Requerimiento
Hallazgo CONFIRMED del `/code-review high` de T-152 (bump del SDK de Stripe 20→22).
El handler de `customer.subscription.created/updated` (`src/app/api/stripe/webhook/route.ts:587`)
lee `sub.current_period_end` a nivel raíz de la suscripción (vía `as any`), pero Stripe **movió
ese campo a `subscription.items.data[].current_period_end`** en la API version `2025-03-31.basil`.
Como el pin ya estaba en `clover` (2026-02, post-basil) — y ahora en `dahlia` (2026-06) tras T-152 —
el campo raíz es `undefined`, así que `currentPeriodEnd` siempre resuelve a `null` y la columna
`subscriptions.current_period_end` se escribe/actualiza **siempre null**.

**Es pre-existente** (delta cero respecto al bump de T-152: clover ya era post-basil) y **hoy es inerte**
— la columna es **write-only**: ningún componente/UI/lógica de renovación la lee (verificado en T-152:
solo la escribe el webhook, `getSubscription` la tipa pero nadie la consume). Se captura ahora porque
es el momento natural de corregir la lectura antes de que alguna feature futura (fecha de renovación en
`settings/billing`, lógica de expiración) empiece a depender de una columna silenciosamente vacía.

## Causa (verificada en código)
`src/app/api/stripe/webhook/route.ts:583-589`:
```ts
// biome-ignore lint/suspicious/noExplicitAny: subscription object
const sub = subscription as any;
const currentPeriodEnd =
  typeof sub.current_period_end === 'number'
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;
```
`subscription.current_period_end` ya no existe a nivel raíz en basil+; vive en cada item
(`subscription.items.data[0].current_period_end`, epoch seconds).

## Criterio de aceptación (Definition of Done)
- [ ] El webhook lee `current_period_end` desde `subscription.items.data[0]?.current_period_end`
      (el periodo de facturación del primer/único item), con el mismo fallback a `null` si ausente.
- [ ] Tipar correctamente (evitar el `as any` si el tipo del SDK ya lo expone en el item) o
      documentar por qué se conserva; sin nuevos `any` gratuitos.
- [ ] test de regresión (integración del webhook): un evento `customer.subscription.updated` con
      `items.data[0].current_period_end` poblado escribe la fecha ISO correcta en la columna
      (falla antes — hoy escribe null — y pasa después).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.
- [ ] Smoke-test manual: alta de suscripción de fotógrafo → la columna queda con la fecha de fin de periodo.

## Notas
- Toca el webhook de pagos → `/code-review` sobre el diff antes de commitear.
- Bajo prioridad (P3) porque hoy la columna no se lee en ningún lado — es corrección de corrección,
  no un bug con impacto de usuario actual.
- Relacionado: familia T-151/T-152 (deps). Contexto en el review de T-152 (finding [0] CONFIRMED).

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
