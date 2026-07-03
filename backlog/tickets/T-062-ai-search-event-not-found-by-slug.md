# T-062 · Bug: búsqueda por dorsal (y facial) falla con "Event not found" en eventos públicos abiertos por slug

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/ai-search-resolve-event-by-slug`
- **OpenSpec change:** — (bug fix; implementar directo)
- **PR:** —

## Requerimiento
La búsqueda por **dorsal** en la galería pública del evento falla con `Error: Event not found.` (digest
`4090731008`). Debe funcionar en cualquier evento accesible (público por slug/UUID o privado por share code).

## Causa raíz (confirmada en código)
- La página pública del evento (`src/app/[lang]/events/[shareCode]/page.tsx`) resuelve el evento por **UUID → slug
  → share_code** (`getCachedEventData`), así que el parámetro de ruta llamado `shareCode` **en realidad puede ser
  un slug o un UUID**, no siempre un share code.
- Pero las acciones de búsqueda resuelven el evento **solo** por share code:
  - `searchPhotosByBibInEvent` (`events/[shareCode]/actions.ts:346`): `getEventByShareCode(adminClient, shareCode)` → si null, `throw 'Event not found.'` (L347).
  - `searchFacesInEvent` (mismo archivo, L168): **mismo patrón** → mismo bug para la búsqueda **facial**.
- **Clave:** los eventos **públicos solo** tienen `share_code = null` (en `createEvent`:
  `shareCode = organizer ? null : isPublic && !isCollaborative ? null : generateShareCode()`) y usan **slug** en la
  URL. Por tanto `getEventByShareCode(slug)` **nunca** los encuentra → "Event not found". La búsqueda por dorsal y
  la facial quedan **rotas en el caso público más común** (evento público solo, abierto por su slug).
- (Los eventos colaborativos, que sí tienen share code, sí funcionan — por eso no se detectó antes.)

## Criterio de aceptación (Definition of Done)
- [ ] La búsqueda por **dorsal** funciona en un evento **público abierto por slug** (y por UUID), no solo por share code.
- [ ] La búsqueda **facial** (`searchFacesInEvent`) — mismo bug — también se corrige (resolución de evento compartida).
- [ ] Resolver el evento en las acciones de búsqueda con la **misma lógica multi-identificador** que la página
      (UUID → slug → share_code), en vez de solo `getEventByShareCode`. Centralizar el resolver para no duplicar.
- [ ] No regresar seguridad: seguir respetando visibilidad/estado (público/aprobado/no-minors) y los rate-limits
      por `(identifier, IP)`; el gating de `bib_detection_enabled` / AI habilitado se mantiene.
- [ ] Verificar que los eventos **privados por share code** (colaborativos) siguen funcionando.
- [ ] test que falla antes y pasa después: la búsqueda resuelve el evento por slug/UUID (evento público con
      `share_code = null`) y devuelve resultados en vez de lanzar "Event not found".
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Archivo: `src/app/[lang]/events/[shareCode]/actions.ts` (`searchPhotosByBibInEvent`, `searchFacesInEvent`, y ojo
  con la acción de borrado de foto guest ~L65 que también hace `getEventByShareCode`). Reusar el resolver
  UUID→slug→share_code de `page.tsx`/`getCachedEventData` (extraerlo a un helper de queries si hace falta).
- Confirmar alcance en repro: ¿el evento afectado es público-solo (slug, share_code null)? El `b` del error del
  usuario parece un id de server action, no el identificador del evento — confirmar con el evento real.
- Impacto alto: dorsal + facial son el valor central para el talento ("encuentra tus fotos"); están rotas en
  eventos públicos por slug. Podría ser P0 si aplica a todos los públicos — validar y subir prioridad si procede.

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
