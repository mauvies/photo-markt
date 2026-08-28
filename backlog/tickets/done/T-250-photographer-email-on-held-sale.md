# T-250 · El fotógrafo que no entra al dashboard no se entera de que tiene dinero esperando

- **Prioridad:** P2
- **Estado:** done
- **Riesgo:** normal  (plantilla de email + un envío best-effort; no toca el cálculo ni el movimiento del dinero)
- **Blockers:** ninguno  (Dep T-248 / PR #305 — mergear antes, es quien crea el caso)
- **Rama:** `feat/photographer-held-sale-email`  (tipo = feat)
- **OpenSpec change:** —
- **PR:** #310

## Requerimiento

**T-248** (PR #305) quitó el gate de Connect del checkout: ahora una venta de un fotógrafo sin cuenta
de cobro activa **sí se cobra**, y su neto queda en una fila `payouts` con
`hold_reason = 'connect_inactive'` que `retry-pending-payouts` paga sola en cuanto conecte.

Ese cambio se pagó con avisos, pero **todos los avisos son in-app**: el banner del dashboard, el
aviso del evento y la alerta de Ganancias. Un fotógrafo que no entra al dashboard **no se entera de
que ha vendido ni de que tiene dinero esperándole** — y es justo el perfil que no ha completado el
onboarding, así que es el más probable de no entrar.

**El email es el único canal que le alcanza.** Hoy no existe ninguno dirigido a fotógrafos:
`src/lib/email/` solo tiene recibos al comprador (`send-purchase-confirmation-email`,
`send-guest-purchase-email`) y una alerta operativa (`send-face-search-alert`).

## Criterio de aceptación (Definition of Done)

- [x] Cuando el webhook abre una fila `payouts` con `hold_reason = 'connect_inactive'`, se envía al
      fotógrafo un email que dice que ha vendido, cuánto le espera, y que conecte su cuenta para cobrarlo
- [x] El envío es **best-effort y no puede tumbar el webhook**: el pago ya ocurrió, y un fallo de Resend
      no debe provocar que Stripe reentregue el evento (mismo criterio que el `try/catch` de `openPayoutRow`)
- [x] **No se repite en cada venta.** Decidir y documentar la regla anti-spam (p. ej. solo en el primer
      hold, o como mucho uno por día/fotógrafo) — un fotógrafo con 40 fotos vendidas no debe recibir 40 emails
- [x] **Sin PII del comprador** en el email: importes e ids, nunca su email ni su nombre
- [x] Decidir el locale. Las plantillas actuales son solo inglés porque no reciben el idioma de quien
      las recibe; aquí sí hay un `profiles` del que leerlo — si se deja en inglés, decirlo explícitamente
- [x] Test de regresión: se abre un hold `connect_inactive` ⇒ se intenta el envío; el envío falla ⇒ el
      webhook sigue devolviendo 200
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Resolver el email del fotógrafo desde `auth.users` vía `supabaseAdmin` (hay `get_user_emails_batch`;
CLAUDE.md prefiere resolver PII server-side desde ids conocidos antes que exponerla).

⚠️ Conviene coordinarlo con **T-249** (que una venta que se salta la transferencia deje de ser
silenciosa): ese avisa **a la plataforma** de un fallo, este avisa **al fotógrafo** de un estado
normal. Son destinatarios y severidades distintas — no fundirlos en un solo mecanismo, pero sí
mirarlos juntos para no montar dos sistemas de notificación.

Relación: **T-248** (crea el caso, PR #305) · **T-216** (crea los holds) · **T-249** (alerta operativa).
