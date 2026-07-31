# T-208 · Estado vacío en el tab Photos del evento del fotógrafo

- **Prioridad:** P2
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `feat/photos-tab-empty-state`
- **OpenSpec change:** —  (UI, requerimiento claro)
- **PR:** —

## Requerimiento
"No hay estado vacío que mostrar en `/[lang]/dashboard/photographer/events/[id]?tab=photos`
cuando el evento no tiene fotos."

Un evento recién creado sin fotos deja el tab Photos **en blanco**: ni mensaje, ni explicación,
ni llamada a la acción para subir. El fotógrafo no sabe si la página está cargando, si falló algo,
o si simplemente no ha subido nada.

## Verificación en el repo (evidencia, no supuesto)
- `dashboard/photographer/events/[id]/page.tsx` renderiza el tab Photos como
  `PhotosProcessingNotice` + `EventModerationTabs`/`EventPhotoAlbum`. **Ningún camino comprueba
  `albumItems.length === 0`**, así que con cero fotos el grid se renderiza vacío sin copy.
- `event-photo-album.tsx` solo tiene guardas `ids.length === 0` para las **acciones** (descargar,
  seleccionar), no para el render.
- Contraste: el carrito **sí** tiene estado vacío (`guest-cart-content.tsx`), y T-186 estableció ese
  mismo patrón visual para el aviso del reveal gate (`gated-face-search-notice.tsx`) — hay un estilo
  de empty-state ya definido en la app que este tab debería reusar.

## Criterio de aceptación (Definition of Done)
- [ ] Con cero fotos, el tab Photos muestra un estado vacío: ícono, título, descripción y CTA de subir
- [ ] Reusa el patrón visual del empty-state del carrito / `GatedFaceSearchNotice` (sin recuadro,
      ícono grande `text-muted-foreground/50`, título `text-2xl`, descripción `text-sm`), no un
      diseño nuevo
- [ ] El CTA lleva al camino de subida que corresponde al tipo de evento (el dueño sube desde
      `/edit`; en eventos colaborativos/organizer no confundir con el flujo de contribuidores)
- [ ] Distinguir **"no hay fotos"** de **"hay fotos procesándose"**: `PhotosProcessingNotice` ya cubre
      el segundo caso (`visibleCount - approvedCount`), así que el estado vacío solo aparece cuando
      `visibleCount === 0`, no cuando todo está en validación
- [ ] En eventos con cola de moderación, el tab **Pending** vacío también necesita su propio texto
      (hoy muestra un contador `(0)` y nada más)
- [ ] strings nuevos en `en.json` y `es.json`
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Hallado durante la revisión de **T-203** (PR #265), pero **ajeno** a bundles: el hueco lo dejó
  T-178 al reestructurar la página en tabs. Capturado aparte para no meter UI no relacionada en un
  PR de precios.
- Sin OpenSpec y sin `/code-review` (UI/i18n, no toca pagos/auth/BD).
- Toca `dashboard/photographer/events/[id]/page.tsx`, que **T-113** y **T-104** también tocan —
  coordinar si se ejecutan cerca.
