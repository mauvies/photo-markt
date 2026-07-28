# T-191 · Connect: cuenta Express de US falla — `transfers` requiere `card_payments`

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/connect-us-card-payments-capability`  (tipo = feat | fix | chore | refactor)
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** #253

## Requerimiento
En **producción (livemode)**, un fotógrafo con cuenta en **US** no puede conectar su cuenta de pagos (Stripe Connect). `stripe.accounts.create` revienta con:

```
StripeInvalidRequestError: You cannot request the `transfers` capability
without the `card_payments` capability for accounts in US.
  param: 'requested_capabilities'  ·  statusCode: 400
  acct_1TR6ZSIXonFCVhXo · req_XdYVu429Dk58bB · livemode
```

Origen: `createExpressAccount` (`src/lib/stripe/connect.ts:104-118`) pide **solo** `capabilities: { transfers: { requested: true } }`. Stripe exige que las cuentas conectadas de **US** que piden `transfers` pidan **también** `card_payments`. Para cuentas no-US (p. ej. el país por defecto de la plataforma) `transfers` sola es válida, por eso el bug solo se dispara cuando `params.country === 'US'`. El resultado: onboarding de payouts **completamente bloqueado** para fotógrafos de US → no pueden cobrar.

## Criterio de aceptación (Definition of Done)
- [ ] Un fotógrafo con `country: 'US'` puede crear su cuenta Express sin el error 400 (`createExpressAccount` pide `card_payments` **y** `transfers` cuando corresponde).
- [ ] Las cuentas no-US siguen funcionando exactamente igual (no regresión — como mínimo `transfers`).
- [ ] Decisión documentada: pedir `card_payments` **solo para US** vs pedirlo **incondicionalmente** (Stripe lo acepta en la mayoría de países y simplifica el código; verificar que no añade fricción de onboarding indebida en el país home de la plataforma). Recomendación por defecto: pedir ambos siempre, o gate por país si aparece fricción.
- [ ] El flujo de transfers/payout (destination transfers en el webhook) sigue intacto — la cuenta conectada solo recibe transfers; `card_payments` es un requisito de capability de Stripe, no cambia que las charges siguen en la cuenta plataforma.
- [ ] test de regresión que falla antes y pasa después (unit: `createExpressAccount` con `country:'US'` incluye `card_payments` en el payload de capabilities; con país no-US mantiene el comportamiento esperado — mock del cliente Stripe).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Archivo único a tocar: `src/lib/stripe/connect.ts` (`createExpressAccount`). Cambio acotado de pagos → **sí** correr `/code-review high` antes de commit (convención de código sensible a pagos), aunque probablemente no requiera OpenSpec (1 archivo).
- **No es duplicado** de **T-190** (diseño de ledger/saldo/retiro) ni **T-189** (gate UX de checkout sin Connect). Esos son sobre el modelo de saldo y el gate de "añadir al carrito"; este es un bug concreto de **creación de cuenta** que impide siquiera empezar el onboarding en US. Toca `connect.ts`, no los checkouts — sin conflicto directo, pero avisar si se ejecutan cerca en el tiempo.
- Prioridad **P1** (no P0) porque solo afecta cuentas **US**; súbela a **P0** si los fotógrafos de US son objetivo de lanzamiento inmediato — en livemode ya es un fallo duro que bloquea el cobro.
- Referencia Stripe: la capability `transfers` en cuentas US no puede solicitarse sin `card_payments` (requisito de la plataforma de Stripe para cuentas de US).

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
