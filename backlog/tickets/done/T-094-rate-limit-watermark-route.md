# T-094 · [Seguridad] Rate limit + `maxDuration` en `/api/watermark` (amplificación de egress/CPU sin límite)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/rate-limit-watermark-route`  (tipo = fix)
- **OpenSpec change:** —  (patrón de limiter existente)
- **PR:** #156 (stacked sobre #155, el hotfix de en.json)
- **Dep:** T-086 (key de IP confiable primero)
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-22**, ítem #11 del plan)

## Requerimiento
`/api/watermark/[...path]` es público por diseño, sin `rateLimit` ni `maxDuration`. Cada path
único es una cache key nueva del CDN que fuerza **1 descarga del original desde Supabase + 1
encode de Sharp**. Enumerar paths válidos (o simplemente muchos paths distintos) amplifica egress
y CPU sin tope. Las vistas legítimas están mayormente cubiertas por el edge cache de 24 h — el
limiter apunta al abuso, no al uso normal.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** los tests existentes de la ruta watermark (si hay en
      `test/integration/api/`) o de caracterización mínima (sirve preview válida, 404 fail-closed)
      en verde **antes** del cambio
- [ ] `rateLimit` per-IP en la ruta (límite generoso — una galería puede pedir ~50 tiles en el
      primer view sin cache; p.ej. 300/h con margen para el thundering herd del pre-bake, F-23)
- [ ] `export const maxDuration` acotado en la ruta (evita Sharp colgado facturando)
- [ ] Respuesta 429 con `Retry-After` (helper existente `retryAfterSeconds`); **sin** poisonear el
      CDN (el 429 debe ser `no-store`, como ya hacen los placeholders)
- [ ] test de regresión que falla antes y pasa después (N+1 requests → 429)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Calibrar el límite con el caso real: primer view de galería sin bake = N tiles simultáneos del
  mismo IP. El límite debe absorber 2-3 galerías grandes/hora por IP sin fricción.
- El edge cache de Vercel sirve los hits DESPUÉS del limiter check solo en miss — verificar que
  el limiter no cuenta hits ya cacheados en edge (no llegan a la función; correcto por diseño).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/rate-limit-watermark-route`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
