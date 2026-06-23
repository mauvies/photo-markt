# T-033 · Implementar prioridad en resultados de búsqueda por plan

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/search-result-priority`
- **OpenSpec change:** **probable** — cambia ranking/orden de resultados (lógica de negocio). Evaluar `/opsx:propose`.
- **PR:** —

## Requerimiento
Anunciamos "Priority in search results" (Starter) y "Highest priority in search results" (Pro), pero **no está
implementado** (hoy badge "Coming soon" desde T-030). Implementar que las fotos/fotógrafos de planes superiores
aparezcan con mayor prioridad en los resultados de búsqueda.

## Estado actual (verificado)
- No hay ranking ponderado por plan en `src/database/queries/events.ts` ni en la búsqueda (`grep priority/ranking`
  no encuentra lógica por plan).
- Anunciado en `pricingSection` (`starterFeature7` = prioridad, `proFeature7` = máxima prioridad), badge
  "Coming soon" tras T-030.
- La búsqueda actual (`event-search-bar`) consulta Supabase por nombre/ciudad/display_name (ver CLAUDE.md
  "Event Search"), sin ponderación por plan.

## Criterio de aceptación (Definition of Done)
- [ ] Definir la regla de negocio: ¿prioridad de qué exactamente? (fotógrafo en resultados de eventos/perfiles, o
      fotos del fotógrafo) y cómo se ordena Free < Starter < Pro
- [ ] Implementar el ordenamiento por plan en la query de búsqueda correspondiente, sin romper la relevancia base
      (el match textual sigue mandando; el plan desempata/pondera)
- [ ] No degradar el rendimiento de la búsqueda (índices si hace falta)
- [ ] Quitar el badge "Coming soon" de `starterFeature7`/`proFeature7` en `plan-features.ts`
- [ ] Test que verifique el orden por plan a igualdad de relevancia
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Decisión de producto: cuánto pesa el plan vs. la relevancia textual (no queremos resultados irrelevantes arriba
  solo por plan). Capturar en `/opsx:propose` si resulta ambiguo.
- Coordinar con `feature/search-bar-refactor` si sigue activo.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/search-result-priority`.
2. Si el diseño del ranking es ambiguo → `/opsx:propose`.
3. Implementar orden por plan + test; quitar badge coming-soon.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** `Co-Authored-By`).
6. `git push -u origin feat/search-result-priority`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar `done`, archivar en `backlog/BACKLOG.md`.
