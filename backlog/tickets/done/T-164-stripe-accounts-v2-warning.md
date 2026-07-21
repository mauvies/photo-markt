# T-164 · Warning del SDK de Stripe: "We recommend building your integration using Accounts v2" en el dashboard del fotógrafo

- **Prioridad:** P3
- **Estado:** done (Opción A — aceptar v1)
- **Blockers:** ninguno (pero lleva una **decisión** dentro: migrar a v2 vs. aceptar v1 — ver DoD)
- **Rama:** `chore/stripe-accounts-v2-warning`  (tipo = chore)
- **OpenSpec change:** —  (si se decide migrar a Accounts v2 → sí OpenSpec, es cambio de pagos; si se acepta v1, no)
- **PR:** #232

## Requerimiento (reporte del usuario)
> En **dev**, al visitar `/en/dashboard/photographer`, aparece en consola:
> ```
> Server  (node:30460) Stripe: We recommend building your integration using Accounts v2.
> See https://docs.stripe.com/api/v2/core/accounts
> (Use `node --trace-warnings ...` to show where the warning was created)
> ```

## Causa (verificada en código)
El dashboard del fotógrafo (`src/app/[lang]/dashboard/photographer/page.tsx`) llama
`reconcileAndPersistConnectStatus` → `retrieveConnectAccount` → **`stripe.accounts.retrieve()`**
(`src/lib/stripe/connect.ts:31`), que usa la **API Connect Accounts v1**. Toda nuestra superficie de
Connect es v1: `accounts.retrieve` (31), `accounts.create` (108), `accountLinks.create` (125),
`balance.retrieve` (141), más los `transfers.create` del webhook. El SDK **`stripe@22`** (subido en
**T-152**) emite este `process.emitWarning` recomendando **Accounts v2**.

**Es un warning informativo, NO un error ni una deprecation con fecha de sunset.** La API v1 de
Connect (Express accounts, account links, transfers) sigue **totalmente soportada** y es el estándar
de la mayoría de integraciones Connect. El pago/payout funciona igual; esto solo ensucia la consola
de dev (y potencialmente los logs de server en prod).

## Decisión pendiente (parte del ticket)
- **A) Aceptar v1 (recomendado por defecto):** v1 sigue soportada; migrar a Accounts v2 es un cambio
  **grande y crítico de pagos** (otra forma de API para crear cuenta, onboarding, retrieve, balance,
  transfers) — no vale el riesgo solo para silenciar una *recomendación*. Documentar la decisión y,
  si el warning molesta, **silenciarlo** de forma acotada (investigar si el SDK expone una opción para
  suprimir recomendaciones, o filtrar ese `emitWarning` específico sin ocultar otros warnings). Cerrar
  el ticket con eso.
- **B) Migrar a Accounts v2:** solo si hay una razón real (Stripe anuncia sunset de v1, o queremos
  features de v2). Eso sería un **ticket propio, grande, con OpenSpec + `/code-review ultra`** (mismo
  criterio que T-152) — no se hace a la ligera dentro de este.

## Criterio de aceptación (Definition of Done)
- [ ] Investigar si el warning se puede **silenciar de forma acotada** sin ocultar otros warnings del
      SDK/Node (opción del SDK, o un filtro de `process` sobre ese mensaje puntual). Si no hay forma
      limpia, documentar por qué se deja.
- [ ] Registrar la **decisión A/B** con su porqué. Si es **A** (recomendado): documentar en el ticket
      / `ARCHITECTURE.md` §4.3 (Connect) que seguimos en Accounts **v1** a propósito y que el warning
      es esperado; opcionalmente aplicar la supresión acotada. Si es **B**: **no** implementar aquí —
      filar un ticket dedicado de migración (grande, pagos, OpenSpec).
- [ ] Sin cambios de comportamiento del flujo de Connect/payout; sin nuevos `any`.
- [ ] Si se toca código (supresión del warning): `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Follow-up directo de T-152** (bump del SDK a v22, que es cuando aparece la recomendación).
- **P3:** cero impacto funcional — es ruido de consola en dev, no un bug de usuario ni de dinero.
- Contexto de Connect: `ARCHITECTURE.md` §4.3 + `src/lib/stripe/connect.ts`.
- **No migrar a v2 a ciegas** — es superficie de pagos; cualquier migración va por su propio ticket
  con OpenSpec + `/code-review ultra` (criterio T-152).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `chore/stripe-accounts-v2-warning`.
2. Investigar la supresión + registrar la decisión A/B. Si B, filar ticket aparte y cerrar este como decisión.
3. Si se toca código: test de regresión si aplica + `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
