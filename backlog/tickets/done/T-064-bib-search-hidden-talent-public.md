# T-064 · Bug: la búsqueda por dorsal no aparece en la vista de talento ni en la pública, aunque el evento la tiene habilitada

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/bib-search-visibility`
- **OpenSpec change:** — (bug fix; implementar directo)
- **PR:** #118

## Requerimiento
Para un evento con **reconocimiento por dorsal habilitado** por el fotógrafo, al visitar el evento desde
**el lado del talento** (`/dashboard/talent/events/[id]`) o desde la **vista pública** (`/events/[slug|shareCode]`)
**no aparece** la opción de buscar por dorsal (`BibSearchBar`). El usuario reporta que **antes la veía y ya no
está**. Esperado: si el evento tiene `bib_detection_enabled = true` (y no es upcoming / no contiene minors),
el buscador por dorsal se muestra en ambas vistas.

## Causa raíz (confirmada en código — dos facetas)
1. **Vista de talento — nunca pasa el prop.** `dashboard/talent/events/[id]/page.tsx:375` renderiza
   `<EventGalleryWithFaceSearch .../>` pero **no** le pasa `bibDetectionEnabled` ni `bibSearchLabels`. El
   componente los tiene con default `bibDetectionEnabled = false`
   (`components/event-gallery-with-face-search.tsx:92`), y la barra se gatea con
   `bibDetectionEnabled && bibSearchLabels && matches === null` (L133). Sin el prop → **nunca** se muestra en
   talento. (La vista pública `events/[shareCode]/page.tsx:592-601` **sí** pasa `bibDetectionEnabled` +
   `bibSearchLabels`, por eso ahí históricamente aparecía.)
2. **Vista pública — caché desactualizada al habilitar.** `enableBibDetectionForEvent`
   (`dashboard/photographer/events/[id]/actions.ts:558-587`) hace `update({ bib_detection_enabled: true })` y
   **solo** revalida `/{es,en}/dashboard/photographer/events/${eventId}` (L584-585). **No** revalida los tags de
   caché que usa la página pública `getCachedEventData` (`events/[shareCode]/page.tsx`): `event-${eventId}`,
   `event-${slug}`, `event-${share_code}` (TTL 55 min), ni la ruta del detalle de talento. Resultado: tras
   habilitar, la pública sirve el evento **cacheado con `bib_detection_enabled` viejo (false)** hasta 55 min →
   la barra no aparece. (Otras acciones del mismo archivo, L40-42, **sí** revalidan esos tags de `event-*`; las
   de bib enable/disable lo omiten. `disableBibDetectionForEvent` probablemente tiene el mismo hueco.)

## A confirmar en el repro (para no arreglar la faceta equivocada)
- [ ] ¿El evento está **upcoming** (fecha futura)? La galería pública (y con ella la barra) se oculta y muestra
      "coming soon" (`events/[shareCode]/page.tsx:579-584`). Si es upcoming, ese es el motivo, no el bug de arriba.
- [ ] En DB, ¿`events.bib_detection_enabled` es realmente `true` para ese evento? (`b5b4a5ee-…`).
- [ ] ¿La vista pública muestra la barra tras revalidar/expirar la caché? (confirma faceta 2).
- [ ] ¿Algún cambio reciente (T-055 portada / cambios de estado IA) alteró el `select` del evento o el gating?

## Criterio de aceptación (Definition of Done)
- [ ] En `/dashboard/talent/events/[id]`, un evento con `bib_detection_enabled = true` muestra el `BibSearchBar`
      (pasar `bibDetectionEnabled` + `bibSearchLabels` desde la página de talento, como ya hace la pública).
- [ ] En `/events/[slug|shareCode]`, al habilitar el dorsal el buscador aparece **sin esperar** a que expire la
      caché: `enableBibDetectionForEvent` (y `disableBibDetectionForEvent`) revalidan los tags `event-${eventId}`,
      `event-${slug}`, `event-${share_code}` y la ruta pública/talento, igual que las demás mutaciones del evento.
- [ ] Se respeta el gating existente: no se muestra en eventos upcoming ni con `contains_minors`; búsqueda sigue
      rate-limitada `(identifier, IP)`.
- [ ] strings nuevos en `en.json` y `es.json` si se añade copy (reusar `bibDetection.*` ya existente).
- [ ] test que falla antes y pasa después (p. ej.: la página de talento pasa `bibDetectionEnabled`; el helper de
      revalidación incluye los tags `event-*` al habilitar/deshabilitar).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Archivos: `src/app/[lang]/dashboard/talent/events/[id]/page.tsx` (falta el prop),
  `src/app/[lang]/dashboard/photographer/events/[id]/actions.ts` (`enableBibDetectionForEvent` /
  `disableBibDetectionForEvent`, revalidación de tags), `src/app/[lang]/events/[shareCode]/page.tsx`
  (referencia de cómo la pública sí lo pasa), `src/components/event-gallery-with-face-search.tsx` (gating L133).
- CLAUDE.md ya anotaba como follow-up: "Talent-dashboard event view doesn't surface bib search yet" — este ticket
  cierra ese hueco y además arregla la caché de la vista pública. Actualizar esa nota de CLAUDE.md al cerrar.
- Reportado sobre `/dashboard/photographer/events/b5b4a5ee-ed3a-430c-a62e-293cf7970410` (mismo evento que T-061/T-063).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
