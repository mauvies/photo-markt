# T-134 · Seguridad/Pagos: el checkout autenticado no re-valida accesibilidad (evento privado tras flip público→privado) — falta prueba de acceso persistida

- **Prioridad:** P2
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `fix/authed-checkout-accessibility`
- **OpenSpec change:** sí — toca pagos/seguridad y probablemente migración (columna de prueba de acceso o tabla de grants); `/opsx:propose` + `/code-review ultra`.
- **PR:** —

## Requerimiento
Hallazgo CONFIRMED del `/code-review high` de T-132. T-132 cerró el add-to-cart, el merge y el checkout
de **invitado** con la regla "público O share code presentado" (`isEventAccessible`). Pero el **checkout
autenticado** (`createCheckoutSessionAction`) solo re-valida *purchasability* (`getPurchasablePhotoIds`),
nunca accesibilidad. Escenario: un talent agrega una foto de un evento **público** (el gate de add pasa
por `is_public`), luego el fotógrafo **cambia el evento a privado** (`is_public=false`); el talent abre
el carrito y compra — la foto ahora privada se cobra igual. El path de invitado **sí** re-chequea
accesibilidad en cada carga/checkout, así que hay una **asimetría**.

**Por qué no se arregló en T-132:** el carrito autenticado (`cart_items`) **no persiste** el share code
presentado en el add. Añadir un chequeo de accesibilidad con "sin códigos" en el checkout autenticado
rechazaría **también** las compras privadas legítimas (la foto privada agregada con el código correcto vía
`/events/[shareCode]`, que no queda tagueada ni guarda el código). El fix correcto necesita **persistir la
prueba de acceso** en el momento del add (columna `share_code`/`access_proven` en `cart_items`, o una tabla
de grants usuario↔evento) para que el checkout autenticado y el self-heal de `getCurrentCart` puedan
re-validar sin romper el flujo privado legítimo.

## Criterio de aceptación (Definition of Done)
- [ ] Elegir y documentar el modelo de prueba de acceso persistida (columna en `cart_items` vs. tabla de
      grants usuario↔evento). Migración additive/idempotente/rollback-inerte.
- [ ] `addPhotoToCartAction` y `mergeGuestCartAction` persisten la prueba (share code presentado, o el
      flag "tagueado/acceso demostrado") al insertar el `cart_item`.
- [ ] `createCheckoutSessionAction` (autenticado) re-valida accesibilidad contra la prueba persistida →
      un ítem que se volvió privado tras un flip público→privado y del que el comprador no tiene prueba se
      rechaza, con paridad con el checkout de invitado. El `getCurrentCart` self-heal quita esos ítems.
- [ ] Los flujos legítimos siguen: compra pública, compra privada vía share code, compra de una foto
      guardada (favoritos/tag), carrito de invitado.
- [ ] Test de regresión: foto agregada pública → evento flip a privada → checkout autenticado la rechaza
      (falla antes, pasa después); compra privada legítima con prueba persistida sigue pasando.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas (hallazgos menores del mismo review, resolver aquí o documentar)
- **Ítems legacy de invitado sin `eventShareCode`** (cacheados en localStorage antes de que el campo
  existiera) de un evento **privado**: hoy `loadGuestCartStateAction` los reporta como `removedPhotoIds`
  y el cliente los borra con un toast de "no disponible" aunque sean comprables. Es la elección segura
  (no se puede probar acceso), pero la UX (borrado silencioso + toast engañoso) se puede suavizar. Blast
  radius bajo (ítems de invitado privados legacy son raros; los públicos legacy no se ven afectados).
- **Query duplicada (perf):** `getPurchasablePhotoIds` y `getAccessiblePhotoIds` corren dos SELECTs
  `photos!inner(events…)` casi idénticos sobre el mismo set (checkout de invitado: tres, contando el
  select de precio). Corren en `Promise.all` (latencia en paralelo), pero se pueden fusionar en un solo
  helper `getPurchasableAndAccessiblePhotoIds` que seleccione `deleted_at, is_public, share_code` de una.
  Path caliente, no autenticado, gated por Stripe.
- **Revisar la superficie de tag/save:** el fallback de "tagueado = prueba de acceso" en
  `addPhotoToCartAction` (T-132) es tan fuerte como el gate del propio `addPhotoToMyPhotosAction`/
  `tagPhotoForTalent`. Verificar que taguear no sea una superficie abierta por UUID (mismo tipo de bug);
  si lo es, gatearla con la misma regla.

## Constraints
- Regla de acceso compartida (`isEventAccessible`/`getAccessiblePhotoIds`, T-132) — reusar, no re-derivar.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/authed-checkout-accessibility`.
2. `/opsx:propose` (pagos/seguridad + migración) → `/opsx:apply`.
3. Implementar + test de regresión.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. `/code-review ultra` (pagos) sobre el diff; arreglar findings reales.
6. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
7. `git push -u origin <rama>`.
8. `gh pr create --draft` apuntando a `main`.
9. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
10. `/opsx:archive`.
