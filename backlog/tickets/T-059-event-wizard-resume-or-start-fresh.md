# T-059 · Al crear evento: ofrecer "continuar borrador en progreso" o "empezar de cero" (gestión del draft)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/event-wizard-resume-or-restart`
- **OpenSpec change:** — (UX del wizard; implementar directo, pero validar el diseño del modal)
- **PR:** —

## Requerimiento
Cuando un usuario deja a medias la creación de un evento y luego vuelve (misma pestaña) e intenta crear un evento,
el wizard **restaura silenciosamente** el borrador anterior: aparecen datos guardados en cada paso y mensajes como
"las fotos se perdieron, vuelve a subirlas". Si el usuario en realidad quería **empezar de cero**, esto es
confuso y **no hay una forma clara de reiniciar**.

Propuesta del usuario: al hacer clic en **crear evento**, si hay un borrador en progreso, mostrar un **modal** que
ofrezca:
- **Continuar** con el evento en progreso, o
- **Empezar un evento nuevo** (desde cero) → limpia el borrador y arranca limpio en el paso 1.

Y que el mensaje de "fotos perdidas al refrescar" **no** aparezca cuando el usuario está en un flujo nuevo/limpio.

## Contexto / diagnóstico (código actual)
- El wizard persiste el borrador en `sessionStorage` (`photo-markt_event_wizard_draft` + `photo-markt_event_wizard_had_files`)
  y lo **restaura en el mount** (`readStoredState` → `form.reset`), mostrando el paso más avanzado alcanzado.
- Si `HAD_FILES` estaba seteado y las fotos (File[] en memoria) ya no están (refresh), se muestra el banner de
  "fotos perdidas" (`photosLost`) — correcto en un flujo continuado, confuso si el usuario cree estar empezando.
- Ya existe un botón **Cancelar** en el paso 1 que limpia el borrador (`DRAFT_KEY`/`HAD_FILES_KEY`) — pero **no es
  descubrible** como "empezar de cero", y el usuario no sabe que su sesión trae un borrador.
- `sessionStorage` es por pestaña y se borra al cerrarla; el caso "vuelvo días después" solo aplica si la pestaña
  sigue abierta. El diseño debe cubrir igualmente el caso intra-sesión (que es el reportado).

## Criterio de aceptación (Definition of Done)
- [ ] Al entrar al wizard de crear evento **con un borrador en progreso**, mostrar un modal claro: **Continuar** /
      **Empezar de cero** (con copy que explique que hay un evento a medio crear).
- [ ] "Empezar de cero" limpia `DRAFT_KEY` + `HAD_FILES_KEY`, resetea el form a defaults y arranca en el paso 1;
      no debe mostrar el banner de "fotos perdidas".
- [ ] "Continuar" restaura como hoy (mismo comportamiento actual de resume).
- [ ] Sin borrador en progreso → no aparece el modal (flujo normal directo).
- [ ] El banner de "fotos perdidas" solo aparece en un resume real (continuando), nunca tras elegir "empezar de cero".
- [ ] strings nuevos en `en.json` y `es.json` (título/opciones del modal).
- [ ] test que falla antes y pasa después (p. ej. helper puro que decide si hay borrador restaurable a partir del
      contenido de sessionStorage; o de la lógica de "mostrar modal / limpiar draft").
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Archivos: `src/app/[lang]/dashboard/photographer/events/new/wizard.tsx` (mount/restore, `photosLost`, botón
  Cancelar), y la lógica de `readStoredState`/`DRAFT_KEY`. Considerar detectar el borrador **antes** de restaurar
  para poder ofrecer la elección (o restaurar y ofrecer "descartar y empezar de cero").
- **Solapamiento:** toca el mismo draft/`wizard.tsx` que **T-052** (persistencia del paso 1), **T-054** (hecho,
  huérfanos) y **T-056** (navegación tras reintento). Ejecutar coordinado con esa zona para evitar conflictos;
  idealmente después de T-052 (que arregla la persistencia en sí).
- Decisión de diseño a validar al ejecutar: modal al entrar vs. banner "tienes un borrador — [continuar]
  [empezar de cero]" no bloqueante. El usuario propuso modal.

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
