# T-132 · Seguridad: add-to-cart acepta fotos de eventos privados sin chequear visibilidad (share code)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/add-to-cart-event-visibility`
- **OpenSpec change:** —  (superficie auth/seguridad → `/code-review` antes de commitear)
- **PR:** #188

## Requerimiento
Hallazgo CONFIRMED del `/code-review high` de T-130 (pre-existente — el lookup de `addPhotoToCartAction`
siempre fue con `supabaseAdmin`). Ni `addPhotoToCartAction` ni el predicado compartido
`getPurchasablePhotoIds` (T-117) chequean la **visibilidad del evento**: solo "foto existe + `approved` +
evento no soft-deleted". Un usuario autenticado que conozca el UUID de una foto de un **evento privado
protegido por share code** (link de galería compartido una vez, respuesta de API filtrada) puede meterla
al carrito, y desde T-130 el carrito le resuelve una preview (thumbnail o signed URL admin) de una foto
de un evento al que no debería tener acceso — e incluso comprarla. Antes de T-130 la RLS user-scoped
bloqueaba la preview *por accidente* (bloqueaba también todos los casos legítimos, el bug T-130).

## Criterio de aceptación (Definition of Done)
- [ ] Decidir y documentar el criterio de acceso: ¿"purchasable" exige `is_public = true` O demostración
      de acceso (share code) para eventos privados? (El flujo real de compra en evento privado entra por
      `/events/[shareCode]` — evaluar si el add-to-cart debe llevar/verificar esa prueba de acceso.)
- [ ] `addPhotoToCartAction` (y/o `getPurchasablePhotoIds`) rechaza fotos de eventos privados cuando el
      caller no demuestra acceso; los flujos legítimos (galería pública, galería privada vía share code,
      carrito de invitado) siguen funcionando.
- [ ] Test de regresión: foto de evento `is_public = false` añadida por UUID directo → rechazada
      (falla antes, pasa después); flujo con share code → sigue OK.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Origen: `/code-review high` de T-130. Findings hermanos: T-131.
- Ojo con `mergeGuestCartAction` y el checkout de invitado — comparten la misma laguna; cubrir los
  tres caminos con el mismo predicado, no parches por call-site.
- Severidad moderada: requiere conocer el UUID (no enumerable trivialmente), pero el invariante de
  eventos privados debe sostenerse server-side, no por oscuridad.

## Constraints
- Extender el predicado compartido (T-117) en un solo lugar. Sin otros cambios.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/add-to-cart-event-visibility`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
