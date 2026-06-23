# T-036 · Quitar la cuota mensual de búsqueda IA a medias + dropear esquema huérfano

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `chore/remove-ai-search-quota`
- **OpenSpec change:** —  (eliminación de código/esquema muerto; sin diseño nuevo. `/code-review` corrido por tocar migración.)
- **PR:** #87

## Requerimiento
La "cuota mensual de búsqueda IA por plan" está **a medias y no es honrable** (el buscador es talent/invitado
anónimo, la cuota se anuncia en planes del fotógrafo — ver T-034). Por ahora, **quitar todo lo relacionado** para
no anunciar un presupuesto de búsqueda que no podemos cumplir y eliminar el esquema huérfano que da falsa sensación
de "trackeamos cuota". El rediseño real queda capturado en **T-034** (blocked).

## Estado actual (verificado, 2026-06-22)
- `ai_search_usage` (tabla) + `increment_ai_search_usage` / `get_ai_search_usage_count` (funciones SECURITY
  DEFINER) + trigger `set_ai_search_usage_updated_at`: **cero referencias en app/seed/tests** (solo sus propias
  migraciones `20250219000002` y `20260518000001`).
- `src/lib/ai/rate-limits.ts` (`AI_SEARCH_RATE_LIMITS` + helpers): **código muerto**; solo lo referencia el test
  de guardia `test/unit/lib/pricing-consistency.test.ts` (de T-030).
- Copy: `pricingSection.freeFeature5` = "Face recognition (10 searches/month)" / "Reconocimiento facial (10
  búsquedas/mes)" — promete un número mensual no enforced (T-030 lo fijó a 10; ahora se quita el número).
- `ai_search_profiles` también está huérfano pero es **otro feature** (filtros guardados) → **NO** tocar aquí;
  se revisa en T-034.

## Criterio de aceptación (Definition of Done)
- [ ] Migración nueva que dropea (con `if exists`): trigger + funciones `increment_ai_search_usage`,
      `get_ai_search_usage_count`, `set_ai_search_usage_updated_at`, y la tabla `public.ai_search_usage` (cascade)
- [ ] `pnpm db:reset` aplica todas las migraciones (incl. la nueva) sin error
- [ ] Eliminar `src/lib/ai/rate-limits.ts` (módulo muerto)
- [ ] Copy: `freeFeature5` → "Face recognition" / "Reconocimiento facial" (sin número/mes), coherente con
      starter/pro que ya no llevan número, en `en.json` **y** `es.json`
- [ ] Actualizar `test/unit/lib/pricing-consistency.test.ts`: quitar el import/aserción de `AI_SEARCH_RATE_LIMITS`;
      el resto (fee/almacenamiento/eventos) sigue. Añadir regresión: la copy de free face-search **no** promete un
      número mensual (falla antes, pasa después)
- [ ] Actualizar la nota de `CLAUDE.md` sobre rate-limits de IA (quitar la cuota mensual por plan; dejar el límite
      vivo `(shareCode, IP)`/hora y apuntar a T-034 para el rediseño)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde
- [ ] `/code-review` sobre el diff (toca migración)

## Notas
- Migración destructiva pero **segura**: tabla vacía/sin usar (cero lectores/escritores). `migrate.yml` la aplicará
  a prod en el merge — flaggearlo en el PR.
- No tocar `ai_search_profiles` ni el límite por IP existente.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `chore/remove-ai-search-quota`.
2. Eliminación mecánica → implementar directo (sin OpenSpec).
3. Migración drop + borrar módulo + copy + test + doc.
4. `pnpm db:reset` + `pnpm typecheck && pnpm lint && pnpm test`. `/code-review` (migración).
5. Commit (Conventional Commits, **sin** `Co-Authored-By`).
6. `git push -u origin chore/remove-ai-search-quota`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar `done`, archivar en `BACKLOG.md`.
