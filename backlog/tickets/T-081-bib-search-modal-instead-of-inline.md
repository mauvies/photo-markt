# T-081 · Búsqueda por dorsal: abrir un modal en vez de un input inline

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno (mismo archivo que T-080 — ver Notas, coordinar orden de ejecución)
- **Rama:** `fix/bib-search-modal-instead-of-inline`  (tipo = fix)
- **OpenSpec change:** — (probablemente no aplica — cambio de UI acotado a un componente existente; confirmar al ejecutar)
- **PR:** —

## Requerimiento
En las páginas de evento (dashboard de talento y vista pública), buscar por número de dorsal hoy muestra un input inline que aparece debajo del botón de búsqueda, dentro de la misma sección "Encuentra tus fotos" — esto causa un salto de layout no deseado (la altura de la sección cambia y empuja el contenido de abajo). Reemplazar por un **modal** (Shadcn Dialog): al hacer click en el botón de búsqueda por dorsal se abre un modal simple con el input de dorsal, en vez de expandir la sección inline.

El modal debe tener: una instrucción/label corta, el input de número de dorsal, y un botón de submit (+ cancelar/cerrar). Al enviar, el modal se cierra y la grilla filtra a las fotos encontradas — **mismo comportamiento de búsqueda que hoy** (mismo flujo `useBibSearch`/`searchPhotosByBibInEvent`, mismo filtrado de resultados, mismo manejo de empty-state/sin-match) — solo cambia dónde vive el input, no la lógica de búsqueda.

**Teclado:** el input recibe foco al abrir el modal; Enter envía; Escape cierra el modal sin buscar.

## Criterio de aceptación (Definition of Done)
- [ ] Al hacer click en la acción de búsqueda por dorsal se abre un modal con el input, en vez de expandir un campo inline dentro de la sección
- [ ] La sección "Encuentra tus fotos" mantiene una altura constante — sin salto de layout al activar la búsqueda por dorsal
- [ ] Enviar el dorsal en el modal lo cierra y filtra la grilla a los matches, igual que el comportamiento actual
- [ ] El modal soporta Enter para enviar y Escape para cerrar/cancelar
- [ ] Mismo comportamiento en `/events/[shareCode]` y `/dashboard/talent/events/[id]`
- [ ] Sin regresión en la lógica de matching por dorsal ni en la visualización de resultados
- [ ] test de regresión/feature que falla antes y pasa después
- [ ] strings nuevos en `en.json` y `es.json` si aplica (label/instrucción del modal)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Componente exacto a tocar:** `src/components/find-my-photos-banner.tsx` (`FindMyPhotosBanner`). El input inline vive hoy en el bloque `bibExpanded` (estado local `bibOpen`/`bibValue`, líneas ~56-154): un `<form>` con `<Input>` + botón de búsqueda + botón "Clear", que se renderiza condicionalmente DEBAJO de la fila de botones — eso es lo que causa el salto de layout. Hay que mover ese `<form>` (input, submit, clear) a un `Dialog` de Shadcn, controlado por el mismo estado `bibOpen` (que pasa a controlar la apertura del modal en vez de la expansión inline).
- **Reusar el flujo de búsqueda tal cual:** `runBibSearch`/`clearBib`/`searchPhotosByBibInEvent` (via prop `bib.onResults`) no cambian — es exactamente el mismo flujo `useBibSearch` (contexto `BibSearchContext` en `event-gallery-with-face-search.tsx`) que ya consumen `event-photo-viewer.tsx` (talento) y `public-event-photo-viewer.tsx` (público). Solo cambia el contenedor visual del input.
- **Patrón de modal a seguir:** ya existe un modal Shadcn Dialog para la búsqueda facial — `src/components/face-search-modal.tsx` (`FaceSearchModalLabels`, usa `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle` de `@/components/ui/dialog`). Seguir la misma convención de estructura/estilo para consistencia, aunque el contenido sea mucho más simple (solo un input numérico + submit, sin cámara/consentimiento).
- **Fuera de alcance:** cualquier cambio a la lógica/matching de búsqueda por dorsal (reusar `searchPhotosByBibInEvent`/`useBibSearch` tal cual) y el flujo de búsqueda facial (ya es modal, sin cambios).
- **Cluster con T-080 (mismo archivo):** T-080 ("Título/descripción de 'Encuéntrate'...") también toca `find-my-photos-banner.tsx`, pero una parte distinta (el copy de título/descripción, no el input de dorsal). Recomendable ejecutar uno primero y mergear antes de empezar el otro para evitar conflictos de merge en el mismo archivo.
- **Prioridad P2:** pulido de UX (salto de layout molesto), no es un bug funcional ni bloquea nada.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/bib-search-modal-instead-of-inline`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
