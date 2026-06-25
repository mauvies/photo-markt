# T-041 · Ocultar el botón "Descargar" del modo selección en eventos con watermark (no descargables)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/hide-bulk-download-watermarked`  (tipo = fix)
- **OpenSpec change:** —  (no aplicó: fix de UI)
- **PR:** #95

> **Resuelto:** helper compartido `shouldShowBulkDownload(isFreeEvent, hasPurchasedPhotos)` en
> `event-bulk-actions.ts` (free ∨ tiene compradas). El visor de talento gatea su acción `download` con él
> (`visible:`), y el visor público pasa `hasPurchasedPhotos` a `eventBulkActionKeys` → ambos deciden igual.
> El visor del fotógrafo no cambia (dueño → descarga siempre válida). Test del helper (oculto en pago sin
> compras, visible con compras, siempre en gratis) en `test/unit/lib/event-bulk-actions.test.ts`.

## Requerimiento
Ya quedó (T-010 / PR #68) que descargar fotos con watermark de un evento público **no** es posible — la
app efectivamente lo bloquea. Pero en el **modo de selección**, la barra de acciones **sigue mostrando el
botón "Descargar"** aunque la descarga no esté permitida. No deberíamos mostrar ese botón cuando la
descarga no es posible.

## Criterio de aceptación (Definition of Done)
- [ ] En la barra de acciones del **modo de selección**, el botón "Descargar" **no aparece** cuando la
      descarga no es posible (evento de pago/watermark sin fotos compradas).
- [ ] En un evento de pago, el botón "Descargar" del modo selección solo aparece si el usuario tiene
      fotos **compradas** descargables (o no aparece si no tiene ninguna) — no un botón muerto que al
      pulsarlo solo lanza un toast de error.
- [ ] En eventos **gratis**, la descarga masiva sigue disponible como hasta ahora.
- [ ] Comportamiento **consistente entre los visores** (talento, público y fotógrafo): todos deciden la
      visibilidad de "Descargar" con la misma lógica (idealmente la misma helper).
- [ ] test de regresión que falla antes y pasa después (ver Notas: la helper de keys / visibilidad).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas

**Causa raíz (confirmada):** el visor de evento del **dashboard de talento**
(`src/app/[lang]/dashboard/talent/events/[id]/event-photo-viewer.tsx`) construye su array `bulkActions` y
añade la acción `download` **sin** propiedad `visible` (a diferencia de `cart`, `profile`, `delete`, que sí
tienen `visible:`). Resultado: en un evento de pago/watermark el botón "Descargar" siempre se muestra en la
toolbar de selección, aunque `useBulkPhotoDownload` luego filtre a fotos compradas y, si no hay, solo emita
`toast.error(bulkDownload.nonePurchased)` → botón muerto.

**El patrón correcto ya existe** y solo no se aplicó a este visor:
- `src/lib/event-bulk-actions.ts` → `eventBulkActionKeys({ canAddToCart, isFreeEvent, canDeleteOwnPhotos })`
  ya hace `if (opts.isFreeEvent) keys.push('download')` — documentado con referencia a T-010.
- El **visor público** (`events/[shareCode]/public-event-photo-viewer.tsx`) usa esa helper y por eso
  **no** muestra "Descargar" en eventos de pago. Es la paridad que falta en el visor de talento.

**Fix recomendado:** gatear la visibilidad del `download` bulk en el visor de talento. Dado que es el
dashboard propio del usuario (puede tener fotos compradas y querer descargarlas en lote), usar:
`visible: isFreeEvent || purchasedPhotoIds.size > 0` (mejor que `isFreeEvent` a secas, que escondería la
descarga a quien sí compró). Idealmente, **rutar el visor de talento por `eventBulkActionKeys`** (o
extender la helper con un flag `canBulkDownload`) para que talento/público/fotógrafo compartan exactamente
la misma decisión y no se vuelva a desincronizar.

**Alcance / secundario:** la descarga **por foto** (more-menu / lightbox) en estos visores se muestra pero
**deshabilitada** cuando no es descargable (`isDownloadDisabled`/`canDownloadPhoto`). Eso es un estado
disabled, no un botón muerto; el usuario se quejó del **modo selección** (bulk), así que el core es la
acción masiva. Mencionar pero no obligatorio tocarlo en este ticket.

**Relación con T-010 (PR #68, done):** T-010 introdujo la helper y la aplicó al visor público; este ticket
cierra la misma regla en el visor de talento (superficie que quedó sin migrar). No es duplicado. Sin solape
con el cluster de carrito (T-038/39/40) — son archivos distintos (visores de evento).

**Archivos probables:**
- `src/app/[lang]/dashboard/talent/events/[id]/event-photo-viewer.tsx` (gatear `download` en `bulkActions`)
- `src/lib/event-bulk-actions.ts` (si se centraliza la decisión para los tres visores)
- Verificar `src/app/[lang]/dashboard/photographer/events/[id]/event-photo-album.tsx` por consistencia
  (el fotógrafo es dueño de las fotos → descarga siempre válida; confirmar que no haya botón muerto).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/hide-bulk-download-watermarked`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del
   ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
