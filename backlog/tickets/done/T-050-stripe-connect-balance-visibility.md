# T-050 · Ver el saldo real de Stripe Connect (disponible / en camino) y próximo depósito

- **Prioridad:** P1
- **Estado:** done — **ya implementado en `main`** (no requirió PR nuevo)
- **Blockers:** ninguno (Stripe Connect ya está integrado — los transfers disparan por orden a la cuenta Express del fotógrafo)
- **Rama:** — (no se creó)
- **OpenSpec change:** —
- **PR:** — (feature ya presente; ver commit `0317cb9`)

## Resolución (2026-07-01)
Al ejecutar `/work-next` se descubrió que el requerimiento **ya está implementado en `main`** — la captura
del ticket fue imprecisa (no se revisó `earnings-content.tsx`/`earnings/actions.ts`). La pestaña **Ganancias**
(`/dashboard/photographer/sales?tab=earnings`) ya muestra, para cuentas Stripe Connect `active`:
- **"Stripe available"** (`getStripeConnectBalanceAction` → `retrieveConnectBalance` → `stripe.balance.retrieve`) — dinero listo para depositar.
- **"Stripe pending"** — dinero en camino / aún sin liquidar.
- Card de **payout schedule**: "Payouts are sent automatically every Monday…".
- Banner que enlaza al perfil de payout si la cuenta no está conectada/activa.

Cerrado como **already-done** por decisión del usuario. Gap menor no perseguido: el texto "every Monday"
(`payoutScheduleDesc`) está hardcodeado en vez de derivar la **fecha exacta del próximo payout** del schedule
real de la cuenta en Stripe. Si en el futuro se quiere ese número exacto, abrir un ticket nuevo acotado a eso.

## Requerimiento
Como fotógrafo quiero saber, **desde Photo Markt**, cuánto dinero tengo esperando en Stripe para que se
deposite en mi cuenta bancaria (p. ej. cada lunes). Hoy no hay forma de verlo dentro de la app:

> "Ahora mismo, ¿cómo sé cuánto dinero tengo en la cuenta relacionada con mis pagos? Es decir, cuánto
> dinero tengo esperando en Stripe para que sea depositado cada lunes en mi cuenta. ¿Cómo puedo ver esto
> desde Photo Market?"

## Contexto / diagnóstico
- El dashboard de ganancias (`/dashboard/photographer/sales?tab=earnings`) muestra **contabilidad interna**
  calculada desde nuestras tablas `orders`/`payouts` (`getEarningsSummary` en `src/database/queries/earnings.ts`):
  bruto, comisión, neto, pagado, pendiente, retirable. **No** consulta a Stripe.
- El dinero real vive en la **cuenta Stripe Connect (Express)** del fotógrafo: los transfers se disparan
  **por orden**, sincrónicamente en el webhook `payment_intent.succeeded` (ver `ARCHITECTURE.md` §4.3). Stripe
  deposita a la cuenta bancaria según el **payout schedule** de la cuenta conectada (semanal, típicamente lunes).
- Falta exponer el **balance real de Stripe** (disponible / en camino "pending") y la **fecha del próximo
  payout** que hoy solo se ven entrando al Stripe Express Dashboard, no en Photo Markt.

## Criterio de aceptación (Definition of Done)
- [ ] El fotógrafo con cuenta de payout conectada ve, dentro del dashboard de pagos/ganancias, su **saldo
      real de Stripe Connect**: monto **disponible** (available) y monto **en camino / pendiente** (pending),
      por moneda, tomado en vivo de Stripe (`balance.retrieve` sobre la cuenta conectada) — no de nuestras tablas.
- [ ] Se muestra la **fecha/periodicidad del próximo depósito** (payout schedule de la cuenta conectada, o el
      próximo payout previsto) o, si Stripe no lo expone directamente, un texto claro de cadencia + link al
      Stripe Express Dashboard para el detalle.
- [ ] Si el fotógrafo **no** tiene cuenta conectada / verificada, se muestra un estado vacío que lo dirige a
      conectar/completar su perfil de payout (reusar `payout-profile-banner`/`payout-profile-section`).
- [ ] Manejo de error explícito si la llamada a Stripe falla (no silent catch; no filtrar el error crudo al cliente).
- [ ] Se distingue visualmente el "saldo real en Stripe" de la contabilidad interna ya existente (evitar que
      el usuario confunda los dos números).
- [ ] La llamada a Stripe va por Server Action / capa server (nunca desde el cliente); rate-limit si aplica
      (pega a API externa — ver `src/lib/rate-limit.ts`).
- [ ] strings nuevos en `en.json` y `es.json`.
- [ ] test que falla antes y pasa después (mock del cliente Stripe: mapea el balance de Stripe → el shape que
      consume la UI; caso sin cuenta conectada; caso de error de Stripe).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Fuente de verdad del dinero disponible = Stripe**, no nuestra tabla `payouts`. Nuestro `withdrawableBalance`
  es una estimación contable; el balance de Stripe es el real (refleja transfers ya liquidados, reversals,
  disputas, holds, etc.). Aclarar en la UI cuál es cuál.
- Como los transfers ya se hacen por orden a la cuenta conectada, el "saldo esperando" del usuario **es** el
  balance de la cuenta Connect (available + pending), gestionado por el payout schedule de esa cuenta.
- Al ejecutar: revisar `src/app/[lang]/dashboard/photographer/settings/payout-profile/` (datos de la cuenta
  conectada / `account_details` en `payment_accounts`) para obtener el `stripe_account_id` con el que consultar
  el balance. Confirmar que guardamos ese id.
- Por tocar pagos: correr `/code-review` (idealmente `/code-review ultra`) sobre el diff antes de commitear.
- Alternativa mínima si el balance en vivo resulta caro/complejo: al menos un enlace directo al **Stripe Express
  Dashboard** del fotógrafo (login link vía Stripe Connect) — pero el objetivo pleno es mostrar el número en Photo Markt.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
