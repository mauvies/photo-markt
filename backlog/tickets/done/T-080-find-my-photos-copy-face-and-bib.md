# T-080 · Título/descripción de "Encuéntrate" no reflejan que también existe búsqueda por dorsal

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/find-my-photos-copy-face-and-bib`  (tipo = fix)
- **OpenSpec change:** — (no aplicó — copy + helper puro de selección en componente existente)
- **PR:** #143

## Requerimiento
La sección "Encuéntrate en este evento" (banner "find my photos") en las páginas de evento tiene un título y descripción que asumen **solo búsqueda facial** ("Sube una selfie..."), pero un evento puede tener búsqueda facial, por dorsal, o ambas. Actualizar:

1. **Título method-neutral:** cambiar "Encuéntrate en este evento" / "Find yourself in this event" → **"Encuentra tus fotos" / "Find your photos"** — funciona sin importar el método habilitado.
2. **Descripción condicional** según qué métodos estén habilitados en ese evento específico (`ai_matching_enabled` / face eligible, `bib_detection_enabled`):
   - Solo facial: ES "Sube una selfie y te mostraremos las fotos en las que apareces." / EN "Upload a selfie and we'll show you the photos you appear in."
   - Solo dorsal: ES "Introduce tu número de dorsal y te mostraremos tus fotos." / EN "Enter your bib number and we'll show you your photos."
   - Ambos: ES "Sube una selfie o introduce tu número de dorsal y te mostraremos tus fotos." / EN "Upload a selfie or enter your bib number and we'll show you your photos."

Si ningún método está habilitado, la sección no debe renderizar (comportamiento ya existente — verificar que se mantiene).

## Criterio de aceptación (Definition of Done)
- [x] El título en las vistas aplicables dice "Encuentra tus fotos" / "Find your photos"
- [x] La descripción es condicional y coincide con los métodos habilitados del evento: copy solo-selfie (solo facial), solo-dorsal (solo bib), combinada (ambos)
- [x] Copy correcto en español e inglés
- [x] Aplica en `/events/[shareCode]` y `/dashboard/talent/events/[id]`; el dashboard del fotógrafo queda sin cambios (no muestra esta sección)
- [x] Si ningún método está habilitado, la sección sigue sin renderizar (`resolveFindMyPhotos` intacto; cubierto por tests existentes)
- [x] test de regresión/feature que falla antes y pasa después (helper `resolveFindMyPhotosCopy`: facial-only / dorsal-only / ambos + indexing)
- [x] strings nuevos en `en.json` y `es.json`; eliminadas las huérfanas `aiSearch.banner.titleReady`/`descriptionReady` y `bibDetection.searchTitle`/`findDescription`
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Nota de implementación
La selección de copy se extrajo a un helper puro `resolveFindMyPhotosCopy` (junto a `resolveFindMyPhotos`),
testeado para las 3 combinaciones + el caso indexing. El bug exacto (líneas ~86-97 del componente) era
que con ambos métodos habilitados se mostraba el copy solo-facial; ahora hay una 3ª rama "ambos". El
título dejó de ser específico de facial ("Encuéntrate en este evento") a neutral ("Encuentra tus fotos").

## Notas
- **Componente exacto:** `src/components/find-my-photos-banner.tsx` (`FindMyPhotosBanner`, interfaz `FindMyPhotosLabels`). La visibilidad (ocultar si ningún método habilitado) ya vive en el helper puro `resolveFindMyPhotos` (`src/lib/find-my-photos.ts`, de T-065) — **no tocar esa lógica**, ya hace lo que pide el AC de "si ninguno, no renderiza".
- **El bug exacto está en la selección de copy (líneas ~86-97 de `find-my-photos-banner.tsx`):** hoy solo hay 2 variantes reales — si `face` está presente (sin importar si `bib` también lo está) usa `titleReady`/`descriptionReady` (o la variante `Indexing`); si `face` está ausente usa `bibOnlyTitle`/`bibOnlyDescription`. Es decir, cuando **ambos** métodos están habilitados, hoy se muestra el copy **solo-facial**, ignorando que también hay dorsal — exactamente el bug reportado. Hace falta una 3ª rama para el caso "ambos".
- **Estado "indexing" (`titleIndexing`/`descriptionIndexing`) no es parte de este ticket** — es sobre el evento aún procesando fotos vía IA, ortogonal a la combinación facial/dorsal. Mantener sin cambios; solo tocar las variantes del estado "ready".
- **Claves i18n actuales involucradas:** `aiSearch.banner.titleReady`/`descriptionReady` (`en.json`/`es.json` ~línea 1324-1327) y `bibDetection.searchTitle`/`findDescription` (~línea 1242-1243). Construidas en los 2 call sites en alcance: `src/app/[lang]/dashboard/talent/events/[id]/page.tsx:~366-373` y `src/app/[lang]/events/[shareCode]/page.tsx:~560-566` (mismo shape de `findLabels` en ambos). Probablemente conviene una nueva clave neutral para el título (p.ej. `aiSearch.banner.title`) y 3 claves de descripción (facial/dorsal/ambos) en vez de las actuales `titleReady`/`bibOnlyTitle` separadas — a decidir en la implementación.
- **Nota curiosa (no conflicto):** `aiSearch.modal.title` ya vale literalmente "Encuentra tus fotos" — pero es el título del **modal de selfie** (otra superficie), no el del banner. Coincidencia de texto, no la misma clave.
- **Prioridad P2:** copy desactualizado/engañoso para eventos con dorsal habilitado, pero no es un bug funcional ni bloquea nada.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/find-my-photos-copy-face-and-bib`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
