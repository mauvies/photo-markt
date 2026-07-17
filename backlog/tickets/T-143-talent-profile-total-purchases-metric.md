# T-143 · Añadir "total de compras" a las métricas del perfil de talento

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/talent-profile-purchases-metric`  (tipo = feat)
- **OpenSpec change:** —  (1 stat aditivo en UI + reuso de query existente; no toca pagos/BD)
- **PR:** —

## Requerimiento
En las métricas de `/{lang}/dashboard/talent/profile` (bloque de stats estilo Instagram) hoy se muestran
**dos** números: fotos compradas (`purchasedPhotosCount`) y eventos (`eventsCount`). Agregar un **tercer**
stat: el **número total de compras** (cantidad de órdenes completadas del usuario).

## Contexto (verificado)
- El bloque de stats vive en `src/app/[lang]/dashboard/talent/profile/profile-content.tsx:104-111`
  (`stats.purchasedPhotosCount` → `statsPhotos`, `stats.eventsCount` → `statsEvents`).
- `stats` viene de `getProfileData()` en `.../profile/actions.ts:42-67`, que arma su propio objeto
  `stats` en paralelo vía `getTalentOwnedPhotosCount` + `getTalentPurchasedEventsCount` (admin client).
- **El dato ya se calcula** en otro lado: `getTalentOrderStats()`
  (`.../talent/orders/actions.ts:145-176`) ya devuelve `completedOrders` (= órdenes con
  `status='completed'`). Preferir **reusar esa semántica** (contar órdenes completadas), no inventar otra.
  - Opción A (recomendada): añadir un count liviano de órdenes completadas del usuario dentro del
    `Promise.all` de `getProfileData` (evita doble fetch de la lista completa de órdenes que hace
    `getTalentOrderStats`), y exponerlo como `stats.purchasesCount`.
  - Ojo semántico: "compras" = **órdenes**, distinto de "fotos compradas" (ya mostrado) y de "eventos".
    No mezclar los tres números.
- Query nueva (si hace falta): añadir a `src/database/queries/orders.ts` un
  `getTalentCompletedOrderCount(client, userId)` — `count: 'exact', head: true` sobre `orders` con
  `user_id = userId AND status = 'completed'`. Todas las queries van en `/src/database/queries/`.

## Criterio de aceptación (Definition of Done)
- [ ] El perfil de talento muestra un tercer stat con el total de **compras** (órdenes completadas del
      usuario), junto a fotos y eventos, con el mismo estilo del bloque actual.
- [ ] El conteo cuenta **órdenes completadas** (misma definición que `getTalentOrderStats.completedOrders`),
      no fotos ni eventos.
- [ ] Query en `/src/database/queries/` (no inline en la action); reusar/derivar de lo existente sin
      añadir un segundo fetch pesado de la lista de órdenes.
- [ ] strings nuevos (label del stat, p.ej. `statsPurchases`) en `en.json` **y** `es.json`.
- [ ] test de regresión/feature: `getProfileData` (o la query nueva) devuelve el conteo correcto de
      compras para un usuario con N órdenes completadas + alguna no-completada que **no** debe contar.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- No solapa con ningún ticket del backlog (no hay ticket de métricas del perfil de talento).
- Superficie pequeña y aditiva; sin migración, sin tocar pagos/auth → sin `/code-review` obligatorio.
- Hallazgo derivado del state report 2026-07-17 (`STATE-REPORT-2026-07-17.md`).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/talent-profile-purchases-metric`.
2. Implementar directo (1 stat aditivo + query) + test de regresión.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`.
6. `gh pr create --draft` apuntando a `main`.
7. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
