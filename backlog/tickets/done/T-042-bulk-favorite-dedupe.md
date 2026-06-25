# T-042 · "Agregar a favoritos" en lote: deduplicar las ya favoritas y reportar el conteo real

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/bulk-favorite-dedupe`  (tipo = fix)
- **OpenSpec change:** —  (no aplicó: fix de UI + i18n)
- **PR:** #96

> **Resuelto:** `handleBulkFavorite` ahora filtra a las no-favoritas (`filterNewIds`), reporta el conteo
> real (singular/plural `bulkFavoritedOne`/`bulkFavorited`), muestra info "ya en favoritos"
> (`alreadyInFavorites`) sin llamar al servidor si ninguna es nueva, y añade `myPhotos` a las deps.
> Helper puro `src/lib/bulk-select.ts::filterNewIds(ids, ...sets)` compartido también por el bulk del
> carrito (`handleBulkAddToCart`). Strings nuevos en en+es. Test del helper en
> `test/unit/lib/bulk-select.test.ts`.

## Requerimiento
Al seleccionar varias fotos y pulsar "Agregar a favoritos", la app **no reconoce** las fotos que ya están
en favoritos: siempre dice que agregó el número total seleccionado. Ej.: selecciono 3 → "3 fotos agregadas
a favoritos"; vuelvo a pulsar "Agregar a favoritos" con las mismas 3 → otra vez "3 fotos agregadas". Y así
sucesivamente. **Con el carrito no pasa** (ahí sí reconoce las ya agregadas), pero **en favoritos sí**.

## Criterio de aceptación (Definition of Done)
- [ ] El "Agregar a favoritos" en lote **excluye** las fotos ya favoritas: solo agrega (y solo cuenta) las
      que no estaban.
- [ ] El toast reporta el número **realmente** agregado (las nuevas), no el total seleccionado. Con
      singular/plural correcto.
- [ ] Si todas las seleccionadas ya estaban en favoritos, se muestra un mensaje tipo "ya están en
      favoritos" (info) y **no** se vuelve a llamar a la acción del servidor.
- [ ] Paridad con el carrito: misma semántica que el bulk "Añadir al carrito" (`handleBulkAddToCart`).
- [ ] strings nuevos en `en.json` y `es.json` (variante singular del conteo + "ya en favoritos").
- [ ] test de regresión que falla antes y pasa después (la lógica de dedup del bulk-favorito es pura y
      testeable: dado un set ya-favorito y una selección, calcula los nuevos a agregar y el conteo).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas

**Causa raíz (confirmada):** en `src/app/[lang]/dashboard/talent/events/[id]/event-photo-viewer.tsx`,
`handleBulkFavorite` (líneas ~257-271) hace:
```js
await addPhotosToMyPhotosAction(ids);                 // manda TODOS los ids, sin filtrar
setMyPhotos((prev) => new Set([...prev, ...ids]));
toast.success(t('bulkFavorited').replace('{n}', String(ids.length)));  // cuenta la selección entera
```
Dos defectos: (1) no filtra los `ids` que ya están en `myPhotos`; (2) el toast usa `ids.length` (selección
total) en vez del nº de **nuevos**. Además, las deps del `useCallback` son `[isBulkFavoriting, t]` — **falta
`myPhotos`**, así que aunque se filtre, cerraría sobre un `myPhotos` viejo.

**Patrón correcto, ya presente en el mismo archivo (copiar del carrito):** `handleBulkAddToCart` hace
`const toAdd = ids.filter((id) => !photosInCart.has(id) && !purchasedPhotoIds.has(id));`, reporta
`toAdd.length`, toasta `bulkDownload.alreadyInCart` si `toAdd.length === 0`, y lleva `photosInCart` en deps.
Replicar para favoritos:
- `const toAdd = ids.filter((id) => !myPhotos.has(id));`
- si `toAdd.length === 0` → toast info "ya en favoritos"; return sin llamar al servidor.
- si no → `addPhotosToMyPhotosAction(toAdd)`, `setMyPhotos(prev => new Set([...prev, ...toAdd]))`, toast con
  `toAdd.length` (singular/plural).
- añadir `myPhotos` a las deps del `useCallback`.

**Nota servidor:** `addPhotosToMyPhotosAction` / el tag en `talent_photo_tags` probablemente ya es
idempotente (unique constraint, ignora conflicto), así que no se duplican filas — pero eso **no** arregla
el conteo engañoso ni el reintento innecesario. El fix es de cliente (dedup + toast real); de paso, dejar el
mensaje alineado con lo que realmente ocurrió.

**Relación:** misma área que T-040 (favoritos), pero distinto archivo y distinto problema (T-040 filtra
eventos eliminados en la query; esto es dedup del bulk-favorito en el visor). Independientes, sin solape de
archivos. No es duplicado de nada.

**Archivos probables:**
- `src/app/[lang]/dashboard/talent/events/[id]/event-photo-viewer.tsx` (`handleBulkFavorite`)
- `src/dictionaries/en.json`, `src/dictionaries/es.json` (singular del conteo + "ya en favoritos")
- (si se extrae la lógica pura para test) un helper pequeño, p. ej. en `src/lib/` reutilizable por carrito
  y favoritos.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/bulk-favorite-dedupe`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del
   ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
