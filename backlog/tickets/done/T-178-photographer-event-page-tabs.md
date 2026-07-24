# T-178 · Reestructurar la página de evento del fotógrafo en tabs

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (pero **debe mergear ANTES** del ticket de la sección Share — le deja el hogar)
- **Rama:** `refactor/photographer-event-page-tabs`  (tipo = refactor — reestructura organizativa, sin cambio de comportamiento)
- **OpenSpec change:** —  (probable: toca `page.tsx` + wrapper de tabs + header + i18n → >1 archivo; decidir al ejecutar)
- **PR:** —

## Requerimiento
`/dashboard/photographer/events/[id]` hoy mezcla todo en una sola página (header + grid de fotos + upload + cola de aprobación + cards de detalles/AI/bib/share). Reestructurarla en **tabs** para que cada concern tenga su lugar y la página escale al añadir secciones. Cambio **organizativo**: cero cambio de comportamiento de indexado, upload, aprobación o el grid.

**Modo de ejecución: normal, NO fully-autonomous** — la decisión de la ruta `/edit` necesita review, y esto toca la página que el fotógrafo más usa.

### Estructura

**Header persistente del evento, FUERA de los tabs** (siempre visible sin importar el tab activo):
- Título del evento, fecha, y un **indicador compacto del estado del evento** (p. ej. estado de indexado/procesamiento). Opcionalmente un thumbnail pequeño de la portada.
- Razón: el fotógrafo debe saber siempre en qué evento está sin cambiar al tab Details.

**Tabs (en este orden):**
1. **Photos — TAB POR DEFECTO.** El grid, upload y cola de aprobación existentes, **sin cambio de comportamiento**. Es lo que el fotógrafo hace más; abrir un evento debe aterrizar aquí, sin clic extra.
2. **Details** — la info core del evento **+** el estado de indexado/procesamiento AI. El indexado es *estado del evento*, no una acción recurrente → va aquí, no en su propio tab. La **configuración del evento también vive aquí** — NO separar "details" y "settings" en tabs distintos; esa distinción no existe en la cabeza del fotógrafo.
3. **Share** — la sección de compartir (**su propio ticket**). Dejarle un hogar claro (tab con placeholder mínimo o punto de integración), o integrarla si ese ticket ya mergeó.

**NO crear:**
- Un tab "Overview" — un overview con fotos + resumen es solo el tab Photos con header; nombrarlo "Overview" esconde las fotos tras una etiqueta poco clara. El header persistente ya cubre esa necesidad.
- Tabs para features que aún no existen (p. ej. pricing). Un tab "coming soon" vacío es peor que no tener tab (la app ya sufre eso con los placeholders de analytics/messages). Añadir un tab después es trivial una vez existe la estructura.

**Estados de foto quedan DENTRO del tab Photos:**
- Pending / approved / all son los mismos objetos en distinto estado, no concerns separados. Se quedan como los **inner tabs** existentes dentro de la gestión de fotos (`EventModerationTabs`, que ya funciona así) — NO promoverlos a tabs top-level.
- Esto crea **tabs anidados** (top-level: Photos/Details/Share; inner: all/pending). Aceptable, pero los dos niveles deben ser **visualmente distintos** — top-level más pesado, inner más ligero — para que la jerarquía se lea clara. Otra razón para mantener pocos tabs top-level.

### Edición
- Los campos deben ser **editables in place** dentro de su tab.
- **Consecuencia a resolver (necesita review):** la edición hoy vive en `/dashboard/photographer/events/[id]/edit`. Si los tabs son editables, **decidir explícitamente** si esa ruta se elimina o redirige al tab relevante. No dejar dos formas de editar lo mismo. **Declarar la decisión en el PR.**

## Criterio de aceptación (Definition of Done)
- [ ] Header persistente del evento (título + fecha + indicador compacto de estado, opcional thumbnail de portada) renderizado **fuera** del `Tabs`, visible en todos los tabs.
- [ ] Tres tabs top-level en orden **Photos / Details / Share**; **Photos es el default** (abrir un evento aterriza en Photos sin clic extra).
- [ ] Tab **Photos**: grid + upload + cola de aprobación existentes, **comportamiento idéntico** (verificar que `EventModerationTabs`/`EventPhotoAlbum`/`OrganizerUploadSection`/load-more siguen igual). Los inner tabs all/pending se conservan **dentro** de este tab.
- [ ] Tab **Details**: info core del evento + config (editable in place) + `AiStatusCard` + `BibStatusCard`. **Verificar que el estado de indexado sigue funcionando exactamente como hoy** (refleja estado en vivo / polling).
- [ ] Tab **Share**: hogar claro para el ticket de Share (placeholder mínimo o integración si ya mergeó). **NO** un "coming soon" ruidoso.
- [ ] Jerarquía visual clara entre tabs top-level (más pesados) e inner tabs all/pending (más ligeros).
- [ ] Estado del tab en la **URL (query param `?tab=`)**, linkable y sobrevive refresh, **consistente con cómo lo hace Sales** (`sales/page.tsx` lee `searchParams.tab` como `defaultValue`). Si la consistencia "sobrevive refresh tras cambiar de tab" exige empujar el `?tab=` al cambiar (Sales solo lo lee al cargar), documentarlo/implementarlo.
- [ ] Tabs funcionan bien en **mobile y desktop** (razón principal del cambio).
- [ ] **Decisión de la ruta `/edit`** (eliminar vs redirigir a `?tab=details`) tomada y **declarada en el PR**; sin dos caminos para editar lo mismo.
- [ ] La vista de **contributor** (minimal: header + upload) no se rompe — decidir si adopta la misma estructura o queda como está.
- [ ] Reusa el componente `Tabs` de shadcn (`src/components/ui/tabs.tsx`) y el `AiStatusCard`/`BibStatusCard` existentes — sin patrón nuevo, sin UI libs nuevas.
- [ ] strings nuevos (labels de tabs: Photos/Details/Share) en `en.json` y `es.json`.
- [ ] test de regresión/feature que falla antes y pasa después (default a Photos, `?tab=details` selecciona Details, header persistente presente en todos los tabs, indexado sigue cableado).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.
- [ ] Sin `any`; Biome; sin otros cambios.

## Notas
- **Fuera de alcance:** pricing/packages, cualquier cambio en la lógica de indexado, construir features nuevas por tab.
- **Reference del patrón de tabs URL-driven:** `src/app/[lang]/dashboard/photographer/sales/page.tsx` (server component lee `searchParams.tab` → `defaultValue` del `Tabs` de shadcn; `TabsContent` puede envolver server components). El mismo `page.tsx` de evento puede quedarse server-side envolviendo todo en `<Tabs>` sin volverse client.
- **Superficie actual** (`.../events/[id]/`): `page.tsx` (server, fetch pesado), `event-details-card.tsx`, `ai-status-card.tsx`, `bib-status-card.tsx`, `event-moderation-tabs.tsx` (inner tabs all/pending ya existentes), `event-photo-album.tsx`, `organizer-upload-section.tsx`, `photos-processing-notice.tsx`, `event-actions-menu.tsx`, `photographers-section.tsx`, `edit/` (form de edición actual), `event-share-code.tsx` (via `@/components`).
- **Header persistente** hoy es `DashboardHeader title={event.name}` + `EventActionsMenu`; el "indicador compacto de estado" puede derivarse del `aiMatchingStatus`/`bibDetectionStatus`/progress ya calculados en `page.tsx` (una versión resumida; el `AiStatusCard` completo se queda en Details).
- **Nested tabs:** top-level = `Tabs` de shadcn nuevo en el page; inner = `EventModerationTabs` (ya usa `Tabs` de shadcn) — diferenciar estilos para que no se confundan los dos niveles.
- **Depende-hacia:** el ticket de la sección Share consume el hogar que deja este. Coordinar merge (este primero).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `refactor/photographer-event-page-tabs`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main` — **declarar en el PR la decisión de la ruta `/edit`**.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
