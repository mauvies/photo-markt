# T-034 · Aplicar cuota mensual de búsqueda IA por plan + búsquedas guardadas (revisitar sin gastar)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/ai-search-monthly-quota`
- **OpenSpec change:** **sí** — toca BD (tracking de uso) + diseño de "saved searches". `/opsx:propose` al ejecutar.
- **PR:** —

## Requerimiento
La copy de pricing anuncia una cuota mensual de búsqueda facial por plan (Free 10/mes, Starter 20/mes, Pro
ilimitado), pero **esa cuota mensual por plan no se aplica hoy** (el config existe pero es código muerto).
Implementar la **aplicación real** de la cuota mensual por plan, **y** que una búsqueda **guardada** se pueda
**revisitar sin consumir** una nueva búsqueda (requisito explícito del usuario al fijar 10/mes en T-030).

## Estado actual (verificado, durante T-030)
- `src/lib/ai/rate-limits.ts` declara `AI_SEARCH_RATE_LIMITS` (free 10 / starter 20 / pro null) **pero sus
  funciones (`hasExceededRateLimit`, `getRemainingSearches`, …) no se llaman en ningún sitio** → cuota mensual
  por plan **no enforced**.
- El limitador **vivo** hoy es otro: un cap por `(shareCode, IP)` de 10 búsquedas/hora.
- Las selfies son efímeras (no se almacenan) y los resultados de búsqueda **no se persisten** → no existe
  "revisitar una búsqueda" sin re-ejecutarla (y por tanto sin volver a llamar a Rekognition).
- T-030 dejó la copy y el config congruentes (Free = 10) + un test de guardia copy↔config, pero **no** implementó
  el enforcement (este ticket).

## Criterio de aceptación (Definition of Done)
- [ ] **Tracking de uso mensual por usuario** (tabla/migración, p. ej. `ai_search_usage` con ventana mensual) y
      enforcement real: al exceder la cuota del plan, bloquear con error tipado (patrón `PLAN_LIMIT:` / similar) y
      CTA de upgrade en la UI
- [ ] **Búsquedas guardadas:** persistir el resultado de una búsqueda (mapeo selfie→fotos encontradas) de forma que
      el talent pueda **revisitarla** sin gastar una nueva búsqueda ni re-llamar a Rekognition. Respetar que la
      **selfie sigue siendo efímera** (no almacenar la imagen; guardar solo el resultado/los IDs de foto)
- [ ] Mostrar "búsquedas restantes este mes" en la UI (ya hay `getRemainingSearches`, hoy sin uso)
- [ ] Cablear las funciones de `ai/rate-limits.ts` (dejar de ser código muerto) o reemplazarlas por el nuevo diseño
- [ ] Coexistir con el cap por `(shareCode, IP)`/hora ya existente (defensa anti-abuso) sin duplicar lógica
- [ ] El test de guardia de T-030 sigue verde (copy↔config); añadir tests del enforcement y del "revisit no gasta"
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde
- [ ] Actualizar la nota de `CLAUDE.md` (hoy dice que la cuota mensual "no está wired") cuando pase a estar enforced

## Notas
- **Decisión de producto pendiente confirmada por el usuario:** 10/mes free **asumiendo** que revisitar una búsqueda
  guardada no gasta cuota. Este ticket es justo esa premisa.
- Coste: cada búsqueda nueva llama a AWS Rekognition (cuesta) — por eso "revisitar sin gastar" importa
  económicamente, no solo de UX.
- Toca BD + privacidad (qué se persiste de una búsqueda) → `/opsx:propose` para capturar el diseño y `/code-review`.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/ai-search-monthly-quota`.
2. BD + diseño → `/opsx:propose` → `/opsx:apply`.
3. Migración + tracking + enforcement + saved searches + UI + tests.
4. `pnpm typecheck && pnpm lint && pnpm test`. `/code-review` (BD/cuotas).
5. Commit (Conventional Commits, **sin** `Co-Authored-By`).
6. `git push -u origin feat/ai-search-monthly-quota`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar `done`, archivar en `BACKLOG.md`. `/opsx:archive`.
