# T-054 · Bug: el evento se crea igual aunque la subida falle (eventos huérfanos) + UX de error

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno (hay una decisión de diseño a tomar al ejecutar — ver Notas — pero no bloquea)
- **Rama:** `fix/event-creation-orphan-on-error`
- **OpenSpec change:** **probable** — hay que decidir la estrategia (borrar huérfano vs. estado draft vs. diferir creación); capturarla antes de implementar.
- **PR:** —

## Requerimiento
Al crear un evento con fotos, si ocurre un error durante el proceso (p. ej. la subida falla), el usuario ve el
error y **no puede continuar**, pero **el evento se crea igualmente** en segundo plano. El usuario reportó
haber generado **3 eventos huérfanos** así, viéndolos ya creados al volver a la app.

Comportamiento esperado:
- Si el flujo de creación falla, **no debe quedar un evento creado** (bloquear/revertir la creación).
- El error debe emitirse **de la mejor forma posible** — un **toast / notificación** clara — y no solo como
  texto en rojo pegado a la barra de botones donde se crea/cancela el evento.

## Contexto / diagnóstico (confirmado en código)
- `wizard.tsx` (~L421-486) documenta y ejecuta el orden: **1) `createEvent` → persiste el evento y devuelve
  `eventId`**, 2) `createPhotoUploadUrls`, 3) PUT de bytes, 4) `attachPhotosToEvent`. El `eventId` se necesita
  para mintear las signed URLs, por eso el evento se crea **antes** de subir.
- Si la subida lanza, el `catch (uploadErr)` (L482) solo hace `console.error` — **el evento ya quedó creado**.
  De ahí los eventos huérfanos.
- Los errores se muestran con `setSubmitError(...)` → texto rojo inline junto a los botones, no un toast.
- Disparador principal de este reporte fue el bucket `photos` inexistente en prod (arreglado en T-053/PR #110),
  pero el bug de fondo es independiente: **cualquier** fallo (límite de plan, red, worker, cancelación) deja el
  evento huérfano.

## Criterio de aceptación (Definition of Done)
- [ ] Si la creación del evento + subida falla de forma no recuperable (o el usuario cancela tras el error), **no
      queda un evento visible/listado**: se revierte/borra/soft-delete el evento huérfano, o no se lista hasta
      finalizar (según la estrategia elegida en Notas).
- [ ] El error se comunica con un **toast/notificación** legible (patrón existente de la app), no solo texto rojo
      inline en la barra de botones.
- [ ] El flujo queda **bloqueado** ante error: el usuario no avanza a un estado "a medias" que sugiera éxito.
- [ ] No se rompe el caso feliz (evento con fotos OK) ni el de evento sin fotos.
- [ ] Coordinar con T-052 (persistencia del estado del paso 1 al reintentar) para no chocar en `wizard.tsx`.
- [ ] strings nuevos en `en.json` y `es.json` (si hay copy de error nuevo).
- [ ] test que falla antes y pasa después: cubrir que un fallo de subida **no** deja un evento persistido
      visible (o lo limpia), y que el error se propaga como estado de error del flujo.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Restricción arquitectónica:** el evento se crea primero porque `createPhotoUploadUrls`/`attachPhotosToEvent`
  necesitan `eventId`. "No crear el evento hasta el final" no es directo. Opciones a evaluar (OpenSpec):
  - **A. Limpieza en error:** al fallo no recuperable o cancelación, borrar/soft-delete el evento recién creado
    (ya existe infra de soft-delete `events.deleted_at` y `deleteStorageFiles`). La más alineada con "que no
    quede el evento".
  - **B. Estado draft:** el evento nace oculto/`draft` y solo se hace visible/listable al finalizar; un cron
    limpia drafts viejos. Más robusto pero más trabajo (nueva columna/estado).
  - **C. Diferir creación:** reordenar para no persistir hasta confirmar, con un flujo de subida que no dependa
    de `eventId` estable (mayor cambio).
- Recomendación inicial: **A** para el fix inmediato del huérfano + toast de error; considerar B como mejora.
- Se consideró separar en dos tickets (huérfano vs. UX de error) pero comparten el mismo `catch` en `wizard.tsx`
  y se implementan juntos; se dejan en uno.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
