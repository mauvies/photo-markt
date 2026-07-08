# T-086 · [Seguridad] `getClientIp` confía en el primer `x-forwarded-for` (spoofeable) — usar `x-real-ip`

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/client-ip-trusted-header`  (tipo = fix)
- **OpenSpec change:** —  (cambio puntual en `src/lib/rate-limit.ts`)
- **PR:** —
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-16**, ítem #3 del plan)

## Requerimiento
`getClientIp` (`src/lib/rate-limit.ts:95-104`) toma el valor **más a la izquierda** de
`x-forwarded-for`, que es controlable por el cliente (Vercel appendea la IP real a la derecha).
Un atacante rota la key per-IP gratis variando un header, debilitando 6 de los 9 limiters
(face search, bib search, load-more, bulk download, guest uploads, health). Cambiar a
`x-real-ip` (la IP observada por el edge de Vercel, no spoofeable) o al hop **más a la derecha**
de `x-forwarded-for`.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** tests de caracterización de `getClientIp` con los shapes de header
      actuales (XFF simple, XFF múltiple, x-real-ip, sin headers → 'unknown'), en verde **antes**
      del cambio
- [ ] `getClientIp` prioriza `x-real-ip`; fallback al valor más a la derecha de `x-forwarded-for`;
      `'unknown'` solo sin headers
- [ ] Un `x-forwarded-for` forjado por el cliente ya no cambia la key del limiter
- [ ] test de regresión que falla antes y pasa después (XFF spoofeado con IP real appendeada →
      devuelve la IP real, no la forjada)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Es una función pura con tests unitarios baratos (`test/unit/`) — el caso ideal del requisito de
  cobertura previa.
- La rotación real de IPs (CGNAT, IPv6 /64) sigue siendo inherente a limiters per-IP — eso es
  territorio de **T-034**, no de este ticket.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/client-ip-trusted-header`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
