# T-267 · Un carrito de invitado de más de ~46 fotos no puede pagar, y nadie se entera

- **Prioridad:** P2
- **Estado:** todo
- **Riesgo:** normal  (no se pierde dinero; se pierde la venta)
- **Blockers:** ninguno
- **Rama:** `fix/guest-cart-metadata-cap`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

`src/app/[lang]/cart/actions.ts:268` construye el metadata de la sesión de Stripe así:

- `is_guest` (1) + `cart_count` (1) + `buildWithdrawalConsentMetadata()` (2, T-228) + **una clave
  `cart_<i>` por foto**.

**Stripe topa el metadata en 50 claves.** Con 4 fijas, el techo real son **46 fotos**; a partir de 47
`sessions.create` lanza.

Pero el propio código permite hasta **100** (`GUEST_CART_MAX_IDS = 100`, `:28`). Así que hay un rango
de 47–100 fotos en el que el comprador invitado añade, ve su carrito, pulsa pagar y **no pasa nada**.

Y nadie se entera: el throw de la Server Action se **redacta en producción** (T-189), no hay
`reportMoneyIncident`, y no hay log que nombre la causa. Se ve como «el botón no funciona».

⚠️ **La Foto-Flat insignia (40 fotos por 19,90 €) queda a cuatro claves del techo** — es justo la
forma de carrito que el producto quiere fomentar.

## Criterio de aceptación (Definition of Done)

- [ ] Un carrito de invitado por encima del límite no falla en Stripe: o se comprime el metadata (p.ej.
      empaquetar varias fotos por clave, o una sola clave con la lista), o se baja
      `GUEST_CART_MAX_IDS` al límite real y la UI lo dice **antes** de pulsar pagar
- [ ] Si se comprime: el webhook debe leer el formato nuevo **y** el viejo — hay sesiones en vuelo, y
      el campo `c` de cada ítem es la asignación comprometida del bundle (T-204), que no se recalcula
- [ ] El límite deja de estar implícito: una constante compartida, no un número que hay que deducir
- [ ] Test que ejercite el tamaño de carrito justo por encima y por debajo
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Hallado por la auditoría **T-257** (`backlog/audits/2026-08-28-money-path.md`).

El carrito autenticado **no** tiene este problema: usa filas de `cart_items`, no metadata.

Relación: **T-204** (el campo `c`) · **T-228** (las 2 claves de consentimiento) · **T-189** (por qué el
error no se ve).
