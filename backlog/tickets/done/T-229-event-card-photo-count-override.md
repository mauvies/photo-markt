# T-229 · El conteo de fotos del event card ignora el override por ID de evento

- **Prioridad:** P2
- **Estado:** done
- **Riesgo:** normal  (solo display; no toca pagos, BD, auth ni seguridad)
- **Blockers:** ninguno
- **Rama:** `fix/event-card-photo-count-override`  (tipo = fix)
- **OpenSpec change:** —  (un helper compartido + 3 call sites)
- **PR:** #291 (junto con el otro ticket del cluster event card)

## Requerimiento

Para unos eventos concretos de **producción** estamos forzando el número total de fotos que se muestra
dentro del evento, identificándolos por ID de evento. Pero **en el event card**, desde fuera —el home
(`/`) y el listado `/events`—, el conteo total que se renderiza **no coincide** con el que se muestra
dentro del evento para esos mismos eventos.

## Diagnóstico (ya verificado en el código)

No es un fallo del cálculo del conteo: es que el override **se cableó en un solo sitio**.

- El override vive en `src/lib/event-photo-count-overrides.ts` (mapa `id → total`, con tres eventos
  hoy: Mussara, Haute Meuse, Alfarnate) y tiene **un único call site**:
  `src/app/[lang]/events/[shareCode]/page.tsx:213` — la página de detalle.
- El conteo del card sale de un camino **completamente distinto y sin override**:
  `resolvePublicEventCoverStats` (`src/lib/event-cover-stats.ts:38`) →
  `photoCount: stats.get(event.id)?.count ?? 0` en
  `src/app/[lang]/dashboard/talent/events/actions.ts:118`, que es lo que consume `EventsExploreView`
  y por tanto **el home y `/events`** (ambos comparten la misma vista).
- Hay **otras dos superficies públicas** con el mismo síntoma y también sin override:
  eventos guardados (`src/app/[lang]/actions/saved-events.ts:171`) y el perfil público del fotógrafo
  (`src/app/[lang]/photographer/[slug]/actions.ts:113`).

⚠️ **Segunda discrepancia, independiente del override y preexistente:** las dos superficies ni
siquiera cuentan lo mismo. El card cuenta `pending + approved` para eventos **sin** IA
(`event-cover-stats.ts:45` solo excluye no-aprobadas cuando el evento tiene IA activa, por T-072),
mientras que la página de detalle usa `approvedCount` (**solo aprobadas**). O sea que un evento sin IA
a medio subir muestra números distintos dentro y fuera **aunque no esté en el mapa de overrides**.
Decidir si eso entra en este ticket o se deja anotado.

## Criterio de aceptación (Definition of Done)

- [ ] Para un evento listado en el mapa de overrides, el conteo del **event card** en el home y en
      `/events` coincide con el que muestra la página del evento
- [ ] Misma coincidencia en las otras dos superficies públicas que renderizan conteo: eventos
      guardados y perfil público del fotógrafo
- [ ] Los eventos **no** listados en el mapa siguen mostrando su conteo real, sin cambios
- [ ] El override se aplica en **un único punto compartido** (no una cuarta copia de la llamada), de
      forma que borrar el archivo siga siendo un cambio de una sola pieza cuando terminen las pruebas
- [ ] Decidido y anotado en el PR qué se hace con la discrepancia `pending+approved` vs `approved`
      (arreglar o dejar documentada)
- [ ] Test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

- **Esto es andamiaje temporal, no producto.** La cabecera de `event-photo-count-overrides.ts` dice
  literalmente *"TO REMOVE when the tests are done: delete this file and its single call site"*. Ese
  "single call site" es justo la premisa que este ticket rompe: al cablearlo en más superficies, la
  nota de borrado hay que actualizarla para que no quede un override huérfano vivo en producción.
  **Conviene añadir al PR la lista exacta de sitios a borrar.**
- El override solo reescribe el **total mostrado**. La galería sigue renderizando las fotos reales,
  así que "cargar más" se detiene en el conteo verdadero — comportamiento conocido y aceptado
  mientras dure la prueba.
- Prioridad **P2** y no P1 porque no hay dinero, datos ni seguridad en juego: es una inconsistencia
  de presentación sobre datos de prueba. Va arriba del grupo P2 porque está visible en producción
  ahora mismo y el trabajo es pequeño.
- Ojo con la caché al verificar: las superficies de listado se sirven bajo tags (`top-events`,
  `events-public`, `photographer-${slug}`…, ver `src/lib/event-cache-tags.ts`), así que un conteo que
  "no cambia" tras el deploy puede ser caché y no el fix.

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
