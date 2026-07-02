# T-057 · Bug: el conteo de fotos en la tarjeta del evento (dashboard fotógrafo) crece durante el procesamiento

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/event-card-total-photo-count`
- **OpenSpec change:** — (bug fix, implementar directo)
- **PR:** —

## Requerimiento
Al crear un evento de **286 fotos**, la tarjeta del evento en el listado del dashboard del fotógrafo muestra un
conteo **incorrecto y creciente** (ej. "166 fotos"), que va aumentando al refrescar conforme el worker procesa
las fotos. El conteo de la tarjeta debería reflejar el **total de fotos subidas al evento**, estable desde el
inicio, **sin importar si están validadas/indexadas o no**.

## Causa raíz (confirmada en código)
- `getPhotosForEvents` (`src/database/queries/photos.ts:192`) filtra `.eq('upload_status', 'approved')`. Las
  fotos nacen en `upload_status='pending'` y el worker Inngest las promueve a `approved` tras validarlas, así que
  el conteo por evento (derivado de estas filas en los builders) **crece** conforme se van aprobando.
- El conteo de la tarjeta se calcula de esas filas approved-only en los builders (`stats`/`photoCountByEvent`),
  por eso empieza bajo y sube.

## Criterio de aceptación (Definition of Done)
- [ ] En el **listado de eventos del dashboard del fotógrafo**, el conteo de la tarjeta muestra el **total de
      fotos subidas** al evento (estable), no solo las `approved`. Es decir, no debe crecer al refrescar mientras
      se procesan.
- [ ] Definir el criterio del total (decisión de implementación, documentarla): total = `pending + approved`
      (excluir `rejected`, que son fotos que fallaron validación y no son reales). Confirmar el comportamiento
      deseado para `rejected`.
- [ ] No romper la **portada** de la tarjeta: la portada debe seguir usando una foto servible (approved / con
      thumbnail, o la `cover_path` de T-055) — probablemente requiera separar el *conteo total* (nueva query o
      `count`) del *fetch de portada* (que hoy comparten `getPhotosForEvents`).
- [ ] Decidir/uniformar el conteo en vistas **públicas** (explore, perfil público, talent): ahí mostrar
      approved-only es defendible (no se pueden ver fotos no validadas). Documentar la decisión; el foco del
      reporte es el dashboard del fotógrafo.
- [ ] test que falla antes y pasa después (conteo total vs approved-only para un evento con fotos `pending`).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Builders afectados (dashboard fotógrafo): `src/app/[lang]/dashboard/photographer/actions.ts` (recientes) y
  `src/app/[lang]/dashboard/photographer/events/page.tsx` (listado). Ambos derivan el conteo de
  `getPhotosForEvents` (approved-only).
- Ojo con la interacción con T-055: esos builders también resuelven la portada; separar conteo vs portada para no
  regresar la lógica de cover.
- Relacionado con T-058 (estado "ready" mientras indexa) — mismo síntoma de "los números durante el
  procesamiento no reflejan la realidad", pero distinto código; se capturan por separado.

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
