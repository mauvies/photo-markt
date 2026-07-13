# T-117 · Feat: quitar ítems del carrito cuando su foto/evento se borra (+ validación de invitado, aviso y red de seguridad en checkout)

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/remove-orphaned-cart-items-on-deletion`
- **OpenSpec change:** `remove-orphaned-cart-items` (archivado)
- **PR:** #175
- **Cluster:** Carrito/previews & integridad — T-115 → T-116 → T-117 (ver notas; T-117 es el más grande)

## Requerimiento (Parte 3 del reporte — el gap real)
Comportamiento estándar de marketplace: si el vendedor **retira inventario** (aquí: el fotógrafo borra un
evento o una foto), ese ítem debe **quitarse de cualquier carrito** donde esté. Un carrito nunca debe
dejar comprar algo que ya no existe. Hoy el borrado de foto/evento **no** limpia `cart_items` de otros
usuarios ni valida los carritos de invitado.

## Alcance (cuatro sub-entregables)

### A. Carritos autenticados (`cart_items`)
- Cuando se borra una foto (individual, en bulk, o vía borrado de evento que cascada a sus fotos), **borrar
  las filas de `cart_items` que referencian esas fotos, de TODOS los usuarios** que las tenían en el
  carrito (no solo el fotógrafo que borra).
- Hacerlo dentro del **flujo de borrado existente** (Server Actions / limpieza Inngest — donde ya se
  limpian `photo_faces`, archivos de Storage, etc.), añadiendo la limpieza de carrito ahí. Solo crear un
  job Inngest separado si la investigación muestra que es más limpio (justificar en el PR).

### B. Carritos de invitado (`localStorage`)
- El server no puede limpiarlos proactivamente. Añadir **validación en vivo** al **cargar la página del
  carrito** (o al leer el guest cart): verificar que cada `photo_id` del guest cart **aún existe y es
  comprable** (no borrada, `upload_status='approved'`, evento no borrado). Quitar las entradas inválidas
  en ese momento.
- Consulta **liviana** en batch de los `photo_id` del guest cart contra `photos` (una sola query).

### C. Aviso al usuario (ambos tipos de carrito)
- Cuando se quitan ítems por esta limpieza (server-side para autenticados, o validación client-side para
  invitados), mostrar un aviso claro: **"Uno o más artículos de tu carrito ya no están disponibles y
  fueron eliminados"** / **"One or more items in your cart are no longer available and were removed"**,
  listando cuáles si es viable.

### D. Red de seguridad en checkout (defensa en profundidad)
- Independientemente de A–C, el **inicio de checkout/pago debe re-validar server-side** que cada ítem del
  carrito referencia una foto que **aún existe y es comprable**, **justo antes** de crear el pago de
  Stripe. **Nunca** permitir un cargo por una foto borrada. Protege contra cualquier carrera o gap.

## Criterio de aceptación (Definition of Done)
- [ ] Borrar una foto o un evento **quita los `cart_items` correspondientes de todos los usuarios
      afectados** (individual, bulk, y cascada por borrado de evento).
- [ ] Los carritos de invitado se **validan y limpian al cargar** el carrito, quitando entradas de fotos
      que ya no existen o no son comprables (`approved`, evento vivo).
- [ ] El usuario ve un **aviso claro** cuando se le quitan ítems por indisponibilidad (auth y guest).
- [ ] El **checkout re-valida** el contenido del carrito server-side inmediatamente antes del pago; una
      foto borrada **nunca** puede cobrarse.
- [ ] **Órdenes/`order_items` intactas** — este ticket NO borra ni modifica registros históricos de compra
      (eso es facturación/legal; ver T-116 para el fallback de preview de órdenes).
- [ ] Sin regresión en agregar/quitar/checkout del carrito.
- [ ] strings nuevos en `en.json` y `es.json` (el aviso, al menos).
- [ ] Todas las queries en `/database/queries/`; mutaciones vía Server Actions. Sin `any`. Biome.
- [ ] test de regresión/feature que falla antes y pasa después: (a) borrar foto/evento vacía `cart_items`
      de otro usuario; (b) validación de guest cart quita un `photo_id` borrado; (c) checkout rechaza un
      carrito con foto borrada antes de tocar Stripe.
- [ ] `/code-review` sobre el diff antes de commitear (toca pagos/DB) y arreglar findings reales.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Archivos probables:** borrado de evento `src/app/[lang]/dashboard/photographer/events/[id]/actions.ts`
  + `events/actions.ts`; borrado de foto (single + bulk) `events/[id]/edit/actions.ts` (`deletePhotoAction`)
  y el bulk-delete de contribuidor (`use-bulk-contributor-delete` / acciones asociadas); limpieza Inngest
  de Storage/`photo_faces` (`src/lib/inngest/functions/*`). Queries de carrito `src/database/queries/carts.ts`.
  Checkout `src/app/[lang]/dashboard/talent/cart/actions.ts` (`createCheckoutSessionAction` +
  `createGuestCheckoutSessionAction`) y `src/app/api/stripe/checkout/route.ts`.
- **Nueva query sugerida:** `deleteCartItemsByPhotoIds(photoIds)` (service-role, cross-user) en `carts.ts`;
  y `getPurchasablePhotoIds(photoIds)` para las validaciones de guest + checkout (una sola fuente de verdad
  de "comprable": existe + `approved` + evento no borrado).
- **Relación con T-115:** la validación server-side del guest cart (B) puede alimentar también la
  resolución en vivo de la preview de T-115 — reusar el mismo lookup batch, no duplicar. Ejecutar en serie
  con merge previo (mismo código de carrito).
- **Consideración de checkout autenticado:** ya existe un webhook `payment_intent.succeeded` que crea la
  orden; la re-validación (D) va en la **creación de la sesión/intent**, antes del cobro, no en el webhook.
- **RLS:** borrar `cart_items` de otros usuarios requiere `supabaseAdmin` (service-role), igual que el
  resto de limpiezas cross-user en los flujos de borrado.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/remove-orphaned-cart-items-on-deletion`.
2. `/opsx:propose` → `/opsx:apply` (toca DB/borrado/pagos — amerita OpenSpec).
3. Implementar + tests de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. `/code-review` sobre el diff (pagos/DB) y arreglar findings reales.
6. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
7. `git push -u origin <rama>`.
8. `gh pr create --draft` apuntando a `main`.
9. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
10. `/opsx:archive` del change.
