# T-095 · [Perf/Auth] Memoización per-request de auth: `getRoleContext()` en layouts + React `cache()` (~6 → 1-2 round-trips)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `perf/request-level-auth-memoization`  (tipo = perf; **toca auth → correr `/code-review` antes de commitear**)
- **OpenSpec change:** evaluar al ejecutar (toca auth en >1 archivo — probable que sí)
- **PR:** #157
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-19**, ítem #12 del plan)

## Requerimiento
Un render del dashboard hace **~6 round-trips de red a Supabase Auth** (`getUser()`): middleware +
layout + `getActiveRoleOrNull` + `userHasRole` (cada uno re-autentica vía
`getAuthenticatedClient`, `roles.ts:37`) + page + `getDashboardData`. El fix ya existe a medias:
`getRoleContext()` (`roles.ts:221-241`) colapsa los dos helpers de rol en un solo round-trip y
está documentado exactamente para esto — pero los dos layouts del dashboard (el hot path) no lo
usan. Además no hay React `cache()` en ningún lado: `createClient()`/`getUser()`/lecturas de
`profiles` se repiten 2-3× por render.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** tests de caracterización del comportamiento actual de los layouts
      (usuario sin rol → redirect a onboarding, talent en dashboard photographer → redirect, etc.)
      en verde **antes** del cambio — el gating de roles es seguridad, no puede regresionar
- [ ] `dashboard/photographer/layout.tsx` y `dashboard/talent/layout.tsx` usan `getRoleContext()`
      en lugar de `getActiveRoleOrNull` + `userHasRole` separados
- [ ] `createClient()` y una helper `getUser()` envueltos en React `cache()` (memoización
      per-request); lecturas repetidas de `profiles` dentro de un render colapsadas
- [ ] El número de llamadas a auth por render de dashboard baja de ~6 a ≤2 (asertable con un spy
      en tests)
- [ ] Comportamiento de redirects/gating idéntico (los tests de cobertura previa pasan sin cambios)
- [ ] test de regresión que falla antes y pasa después (contador de llamadas)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **No** tocar el middleware ni el gate anónimo (`proxy.ts:62-66` — verificado bueno, preservar).
- `getClaims()`/verificación local de JWT (F-30) es la palanca grande a futuro — **fuera de este
  ticket** (queda en el reporte), este es el paso barato y sin riesgo criptográfico.
- Bonus de paso si es trivial: fix de los nombres de cookie muertos en `proxy.ts:121-122`
  (borra `sb-access-token`/`sb-refresh-token` literales que supabase-ssr no escribe).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `perf/request-level-auth-memoization`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
