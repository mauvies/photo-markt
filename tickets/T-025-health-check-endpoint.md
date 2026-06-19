# T-025 · Endpoint de health check (`/api/health`)

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/health-check-endpoint`
- **OpenSpec change:** —  (endpoint mínimo)
- **PR:** —

## Requerimiento
Parte de «preparar la app para producción». No existe endpoint de liveness/health. Añadir un `GET /api/health`
ligero que devuelva 200 + estado, usable por monitores de uptime externos (status page, cron de ping).

## Estado actual (verificado)
- `src/app/api/` tiene `admin/`, `billing/`, `events/`, `inngest/`, `stripe/`, `thumb/`, `watermark/` — sin health probe.

## Criterio de aceptación (Definition of Done)
- [ ] `GET /api/health` → `200` con JSON `{ status: "ok", ... }`, sin auth, sin tocar datos sensibles
- [ ] **Liveness barato**: no hace queries pesadas; opcionalmente un ping mínimo a Supabase con timeout corto
      y degradación a `503` si la dependencia crítica está caída (decidir alcance liviano, no monitoreo completo)
- [ ] `Cache-Control: no-store`; no indexable (queda cubierto por disallow de `/api` en `robots.ts`)
- [ ] Sin claves i18n (no es UI)
- [ ] Test del handler: 200 + shape del payload; falla antes, pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Mantenerlo **mínimo**: el objetivo es un probe simple, no un dashboard de salud. Empezar con liveness puro;
  el chequeo de dependencias puede ser un follow-up si se quiere.
- No exponer versión/commit ni datos internos más allá de un `status` básico.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/health-check-endpoint`.
2. Acotado → implementar directo (sin OpenSpec).
3. Route handler + test.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/health-check-endpoint`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
