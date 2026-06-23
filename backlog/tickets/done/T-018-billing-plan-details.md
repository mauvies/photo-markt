# T-018 · Detallar features de cada plan en la facturación del fotógrafo

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/billing-plan-details`
- **OpenSpec change:** —  (UI + reuso de datos de planes; si se ramifica, evaluar)
- **PR:** #65

## Requerimiento
En el dashboard del fotógrafo, la sección de cambiar plan de facturación lista los planes pero **no
explica en detalle las features/ventajas de cada uno**, a diferencia de la landing, que sí las detalla.
Ahora que los usuarios autenticados se redirigen al dashboard (T-005), la facturación es el **único sitio**
donde el fotógrafo puede comparar planes. Mejorar esa página: mostrar en detalle las características de
cada plan (no solo el actual), manteniendo un diseño limpio y bonito. Conservar lo que ya se muestra del
plan actual (almacenamiento y uso de almacenamiento).

## Criterio de aceptación (Definition of Done)
- [ ] Cada plan (Free / Starter / Pro) muestra su lista de features/beneficios, con el mismo nivel de detalle que la landing
- [ ] El plan actual sigue mostrando su info actual (almacenamiento y uso) además de sus features
- [ ] El plan actual se distingue visualmente (badge "plan actual" / estado)
- [ ] Diseño limpio y consistente con el resto del dashboard; responsive (mobile + desktop)
- [ ] Los botones de upgrade/cambiar plan siguen funcionando igual
- [ ] Strings nuevos en `en.json` y `es.json` (si los features no están ya i18n)
- [ ] Test de regresión: render de las features por plan / plan actual marcado
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Página: `app/[lang]/dashboard/photographer/settings/available-plans-section.tsx` (+ `page.tsx`, `upgrade-*`).
- **Reuso (ponytail):** la landing `components/pricing-section.tsx` ya tiene `planFeatures[plan.id]` con la
  lista detallada. Extraer esa data de features a un sitio compartido (p. ej. `lib/plans.ts`) y consumirla
  tanto en la landing como aquí, en vez de duplicar la lista. Evitar divergencia entre ambas.
- Datos de planes ya existen en `lib/plans.ts` / `lib/plan-limits.ts` / `lib/stripe/plans-stripe.ts` — revisar
  qué hay antes de añadir nada.
- No tocar la lógica de Stripe/checkout; esto es presentación + reuso de datos.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/billing-plan-details`.
2. Reuso de datos + UI → implementar directo (sin OpenSpec salvo que crezca).
3. Implementar + test de regresión.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/billing-plan-details`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
