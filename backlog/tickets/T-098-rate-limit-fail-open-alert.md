# T-098 · [Observabilidad] Alerta Sentry cuando el rate limiter falla open (hoy: solo `console.error`)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/rate-limit-fail-open-alert`  (tipo = fix)
- **OpenSpec change:** —  (un módulo)
- **PR:** —
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-20**, ítem #19 del plan)

## Requerimiento
El rate limiter falla open por diseño (`src/lib/rate-limit.ts:80-85`): cualquier error del backend
→ `ok:true` con solo un `console.error`. Correcto para no bloquear usuarios legítimos en una
caída, pero **invisible**: un outage sostenido de la DB desactiva silenciosamente TODOS los
limiters (incluido el de face search, que protege gasto AWS) sin ninguna señal. Capturar el evento
en Sentry para que la degradación sea visible.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** test de caracterización del fail-open actual (backend lanza → `ok:true`,
      `remaining:limit`) en verde **antes** del cambio — la semántica fail-open NO cambia
- [ ] En el catch del fail-open se emite `Sentry.captureException` (o `captureMessage` con
      contexto: key, límite, error) además del `console.error`
- [ ] Sin DSN configurado el SDK es no-op (convención existente del proyecto) — no romper tests
      ni entornos sin Sentry
- [ ] Deduplicación razonable: no un evento Sentry por request durante un outage (fingerprint o
      muestreo — decidir al ejecutar, documentar)
- [ ] test de regresión que falla antes y pasa después (spy: el capture se llama en fail-open)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- La semántica fail-open se preserva a propósito (decisión existente documentada en el módulo);
  este ticket solo añade visibilidad.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/rate-limit-fail-open-alert`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
