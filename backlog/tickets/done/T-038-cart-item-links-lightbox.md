# T-038 · Ítems del carrito navegables: lightbox de la foto + enlaces a evento y fotógrafo

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/cart-item-links-lightbox`  (tipo = feat)
- **OpenSpec change:** —  (no aplicó: feature de UI + enriquecido de query de lectura, sin migración)
- **PR:** #92

> **Resuelto:** carrito de talento con foto→`PhotoLightbox` close-only (todas las props `show*` en
> `false`), nombre de evento→`/events/[shareCode]` y fotógrafo→`/photographer/[slug]`. `getCartItemsWithDetails`
> ahora devuelve `event_share_code` + slug del fotógrafo (keyed por `username`, porque la columna `slug` es
> solo de prod y no está en el esquema local; la ruta resuelve `slug.eq OR username.eq`). Carrito invitado:
> lightbox + enlace de evento (`GuestCartItem.eventShareCode` poblado al añadir); enlace de fotógrafo
> diferido. Test de regresión en `test/integration/queries/carts.test.ts`.

## Requerimiento
En el carrito de compras, para cada ítem (que muestra foto, nombre del evento y fotógrafo), el usuario
quiere que esos elementos sean navegables:

1. **Foto de preview → lightbox.** Poder abrir la foto del ítem directamente desde el carrito en el
   visualizador de lightbox, **sin ningún ícono de acción** (sin descargar, sin añadir, sin quitar, etc.),
   solo con el botón de **cerrar**. El objetivo es que el usuario pueda ver con más detalle la foto que
   tiene agregada en el carrito.
2. **Nombre del evento → página del evento.** Hacer clic en el nombre del evento del ítem y visitar el
   evento de esa foto.
3. **Fotógrafo → perfil del fotógrafo.** Igual que con el evento: el nombre del fotógrafo que se muestra
   en cada ítem debe ser clicable y llevar al perfil público del fotógrafo.

## Criterio de aceptación (Definition of Done)
- [ ] En el carrito de talento (`cart-content.tsx`), al hacer clic en la foto de preview de un ítem se
      abre `PhotoLightbox` mostrando esa foto, **sin botones de acción** (`showDownload`/`showAddToPhotos`/
      `showAddToCart`/`showRemove`/`showTagTalent` en `false`), solo cierre (botón X / Esc / click fuera).
- [ ] El **nombre del evento** de cada ítem es un enlace que lleva a la página del evento de esa foto.
- [ ] El **nombre del fotógrafo** de cada ítem es un enlace que lleva al perfil público del fotógrafo.
- [ ] Mismo comportamiento en el **carrito de invitado** (`guest-cart-content.tsx`) en la medida en que
      haya datos disponibles (ver Notas — el carrito invitado hoy ni siquiera muestra el nombre del
      fotógrafo y le faltan slugs en `localStorage`).
- [ ] Los enlaces y el área clicable de la foto no rompen el botón de eliminar ni el resto de acciones
      del ítem (sin `<a>` anidados; el click en la foto abre lightbox, no navega).
- [ ] strings nuevos en `en.json` y `es.json` (p. ej. aria-labels "Ver foto", "Ver evento", "Ver fotógrafo").
- [ ] test de regresión/feature que falla antes y pasa después (ver Notas: cubrir el enriquecido de la
      query con `share_code` + slug del fotógrafo).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas

**Componente lightbox — ya soporta modo "solo ver".**
`src/components/photo-lightbox.tsx` acepta props `showDownload`, `showAddToPhotos`, `showAddToCart`,
`showRemove`, `showTagTalent`. Ponerlas todas en `false` deja únicamente cerrar. La preview del carrito ya
viene **sin watermark** (`getCurrentCart` usa `useWatermark: false`), así que se puede pasar como `url`/
`thumbMedium` del item directamente. Reusar este componente; **no** crear un visor nuevo.

**Gap de datos — la capa de queries no devuelve lo necesario para los enlaces (lo principal a resolver):**
- `getCartItemsWithDetails` (`src/database/queries/carts.ts`) hoy devuelve `event_name` y `event_date`
  pero **no** el `share_code` del evento ni el **slug del fotógrafo**. Hay que ampliar el `select`
  (`events(name, date, share_code, slug)`) y la consulta de `profiles` (añadir `slug`), y propagar esos
  campos por `CartItemWithDetails` → `CartItemDetail`/`CartData` (`actions.ts`) → el componente.
- **Ruta del evento:** la página pública del evento es `/events/[shareCode]` (existe `[shareCode]`). Usar
  esa como destino para que funcione igual en carrito autenticado e invitado. (Alternativa: deep-link al
  dashboard de talento `/dashboard/talent/events/[id]`; preferir la pública por consistencia.)
- **Ruta del fotógrafo:** perfil público en `/photographer/[slug]`.
- Usar `useLocalizedPath()` (ya importado en ambos carritos) para prefijar el locale en los `href`.

**Carrito de invitado — riesgo de scope:**
`GuestCartItem` (`src/lib/guest-cart.ts`) guarda `eventId`, `eventName`, `eventDate`, `photographerId`,
`previewUrl` — **sin** `shareCode`, sin slug del fotógrafo y sin nombre del fotógrafo (que ni se muestra
hoy). Para que evento/fotógrafo sean navegables en el carrito invitado hay dos caminos: (a) ampliar el
shape que se persiste en `localStorage` al añadir al carrito (`add-to-cart-button.tsx` + lib), o (b)
enriquecer en servidor al pintar la página. La foto→lightbox sí funciona ya en invitado (tiene
`previewUrl`). Decidir alcance al ejecutar: como mínimo, foto→lightbox en ambos; enlaces evento/fotógrafo
garantizados en el carrito de talento, y best-effort en el de invitado según datos disponibles.

**Archivos probables:**
- `src/app/[lang]/dashboard/talent/cart/cart-content.tsx` (lightbox + enlaces)
- `src/app/[lang]/cart/guest-cart-content.tsx` (lightbox + enlaces best-effort)
- `src/database/queries/carts.ts` (añadir `share_code` + slug del fotógrafo)
- `src/app/[lang]/dashboard/talent/cart/actions.ts` (propagar campos en `CartItemDetail`/`CartData`)
- `src/lib/guest-cart.ts` + `src/components/add-to-cart-button.tsx` (si se amplía el shape del invitado)
- `src/dictionaries/en.json`, `src/dictionaries/es.json`

**Sin relación con T-009** (que fue la transición de carrusel del lightbox, ya hecha). No hay otro ticket
de carrito abierto, así que no hay solapamiento.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/cart-item-links-lightbox`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del
   ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
