# T-085 · [Seguridad] Rate limit en el checkout de invitados (API paga de Stripe sin límite ni auth)

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/rate-limit-guest-checkout`  (tipo = fix)
- **OpenSpec change:** —  (patrón existente de `src/lib/rate-limit.ts`, un call site)
- **PR:** —
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-15**, ítem #2 del plan)

## Requerimiento
`createGuestCheckoutSessionAction` (`src/app/[lang]/cart/actions.ts:16,76`) crea sesiones de
Stripe (`checkout.sessions.create`, API paga) **sin autenticación y sin rate limit** — cualquier
anónimo puede mintear sesiones ilimitadas (+ una lectura de DB de todos los photoIds por llamada).
Es el gap de abuso más serio del inventario de limiters. Aplicar el limiter existente, keyed por
IP, espejando el del checkout autenticado (`stripe-checkout:${uid}`, 20/h).

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** test de caracterización del flujo actual de guest checkout (crea sesión
      con carrito válido) en verde **antes** del cambio
- [ ] `createGuestCheckoutSessionAction` aplica `rateLimit` (p.ej. `guest-checkout:${ip}`, límite
      conservador ~10/h) y devuelve error amigable al exceder
- [ ] El flujo legítimo de compra guest no se ve afectado (límite holgado para uso real)
- [ ] test de regresión que falla antes y pasa después (N+1 llamadas → rechazada)
- [ ] strings de error en `en.json` y `es.json` si el error llega a UI
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Mismo patrón que `api/stripe/checkout/route.ts:27`. Usar `getClientIp` — coordinar con **T-086**
  (arregla la confianza en `x-forwarded-for`); si T-086 no está mergeado, no bloquear: el limiter
  suma aunque la key sea imperfecta.
- Del mismo hallazgo quedó anotado (menor, no incluir aquí): `api/billing/checkout` tampoco tiene
  limiter (inconsistente con su hermano) — queda para captura futura si se prioriza.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/rate-limit-guest-checkout`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
