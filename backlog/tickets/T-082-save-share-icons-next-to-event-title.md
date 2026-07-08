# T-082 · Reposicionar "Save event" y "Share" como iconos junto al título del evento

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/save-share-icons-next-to-event-title`  (tipo = feat)
- **OpenSpec change:** — (probablemente no aplica — reusa componentes/lógica existentes; confirmar al ejecutar)
- **PR:** —

## Requerimiento
En la página de evento del dashboard de talento, el botón "Save event" (icono corazón + texto) aparece hoy debajo del título/descripción. Moverlo a la misma línea del título, alineado a la derecha, y reducirlo a icono-only con tooltip. Agregar un icono "Share" al lado (reusando la funcionalidad de compartir que ya existe para fotos individuales, apuntado a la URL pública del evento). En la vista pública, mostrar solo el icono Share (sin Save, que es solo para talento).

**Layout — un único patrón para todos los viewports** (sin caso especial mobile): título en un contenedor flexible que hace wrap a varias líneas si hace falta; icono(s) en un contenedor de ancho fijo que nunca se comprime (`flex-shrink-0`), siempre visible a la derecha.
- Dashboard de talento: dos iconos (corazón Save, luego Share).
- Vista pública: un icono (solo Share).
- El corazón no lleva texto visible — solo tooltip "Save event"/"Guardar evento" (reusa el estado toggled/lógica existente — relleno cuando está guardado).
- El icono de compartir tampoco lleva texto — tooltip "Share"/"Compartir".

**Comportamiento de compartir:** reusar la lógica de compartir que ya existe para fotos individuales, pero apuntada a la **URL pública del evento** (`/events/[shareCode-o-slug]`), no a la ruta del dashboard — así el link compartido funciona para cualquiera, incluso sin cuenta, aunque se comparta desde el dashboard de talento. Adaptar el componente para que funcione sin `photoId` — verificar que la lógica de construcción de URL soporte este caso limpiamente en vez de asumir contexto de foto.

**Comportamiento de guardar:** reusar la Server Action y el estado toggle de guardar/desguardar ya existentes de la feature de eventos guardados. Solo cambia la presentación (icon-only + tooltip, reposicionado) — la lógica de guardado, el gating por rol (solo talento) y las actualizaciones optimistas de UI quedan igual.

## Criterio de aceptación (Definition of Done)
- [ ] En el dashboard de talento, los iconos Save (corazón) y Share aparecen en la misma línea que el título, alineados a la derecha, icon-only con tooltip — el botón "Save event" con texto desaparece
- [ ] En la vista pública, solo aparece el icono Share junto al título
- [ ] El título hace wrap a varias líneas cuando es largo, sin empujar ni comprimir el/los icono(s) — verificado en mobile y desktop
- [ ] Un único layout consistente en todos los viewports — sin arreglo especial solo-mobile
- [ ] El icono Share reusa la lógica de compartir existente de fotos, adaptada para compartir la URL pública del evento sin requerir `photoId`
- [ ] El icono Save reusa la lógica y el estado toggled (relleno/vacío) existentes de eventos guardados
- [ ] Los tooltips muestran "Save event"/"Guardar evento" y el texto correspondiente de Share, en ambos idiomas
- [ ] Sin regresión en la funcionalidad subyacente de guardar o compartir — solo cambia presentación/posición
- [ ] test de regresión/feature que falla antes y pasa después
- [ ] strings nuevos en `en.json` y `es.json` (tooltips)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **El icono Save YA existe, casi listo para reusar tal cual:** `src/components/event-save-button.tsx` (`EventSaveButton`) ya soporta un `variant="overlay"` icon-only con tooltip (vía `PhotoActionIcon`, el estándar documentado en CLAUDE.md), además del `variant="button"` con texto que se usa hoy. El call site actual con texto está en `src/app/[lang]/dashboard/talent/events/[id]/page.tsx:311` (`<EventSaveButton eventId={event.id} variant="button" />`), dentro de un `<div className="mt-3">` debajo de la descripción (líneas ~295-313). **Ojo:** el estilo `overlay` de `PhotoActionIcon` es del patrón "pill oscura sobre foto" (pensado para overlays sobre thumbnails) — verificar si visualmente encaja junto a un título de página o si conviene un tercer variant/estilo para este contexto (icon-only pero sin el fondo oscuro tipo overlay).
- **Título del dashboard de talento:** se renderiza vía `DashboardHeader` (`src/components/dashboard-header.tsx`), que **ya tiene un slot `actions`** con exactamente el patrón flex pedido (`flex items-center justify-between gap-4` + `shrink-0` en las actions) — es decir, la infraestructura de layout para "título flexible + acciones de ancho fijo a la derecha" ya existe, solo hay que pasarle los iconos vía esa prop en vez de renderizarlos aparte. Único matiz a revisar: usa `items-center`, que centra las acciones respecto al bloque completo del título (no específicamente contra la primera línea) cuando el título hace wrap a 2+ líneas — puede necesitar `items-start` si se quiere alineación estricta con la primera línea.
- **Título de la vista pública:** NO usa `DashboardHeader` — es un `<h1 className="text-3xl font-bold">{event.name}</h1>` plano en `src/app/[lang]/events/[shareCode]/page.tsx:503`, sin ningún slot de acciones hoy. Hay que envolverlo en el mismo patrón flex (reusando `DashboardHeader` si el tamaño de fuente encaja, o replicando el patrón inline).
- **El icono Share NO es un componente extraíble tal cual — es un patrón inline a extraer:** hoy "compartir" vive como lógica inline en `handleShare` dentro de `src/components/photo-detail-modal.tsx` (líneas ~140-153): `navigator.share({ title, url: current.url })` con fallback a `navigator.clipboard.writeText`. **Importante:** `current.url` ahí es la URL de la **imagen** de la foto (asset), no una URL de página — no es directamente reusable para compartir el evento (que necesita apuntar a `/events/[shareCode]`, una página, no un asset). Lo reusable es el **patrón de interacción** (Web Share API + fallback a portapapeles), no un componente ya genérico — conviene extraer un helper puro pequeño (ej. `shareUrl(title, url)`) y usarlo tanto desde `photo-detail-modal.tsx` (sin cambiar su comportamiento) como desde el nuevo icono de evento.
- **URL pública del evento para compartir:**
  - Vista pública (`events/[shareCode]/page.tsx`): ya existe una variable `eventUrl` calculada (línea ~411, `${siteUrl}/${lang}/events/${canonicalPath}`) para JSON-LD/SEO — reusar esa misma construcción.
  - Dashboard de talento (`dashboard/talent/events/[id]/page.tsx`): la página ya tiene `event.share_code` cargado (se usa en otros lugares de la página, ej. líneas ~319-387) — construir la URL pública equivalente a partir de `share_code` (o `slug` si no hay share_code), no la ruta del dashboard.
- **Fuera de alcance:** cualquier cambio a la lógica de guardado/compartir en sí (Server Actions, hook `useSavedEvents`) — solo posición/presentación.
- **Prioridad P2:** mejora de UX/consistencia visual, no es un bug ni bloquea nada.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/save-share-icons-next-to-event-title`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
