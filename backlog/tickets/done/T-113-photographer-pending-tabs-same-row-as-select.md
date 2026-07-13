# T-113 · UI: tabs Aprobadas/Pendientes en la misma fila que el botón "Select"

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/photographer-pending-tabs-select-row`
- **OpenSpec change:** —  (UI con requerimiento claro; se implementó directo)
- **PR:** #173

## Requerimiento
En el dashboard del fotógrafo, al ver un evento colaborativo con aprobación de administrador
habilitada (`/dashboard/photographer/events/[id]`), las tabs "Fotos aprobadas" / "Pendientes" y el
botón "Select" (modo selección) están en filas separadas — las tabs arriba, el botón "Select" debajo,
dentro del panel activo. El usuario pide que ambos queden en la **misma línea horizontal**: las tabs a
la izquierda, el botón "Select" completamente a la derecha.

## Criterio de aceptación (Definition of Done)
- [ ] En un evento colaborativo con `eventUsesModerationQueue(event)` true, las tabs "Fotos
      aprobadas"/"Pendientes" y el botón "Select" quedan en una sola fila: tabs a la izquierda, botón
      "Select" al extremo derecho
- [ ] El comportamiento de cambio de tab (mostrar `EventPhotoAlbum` vs `PendingPhotosTab`) no cambia —
      solo se reubica el layout de la fila superior
- [ ] El botón "Approve all" (solo visible en la tab "Pending", ver `pending-photos-tab.tsx:154-177`)
      sigue funcionando igual — decidir si se queda donde está (dentro del panel, debajo de la fila de
      tabs+Select) o si tiene sentido fusionarlo en la misma fila; documentar la decisión en el PR
- [ ] Sin regresión visual en el modo selección (toolbar de selección batch) ni en eventos sin cola de
      moderación (donde no se muestran tabs)
- [ ] test de regresión/feature que falla antes y pasa después (a nivel DOM: tabs y botón "Select" en el
      mismo contenedor/fila)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Investigación previa (this ticket, antes de implementar):** las tabs aprobadas/pendientes en
  `src/app/[lang]/dashboard/photographer/events/[id]/page.tsx:302-383` usan el `Tabs`/`TabsList` de
  shadcn (`@/components/ui/tabs`) — **no** el mismo componente `EventPhotoFilterTabs` que usan las
  vistas pública/talento. El botón "Select" vive varias capas más adentro, dentro de cada
  `TabsContent` (`event-photo-album.tsx` → `PhotoGallery` → `PhotoSelectionToolbar` para "All";
  `pending-photos-tab.tsx:154-177` → `PhotoSelectionToolbar` para "Pending") — por eso hoy quedan en
  filas distintas (`TabsContent` tiene `className="mt-4"`, empujando el contenido debajo del
  `TabsList`).
- **Patrón ya existente a reusar:** en las vistas pública y de talento (`EventPhotoFilterTabs`), T-104
  (PR #169) ya dejó tabs + botón "Select" en la misma fila pasando las tabs como `toolbarLeading` a
  `PhotoGallery`, que las reenvía al slot `leading` de `PhotoSelectionToolbar`. La vista del fotógrafo
  nunca adoptó ese mecanismo para su switcher aprobadas/pendientes — implementarlo aquí probablemente
  implica sacar el `TabsList` de shadcn del layout actual y en su lugar pasarlo (o un tab-switcher
  equivalente) como `toolbarLeading`/`leading`, igual que en talento/público. Evaluar si conviene migrar
  directamente a `EventPhotoFilterTabs` con dos variantes de labels (aprobadas/pendientes) en vez de
  mantener dos componentes de tabs distintos — decisión de implementación, no bloqueante para capturar
  el ticket.
- T-104 (ya hecho, PR #169) **no** tocó este layout — solo añadió contadores a los toolbars existentes;
  la fila de tabs+Select del fotógrafo queda intacta hasta este ticket.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/photographer-pending-tabs-select-row`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
