# T-253 · Los tres emails transaccionales tragan los errores de Resend — un comprador puede pagar y no recibir sus fotos

- **Prioridad:** P1
- **Estado:** doing
- **Riesgo:** normal
- **Blockers:** ninguno
- **Rama:** `fix/transactional-email-error-handling`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

`resend.emails.send` **resuelve `{ data, error }`; no lanza** en un error de API. Los tres emisores
previos descartan el resultado:

- `src/lib/email/send-guest-purchase-email.ts:31`
- `src/lib/email/send-purchase-confirmation-email.ts:42`
- `src/lib/email/send-face-search-alert.ts:26`

Consecuencia en el caso del invitado: si Resend rechaza el email (dominio sin verificar, rate limit,
`to` inválido), la llamada resuelve «bien», el `catch (emailErr)` del webhook nunca salta, se loguea
`Guest order created` — y **el comprador que ya pagó nunca recibe su enlace de descarga, sin dejar
rastro**. El invitado no tiene cuenta donde recuperar las fotos: ese email *es* la entrega.

T-249 (PR #306) arregló este mismo fallo en el emisor nuevo (`send-money-alert.ts`). Estos tres
siguen igual.

Hallado por `/code-review xhigh` sobre el PR #306.

## Criterio de aceptación (Definition of Done)

- [ ] Los tres emisores comprueban `error` y lo propagan (o lo loguean explícitamente)
- [ ] El fallo de entrega del email de invitado queda **visible** — es entrega de producto, no cortesía
- [ ] Extraer el cliente + el `{ error }` + el shell HTML + el escapado a un helper compartido
      (`src/lib/email/…`): hoy el FROM y el esqueleto están copiados **cuatro** veces, y
      `escapeHtml` de `send-money-alert.ts` es candidato a quinta copia
- [ ] Test de regresión por emisor: Resend devuelve `{ error }` ⇒ no se reporta éxito
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Relación: **T-249** (PR #306, arregló el patrón en el emisor nuevo y documentó la trampa).
