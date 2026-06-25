# T-040 · Excluir fotos de eventos eliminados del carrito y de favoritos

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/deleted-event-cart-favorites`  (tipo = fix)
- **OpenSpec change:** —  (no aplicó: filtros de query + validación, sin migración)
- **PR:** #94

> **Resuelto (capas 1+2):** filtro `events.deleted_at IS NULL` en lectura — `getCartItemsWithDetails` +
> `getCartItemCount` (badge consistente) y `getTaggedPhotosForTalent` + `getTaggedPhotosCountForTalent`
> (patrón nested embed `photos!inner(events!inner(...))` + `.is('photos.events.deleted_at', null)`). En
> escritura: `addPhotoToCartAction` rechaza evento eliminado y `mergeGuestCartAction` lo salta. **No** se
> tocó la biblioteca comprada/reclamada (el usuario las posee). **Diferido (capa 3):** cascada al borrar el
> evento + prevención en el tag/favorito (la galería ya oculta fotos de eventos borrados). Tests de
> regresión (fallan antes/pasan después) en `carts.test.ts`, `talent-photo-tags.test.ts`, `cart.test.ts`.

## Requerimiento
Bug detectado: en el carrito de compras aparece una foto de un evento **que ya no existe** (evento
soft-deleted). Esto no debería pasar: no se deberían poder **agregar** ni **tener** fotos de un evento
inexistente, ni en **favoritos** ("Mis fotos") ni en el **carrito de compras**.

## Criterio de aceptación (Definition of Done)
- [ ] El carrito **no muestra** ítems cuya foto pertenece a un evento con `deleted_at` no nulo.
- [ ] La sección de favoritos / "Mis fotos" (fotos etiquetadas) **no muestra** fotos de eventos
      soft-deleted.
- [ ] El conteo del carrito (`cart-count`) y el subtotal **no** cuentan ítems de eventos eliminados.
- [ ] **Prevención en escritura:** intentar agregar al carrito (o etiquetar/favoritar) una foto de un
      evento eliminado falla limpiamente (no se inserta), en vez de quedar como ítem fantasma.
- [ ] **No** se ocultan las fotos **ya compradas/reclamadas** del usuario (biblioteca propia) aunque su
      evento se elimine después — el usuario las posee (ver Notas: decisión de alcance).
- [ ] test de regresión que falla antes y pasa después: con un evento soft-deleted, su foto NO sale en
      `getCartItemsWithDetails` ni en `getTaggedPhotosForTalent`, y el add-to-cart de esa foto se rechaza.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas

**Causa raíz (confirmada):** las queries de carrito y favoritos hacen un join a `events(...)` **sin**
`events!inner` y **sin** `.is('events.deleted_at', null)`, así que las filas de un evento soft-deleted
siguen apareciendo:
- `getCartItemsWithDetails` — `src/database/queries/carts.ts:181` (`photos!inner(... events(name,date))`).
- `getTaggedPhotosForTalent` — `src/database/queries/talent-photo-tags.ts:178` (`photos!inner(... events(...))`).

El patrón correcto **ya existe** en el resto del código y hay que replicarlo:
`photos.ts` (líneas ~101/138/475/524), `photographers.ts` (~68), `saved-events.ts` (~151) usan
`events!inner(... deleted_at)` + `.is('events.deleted_at', null)`. Aplicar lo mismo a carrito y a tagged.

**Tres capas a cubrir (el usuario pide "ni agregarse ni tener"):**
1. **Lectura (síntoma reportado):** filtrar `events.deleted_at IS NULL` en `getCartItemsWithDetails` y
   `getTaggedPhotosForTalent`. Resuelve el "aparece en el carrito/favoritos".
2. **Escritura (prevención):** validar al agregar al carrito (`addPhotoToCart` / la acción que lo llama en
   `dashboard/talent/cart/actions.ts` y la ruta de invitado) y al etiquetar/favoritar, que el evento de la
   foto existe y no está eliminado. El join de precio en add-to-cart debería filtrar `deleted_at` también.
3. **Cascada al borrar (opcional, raíz):** `deleteEvent` (`events.ts:531`) solo hace soft-delete; no limpia
   `cart_items` ni `talent_photo_tags`. Como mínimo con (1)+(2) basta para el síntoma; limpiar esas filas
   al eliminar el evento es un extra de higiene (evaluar al ejecutar — soft-delete es reversible en
   teoría, así que filtrar en lectura es lo más conservador).

**Decisión de alcance importante — NO tocar la biblioteca comprada/reclamada:** el usuario acotó el bug a
"favoritos" y "carrito" (pre-compra). Las fotos **ya compradas** (`getTalentPurchasedPhotos`) o
**reclamadas** (`getTalentClaimedPhotos`) en `talent-library.ts` también tienen el join `events(...)` sin
filtro, pero **no** deben ocultarse al borrar el evento: el usuario pagó/reclamó y las posee. Si su
metadata de evento queda vacía, degradar con gracia, pero la foto sigue siendo accesible. No incluir esas
queries en el filtro de este ticket.

**Favoritos = "Mis fotos" = fotos etiquetadas** (`talent_photo_tags`, vía
`src/app/[lang]/dashboard/talent/favorites/`). No confundir con `saved-events` (eventos guardados, que ya
filtra `deleted_at`).

**Solape de archivos / cluster Carrito:** este toca `getCartItemsWithDetails` (carts.ts), igual que T-038.
Ejecutar dentro del cluster de carrito, **después** de T-038/T-039 y mergeando entre medias, para no
chocar en `carts.ts`/`cart-content.tsx`. Dep: T-039.

**Archivos probables:**
- `src/database/queries/carts.ts` (`getCartItemsWithDetails`, y revisar `getCartItemCount` / add)
- `src/database/queries/talent-photo-tags.ts` (`getTaggedPhotosForTalent`, count y tag-write)
- `src/app/[lang]/dashboard/talent/cart/actions.ts` y ruta de carrito invitado (validación al agregar)
- (opcional capa 3) `src/database/queries/events.ts` (`deleteEvent` → limpiar cart_items / tags)

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/deleted-event-cart-favorites`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del
   ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
