# T-189 · Deshabilitar "añadir al carrito" + tooltip cuando el fotógrafo no tiene pagos configurados

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno técnico, pero **reevaluar tras T-190** (diseño de saldo+retiro dentro de Stripe):
  si T-190 se aprueba, el checkout se desbloquea y de este ticket solo sobrevive el sub-ítem de error
  tipado; si T-190 se aplaza, este ticket sigue valiendo como mitigación barata del modelo actual
- **Rama:** `feat/cart-gate-photographer-payouts`
- **OpenSpec change:** —  (probable: toca >1 archivo — varios entry points de add-to-cart + query + i18n)
- **PR:** —

## Requerimiento
(en palabras del usuario) Si un fotógrafo no ha configurado correctamente su cuenta bancaria (Stripe
Connect no `active`), sus fotos **no se pueden comprar**, pero el flujo del atleta es confuso: puede
entrar al evento, añadir fotos al carrito, y **solo al intentar pagar** salta un error que **ni siquiera
dice el motivo**. Lo ideal:

- **No interrumpir** la navegación ni la visualización del talento — puede ver el evento y las fotos con normalidad.
- **Antes** de que la foto llegue al carrito, **deshabilitar la opción de "añadir al carrito"** en **todos** los
  puntos de entrada dentro de un evento, y mostrar un **tooltip informativo** que explique por qué no se puede.

Los puntos de entrada de "añadir al carrito" dentro de un evento son (todos deben quedar cubiertos):
1. Desde la foto directamente → menú de tres puntos (`PhotoActionIcon`) → "Añadir al carrito".
2. Seleccionar la(s) foto(s) → acción masiva "Añadir al carrito" de la toolbar.
3. Abrir la foto en detalle (modal/lightbox) → "Añadir al carrito".

El usuario **descartó** la opción de "recibir el dinero nosotros y dejar que el fotógrafo retire lo
pendiente cuando configure Stripe" (añade demasiada complejidad sobre el modelo actual, donde Stripe
Connect entrega el pago directo al fotógrafo). Planteó como alternativa "no mostrar los eventos de
fotógrafos sin pagos configurados" y pidió opinión.

## Recomendación (decisión de este ticket)
**Opción A: deshabilitar add-to-cart + tooltip** (la que prefiere el usuario). **NO** ocultar el evento
(Opción B): esconder eventos legítimos daña el descubrimiento y el SEO, y los fotógrafos suben fotos
**antes** de configurar payouts con frecuencia — la foto sigue siendo válida para verse, solo no comprable
todavía. **Fuente de verdad:** el mismo predicado que ya usa el checkout — `stripe_connect_status === 'active'`
por **fotógrafo** (`getPhotographerConnectStatuses`), evaluado **por-foto** (un evento colaborativo puede
mezclar fotos comprables y no comprables según el fotógrafo/contribuidor de cada una). No re-derivar "está
payout-ready?" localmente en cada sitio.

## Criterio de aceptación (Definition of Done)
- [ ] En la página pública del evento (`/events/[shareCode]`) y en la vista de evento del dashboard de
      talento (`/dashboard/talent/events/[id]`), cuando el fotógrafo de una foto **no** está `active` en
      Connect, el botón/opción "Añadir al carrito" aparece **deshabilitado** en los **tres** entry points
      (menú tres puntos de la foto, acción masiva de selección, y modal/lightbox de detalle).
- [ ] Cada control deshabilitado muestra un **tooltip** informativo explicando el motivo (el fotógrafo aún
      no puede recibir pagos / fotos no disponibles para compra por ahora).
- [ ] La **selección** de fotos y la **navegación/visualización** siguen intactas — solo se bloquea la compra,
      no el ver el evento ni abrir la foto.
- [ ] En eventos colaborativos, el gate es **por-foto** según el fotógrafo de esa foto (no todo-o-nada por evento).
- [ ] **Defensa en profundidad en checkout:** el gate de `cart/actions.ts` (autenticado **y** invitado) deja de
      lanzar un `Error` crudo (redactado en prod → error opaco) y devuelve un **código de error tipado** que
      cruza el boundary RSC → el cliente mapea a copy localizado con el motivo (patrón T-045/avatar). Cubre el
      caso en que el fotógrafo se desactive **después** de añadir al carrito.
- [ ] strings nuevos en `en.json` y `es.json` (tooltip + mensaje de checkout con motivo).
- [ ] test de regresión que falla antes y pasa después: (a) add-to-cart deshabilitado cuando el fotógrafo no
      está `active`, habilitado cuando sí; (b) el gate de checkout devuelve el código tipado (no throw opaco)
      para autenticado e invitado.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Estado actual verificado en código:** el gate ya existe y es **correcto** funcionalmente — bloquea la venta
  que el fotógrafo no podría cobrar. El problema es puramente de **UX/claridad**, no de dinero (no se cobra de
  más ni se pierde plata). Por eso **P2**, no P1 (paralelo a T-174: "confuso pero no roto").
  - Checkout **autenticado**: `createCheckoutSessionAction` — mismo patrón de gate por `stripe_connect_status`.
  - Checkout **invitado**: `src/app/[lang]/cart/actions.ts:170-177` — `getPhotographerConnectStatuses(...)` →
    `notConnected` → `throw new Error(dict.stripeConnect.checkout.photographerNotConnected)`.
  - El `throw` se **redacta** en prod (Next borra el message de errores de Server Action) → el comprador ve un
    error genérico sin motivo = el síntoma reportado. De ahí el requisito de código tipado.
- **Reusar el helper/predicado existente** (`getPhotographerConnectStatuses` / `stripe_connect_status === 'active'`)
  y bajar el flag payout-ready por-foto al cliente desde el server (igual que `needsProtectedPreview` u otros
  flags derivados server-side), sin llamar a Stripe por foto.
- **No** tocar la lógica de transferencia/payout del webhook (eso es T-074) — este ticket es solo el UX del
  comprador + el mensaje de checkout.
- Familia: T-074 (gate de payout en el webhook), T-045 (código de error tipado en checkout de suscripción).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/cart-gate-photographer-payouts`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
