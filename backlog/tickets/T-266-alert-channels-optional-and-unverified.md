# T-266 · El canal de alertas de dinero es opcional, no verificado, y degrada en silencio

- **Prioridad:** P2
- **Estado:** todo
- **Riesgo:** normal  (observabilidad; no toca dinero directamente)
- **Blockers:** ninguno
- **Rama:** `chore/assert-money-alert-channels`  (tipo = chore)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

`reportMoneyIncident` tiene dos canales y los dos pueden estar apagados sin que nada lo diga:

- `src/lib/observability/report-money-incident.ts:181` — `const to = env.MONEY_ALERT_EMAIL;` seguido de
  `if (!to) return;`
- `env.mjs:64` — `MONEY_ALERT_EMAIL` es opcional y acepta `''`
- El SDK de Sentry queda inerte sin `SENTRY_DSN`

Sin ninguno de los dos, **todo** incidente de T-249/T-253/T-261 colapsa a un `console.error` en los
logs de Vercel — exactamente el modo de fallo de trece días que el reporter existe para acabar.

Y nada lo comprueba: ni CI, ni el arranque, ni `/api/health/ready` (verificado: no menciona ninguna de
las dos variables).

Que las variables sean opcionales es **correcto** — dev, tests y previews deben poder correr sin
ellas. Lo que falta es que **producción** lo afirme.

## Criterio de aceptación (Definition of Done)

- [ ] `/api/health/ready` reporta el estado de los canales de alerta como un check más (el endpoint ya
      devuelve `{ status, environment, checks: [...] }` y el alerting se basa en el campo `status`)
- [ ] O bien `env.mjs` los exige cuando el entorno es producción — decidir cuál en el ticket, no las
      dos a medias
- [ ] Dev / test / preview siguen arrancando sin ellas
- [ ] Test que cubra la decisión que se tome
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Hallado por la auditoría **T-257** (`backlog/audits/2026-08-28-money-path.md`).

⚠️ **Comprobar primero si producción las tiene puestas.** No pude leerlas en la sesión (el repo local
no está enlazado al proyecto de Vercel). Si faltan, esto deja de ser P2 y pasa a ser lo primero: las
alertas de T-249/T-253/T-261 no estarían llegando a nadie, y toda esta familia de tickets asume que sí.

Relación: **T-249** (creó el reporter) · **T-253** · **T-034** (`FACE_SEARCH_ALERT_EMAIL`, misma forma).
