# T-146 · Borrado optimista de fotos en un evento (grid + contador)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno (T-142 ya mergeado — PR #203; este ticket se apoya en su `deletePhotoAction`/`{ retained }`)
- **Rama:** `feat/optimistic-photo-deletion` (tipo = feat)
- **OpenSpec change:** — (UX cliente puro; no toca pagos/BD/auth ni el server-side del borrado)
- **PR:** —

## Requerimiento
Borrar fotos de un evento hoy espera el round-trip al servidor antes de actualizar el grid. Hacerlo **optimista**: la(s) foto(s) desaparecen al instante al confirmar; si la mutación falla, se revierte al estado exacto anterior y un **toast** avisa. En éxito **no** hay toast (el silencio es la confirmación). Mismo patrón que el add/remove optimista del carrito. **Solo cambia la UX del cliente — no cambia qué hace el borrado en el servidor.**

## Alcance
- Borrado **individual** en la página del evento del fotógrafo.
- Borrado **en lote** (modo selección).

## Contexto (verificado en el código)
- Ambos flujos (individual vía more-menu y lote) pasan por `confirmDelete` en
  `src/app/[lang]/dashboard/photographer/events/[id]/event-photo-album.tsx`.
- **Hoy NO es optimista:** `confirmDelete` hace `await Promise.all(ids.map(deletePhotoAction...))` y **recién después** `setDeletedIds(...)` — el comentario "Optimistic removal" es engañoso; los tiles siguen hasta que responde el server. El grid ya deriva de un source reactivo (`deletedIds`: `visibleItems = accumulated.filter(i => !deletedIds.has(i.id))`), así que la base para lo optimista ya existe — falta **mover el `setDeletedIds` a antes del await** y **revertir en fallo**.
- **Desync del contador (el bug que el ticket quiere evitar):** el contador "Fotos (N)" / labels de tabs usa `totalCount`, que es un **prop estático** (valor del server, viene de `page.tsx` / se muestra en `event-moderation-tabs.tsx`), **no** deriva de `deletedIds`. Hoy no se mueve al borrar hasta `router.refresh()`. El grid vive en `event-photo-album.tsx` pero el contador/tabs viven **fuera** de ese componente → hay que hacer que **grid y contador lean de un único source reactivo** (subir el estado optimista o compartir contexto), o el contador quedará desincronizado (mismo patrón que el desync page/header del carrito).
- **T-142 (ya mergeado):** `deletePhotoAction` devuelve `{ retained: boolean }` (una foto **vendida** se soft-borra y se conserva para el comprador, pero **igual desaparece del grid del fotógrafo** → la remoción optimista sigue siendo correcta). El toast informativo "conservada para el comprador" (`photosKeptSoldToast`) es un sub-caso de **éxito** que **sí** muestra toast — **preservarlo** (no confundir "sin toast en éxito" con quitar ese aviso). El toast de fallo es nuevo/aparte.
- **Patrón a reusar:** el add/remove optimista del carrito (`cart-content.tsx` / `guest-cart-content.tsx`) — mismo enfoque, mismo sistema de toasts (`sonner`), sin libs nuevas.

## Criterio de aceptación (Definition of Done)
- [ ] Borrado individual quita la foto del grid **al confirmar** (antes de la respuesta del server).
- [ ] Borrado en lote quita las seleccionadas **al confirmar** (antes de la respuesta).
- [ ] En **fallo**: se restaura el estado exacto anterior (foto(s) de vuelta en el grid, en su posición) y un toast reporta el fallo — singular ("No se pudo eliminar la foto, inténtalo de nuevo" / "Couldn't delete the photo, please try again") y variante plural para lote.
- [ ] En **éxito**: sin toast (salvo el aviso "conservada para el comprador" de T-142, que se conserva).
- [ ] **Fallo parcial** en lote: si unas se borran y otras no, restaurar **solo las que fallaron** y reportar el conteo exacto de fallidas. No revertir todo el lote.
- [ ] El **contador de fotos** ("Fotos (N)" / labels de tabs) decrementa optimista junto al grid y se corrige en rollback. Grid y contador leen de **un solo source reactivo** (no divergen).
- [ ] El paso de **confirmación** previo al borrado queda **igual**; lo optimista empieza tras confirmar.
- [ ] Sin cambios al server-side del borrado; mutaciones vía las Server Actions existentes. Sin regresión al soft-delete purchase-aware de T-142.
- [ ] strings nuevos (toast de fallo singular/plural) en `en.json` **y** `es.json`.
- [ ] test de regresión/feature: éxito quita del grid y **no** togglea toast; fallo restaura y togglea toast; fallo parcial restaura solo las fallidas con conteo correcto; contador sigue al grid en ambas direcciones.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- No solapa con otro ticket abierto (no hay ticket de borrado optimista). Es follow-up UX de T-142 (mergeado).
- El reto real es la **reactividad cruzada** grid↔contador (viven en componentes distintos) — probablemente subir el estado de `deletedIds`/optimista al contenedor común de la página o compartirlo por contexto. Superficie mediana pero acotada a la página del evento del fotógrafo.
- Sin migración, sin pagos/auth → sin `/code-review` obligatorio (revisión humana en el merge del draft).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/optimistic-photo-deletion`.
2. Implementar directo (reusar patrón optimista del carrito) + test de regresión.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
