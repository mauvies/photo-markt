# T-047 · Mover toggle de detección por dorsal al wizard de creación de evento (paso 1)

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/bib-detection-toggle-wizard`
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

El toggle para activar la búsqueda por dorsal (BIB) aparece actualmente solo en la página de detalle/edición del evento, después de haberlo creado. El usuario espera verlo en el paso 1 del wizard de creación de evento, junto con el toggle de reconocimiento facial (AI matching), para que ambas opciones sigan el mismo flujo. Además, también debe seguir estando disponible al editar el evento, igual que las demás opciones de configuración.

Resumen del cambio esperado:
1. **Wizard de creación (paso 1):** añadir el toggle `bib_detection_enabled` al lado del toggle de reconocimiento facial.
2. **Página de edición de evento:** mantener el toggle en la misma sección donde ya están las otras opciones (consistencia).
3. **Página de detalle del evento (vista post-creación):** retirar el toggle si fue movido ahí de forma ad-hoc; no debe haber rastro fuera del flujo estándar.
4. La acción de creación debe persistir `bib_detection_enabled` al insertar el evento, igual que ya hace con `ai_matching_enabled`.

## Criterio de aceptación (Definition of Done)
- [ ] El toggle "Activar detección de dorsal" aparece en el paso 1 del wizard de creación junto al toggle de reconocimiento facial
- [ ] Al crear un evento con el toggle activado, `bib_detection_enabled = true` se persiste en la base de datos
- [ ] El toggle también aparece en la vista de edición del evento, en la misma sección de configuración AI
- [ ] No queda ningún toggle de BIB en lugares que no sean creación y edición (p.ej. la página de detalle post-creación si se hubiera añadido ahí de forma separada)
- [ ] El comportamiento existente (activar/desactivar en edición dispara backfill o cleanup) no se rompe
- [ ] Strings de UI presentes en `en.json` y `es.json` (sin hardcodear)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

- El toggle de reconocimiento facial en la creación está en `src/app/[lang]/dashboard/photographer/events/new/` — buscar ahí el campo `ai_matching_enabled` para replicar el patrón con `bib_detection_enabled`.
- La acción de creación del evento está en `src/app/[lang]/dashboard/photographer/events/new/actions.ts` (o similar).
- En la edición, buscar `bib_detection_enabled` en `src/app/[lang]/dashboard/photographer/events/[id]/` para verificar que ya está incluido.
- Revisar si hay algún campo de toggle en la página de detalle (`/events/[id]/page.tsx` o similar) y eliminarlo si no corresponde al flujo de edición estándar.
- La lógica de backfill (`backfillEventBibDetection`) se dispara al activar desde la edición — asegurarse de que sigue funcionando igual.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/bib-detection-toggle-wizard`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
