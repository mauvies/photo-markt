# T-210 · Mover la portada del evento al paso de subir fotos del wizard

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno — **Dep T-203 resuelta** (PR #265 mergeado) y **T-206 cerrada** (PR #271: tocó la página de *edición*, no el wizard, así que no hay conflicto de archivo)
- **Rama:** `refactor/wizard-cover-in-photos-step`
- **OpenSpec change:** —  (UI del wizard, requerimiento claro)
- **PR:** #273 (draft)

## Requerimiento
"Durante la creación del evento, creo que es mejor configurar la cover photo del evento en el paso de
subir las fotos. Asegúrate de que el UI se vea bonito y bien distribuido: **más espacio para la acción
de subir las fotos del evento que para la de subir la portada**, pero que el diseño se vea bien tanto
en desktop como en mobile."

Es decir: la portada sale del paso 3 (Detalles) y pasa al paso 4 (Fotos), donde conceptualmente
pertenece — las dos acciones son "subir imágenes", y hoy están en pasos distintos.

## Estado actual (verificado en el repo)
- La portada vive en el **paso 3** (`steps/step-3-details.tsx`) como columna izquierda del grid externo
  `md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]` — es decir ~20rem fijos para la portada y el resto
  para los detalles. Ese reparto lo estableció **T-105**, así que este ticket **revierte esa decisión
  concreta** (no es un hueco olvidado).
- El componente es `EventCoverField` (`src/components/event-cover-field.tsx`); el `File` y su
  object-URL los posee el shell del wizard (`wizard.tsx`: `coverFile`, `coverPreviewUrl`,
  `handleCoverChange`) y se pasan a `Step3Details` como `coverPreviewUrl` / `onCoverChange`.
  **No es un campo del form** (un `File` no es serializable, así que no está en el draft persistido).
- El **paso 4** (`steps/step-4-photos.tsx`) hoy es: `Dropzone` + grid de previews + banner
  `photosLost`. No tiene portada.
- La subida real de la portada ocurre **después** de crear el evento
  (`uploadEventCoverAction`), no en el paso — mover el campo de sitio no cambia el orden de subida.

## ⚠️ Trampa a resolver (lo más importante del ticket)
`Step4Photos` hace **early-return** para eventos `organizer`: muestra "no subes tus propias fotos" y
nada más. Si la portada se mueve ahí sin más, **un evento organizer se queda sin forma de poner
portada** — y son eventos públicos que se listan en cards, así que la necesitan igual.
Hay que decidir y implementar una de estas:
- renderizar la portada en el paso 4 **antes** del early-return de organizer (probable mejor opción), o
- dejar la portada en el paso 3 solo para organizer (inconsistente, peor), o
- que el paso 4 de organizer deje de ser un early-return y pase a ser "solo portada".

## Criterio de aceptación (Definition of Done)
- [ ] La portada se configura en el **paso 4 (Fotos)**, no en el 3
- [ ] **Las fotos del evento reciben claramente más espacio que la portada** (p. ej. la portada en una
      columna estrecha o un bloque compacto arriba, y el dropzone ocupando el resto) — el peso visual
      refleja que subir las fotos es la acción principal
- [ ] **Desktop:** las dos zonas conviven sin que el dropzone quede estrecho ni la portada
      desproporcionada
- [ ] **Mobile:** apilado en orden sensato (portada compacta, luego el dropzone), sin scroll
      horizontal y sin que la portada empuje el dropzone fuera de la vista
- [ ] **Eventos `organizer` conservan la portada** (ver la trampa de arriba) — probar los 3 tipos de
      evento: `solo`, `collaborative`, `organizer`
- [ ] El paso 3 se re-equilibra al perder su columna izquierda: el grid externo
      `md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]` deja de tener sentido con una sola columna —
      revisar que los detalles no queden a ~20rem ni estirados de forma rara
- [ ] El paso 5 (**Revisión**) sigue mostrando la portada y su botón Edit apunta al **paso 4**, no al 3
- [ ] La portada sigue subiéndose bien tras crear el evento (`uploadEventCoverAction`) y el
      `photosLost` / limpieza de object-URL del wizard sigue funcionando (no filtrar `URL.createObjectURL`)
- [ ] Quitar/cambiar la portada sigue funcionando, y el `coverPreviewUrl` no se queda huérfano al
      navegar entre pasos
- [ ] strings nuevos en `en.json` y `es.json` (si cambia el copy; probablemente reusa `newEvent.cover*`)
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Revierte parte de T-105**, que fue quien puso la portada en el paso de detalles a 2 columnas.
  Dejar dicho en el PR que es un cambio deliberado de esa decisión, no un descuido.
- **Interacción con T-108 (blocked):** ese ticket propone auto-rellenar campos del evento desde la
  **portada/EXIF**, lo que asume que la portada se elige **antes** del paso de detalles. Con la portada
  en el paso 4 (después de detalles) esa premisa deja de sostenerse — T-108 tendría que tirar del EXIF
  de las **fotos del evento** en su lugar. Anotarlo en T-108 al cerrar este.
- **Conflicto de archivo:** `step-3-details.tsx` lo reescribe fuerte **T-203** (PR #265, sin mergear:
  añade el editor de precio por volumen con `md:col-start-2` dentro de la fila fecha/precio).
  Mergear #265 antes de empezar, o habrá conflicto seguro. **T-206** toca el form de edición
  (`events/[id]/edit`), que es otro archivo — no colisiona, pero comparte el `EventCoverField`.
- Sin OpenSpec y sin `/code-review` (UI del wizard, no toca pagos/auth/BD).
- **Draft a propósito:** el criterio es visual, así que necesita revisión en desktop + mobile,
  light + dark, y en los 3 tipos de evento antes de mergear.
- Familia: T-105 (reestructura de pasos) / T-055 (portada dedicada) / T-052/T-059 (persistencia del
  draft del wizard) / T-108 (autofill EXIF, blocked).
