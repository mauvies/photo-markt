# T-074 · Bug: el estado de Stripe Connect queda obsoleto ("en revisión") en el dashboard pese a que la conexión ya es activa

- **Prioridad:** P1
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `fix/stripe-connect-status-stale`  (tipo = fix)
- **OpenSpec change:** —  (se decide al ejecutar; probablemente extraer la reconciliación live a un helper compartido — toca dashboard + webhook)
- **PR:** —

## Requerimiento
En `/dashboard/photographer` aparece la alerta *"Tu cuenta de Stripe está en revisión. Los pagos se habilitarán cuando sea aprobada. Ir a configuración de pagos"* **a pesar de que la conexión de Stripe Connect ya fue exitosa** (cuenta activa). La alerta no debería mostrarse cuando la cuenta está realmente activa, y el estado almacenado no debe quedar obsoleto.

## Criterio de aceptación (Definition of Done)
- [ ] Con una cuenta de Connect realmente activa (`charges_enabled && payouts_enabled`), el banner de "en revisión" **no** aparece en `/dashboard/photographer`
- [ ] El estado mostrado en el dashboard refleja el estado **real** de Stripe (reconciliación live o auto-sanación del valor almacenado), igual que ya hace la página de payout-profile
- [ ] **Impacto de pagos (crítico):** un pago de una cuenta activa cuyo `stripe_connect_status` almacenado esté obsoleto **no** debe hacer que la transferencia al fotógrafo se retenga (ver Notas) — el path de transferencia usa el estado real de la cuenta
- [ ] La reconciliación no se duplica: helper compartido entre payout-profile, dashboard y (según se decida) el webhook de transferencia
- [ ] test de regresión que falla antes y pasa después (estado almacenado `pending` + cuenta live activa → banner oculto / transferencia no retenida)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Causa raíz (investigada, capture-only):** el banner del dashboard (`dashboard/photographer/page.tsx:30`) lee el valor **almacenado** `profile.stripe_connect_status` sin reconciliar contra Stripe. Ese valor solo se actualiza a `active` por (a) el webhook `account.updated` (`api/stripe/webhook/route.ts:501-511`, vía `deriveConnectStatus` en `src/lib/stripe/connect.ts:16`: active si `charges_enabled && payouts_enabled`) o (b) la visita a la página de payout-profile, que **sí** hace un chequeo live y auto-sana el valor (`settings/payout-profile/page.tsx:33-48`, con el comentario *"the webhook can lag or miss events"*). Si el webhook se pierde/retrasa y el usuario no visita payout-profile, el dashboard muestra `pending` obsoleto → "en revisión".
- **Por qué es P1 y no cosmético — se salta payouts:** el handler de `payment_intent.succeeded` retiene la transferencia al fotógrafo si el `stripe_connect_status` **almacenado** no es `'active'` (`api/stripe/webhook/route.ts:88`: *"transfer … held in the platform account"*). Es decir, con el estado almacenado obsoleto en `pending`, **una venta de una cuenta realmente activa no le paga al fotógrafo** (queda retenido en la plataforma). El mismo valor obsoleto también bloquea la vista de ganancias (`earnings/actions.ts:71`). Por eso el fix debe ir a la fuente del estado, no solo al banner.
- **Enfoque sugerido:** extraer la reconciliación live (retrieve account → `deriveConnectStatus` → sync a DB si difiere) de `payout-profile/page.tsx` a un helper compartido y usarlo en el dashboard; y/o hacer que el path de transferencia del webhook consulte el estado real de la cuenta (o dispare la sanación) antes de retener. Cuidado con no meter una llamada a Stripe en cada render sin necesidad (la página de payout-profile ya paga ese costo; evaluar cachear/gatear por `account_id` presente).
- **Ángulo local:** en local los webhooks de Connect no llegan sin `stripe listen`/forwarding, así que el estado almacenado se queda en `pending` — consistente con el síntoma reportado. La reconciliación live en el dashboard también arregla el caso local.
- **Área sensible (pagos):** seguir las convenciones de CLAUDE.md; no romper el gating de transferencias ni exponer datos. Considerar planning si el fix toca el webhook de pagos.
- **Prioridad P1:** bug de pagos + engaño al usuario en el dashboard principal; no es P0 porque los fondos retenidos se pueden reconciliar y la cuenta activa permite la transferencia una vez saneado el estado.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/stripe-connect-status-stale`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
