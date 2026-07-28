# T-193 · Checkout cobra en USD en vez de EUR — fee de conversión en cada venta

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/checkout-currency-eur`
- **OpenSpec change:** —  (bug de config/moneda; implementar directo, es riesgo de pagos → `/code-review`)
- **PR:** #255

## Requerimiento
La venta de prueba (comprador y vendedor en **España**) se cobró en **USD**, no en EUR. Evento de Stripe
confirmado: `checkout.session.completed` con `"currency": "usd"`, `amount_total: 99` sobre una foto de
**€0.99** → se cobró **$0.99**, no €0.99. Además `adaptive_pricing.enabled: true`.

## Causa raíz (verificada en código)
La moneda está **hardcodeada a USD** en toda la app pese a ser un negocio EUR:
- Checkout **invitado**: `src/app/[lang]/cart/actions.ts:194` → `currency: 'usd'`.
- Checkout **autenticado**: `src/app/[lang]/dashboard/talent/cart/actions.ts:428` → `currency: 'usd'`.
- Defaults: `orders.ts:75` y `guest-orders.ts:124` → `currency ?? 'usd'`.
- Webhook persiste `session.currency` (que llega `'usd'` porque el checkout lo fijó).
- Formatters del dashboard: `currency: 'USD'` (recent-sales, performance-chart, metrics-row, earnings).
- `src/lib/plans.ts`: precios de planes comentados/mostrados como **USD** (`$X/mo`).

**El daño económico:** la cuenta Stripe de la plataforma liquida en **EUR** (`default_currency: eur`,
visto en el evento `account.updated`). Un cargo en USD a un comprador español se **convierte a EUR al
liquidar** → **~2% de fee de conversión de moneda** encima del fee base de Stripe, en **cada venta**.
Es parte de por qué el fee de la venta de prueba salió alto. Empeora la pérdida en ventas chicas
(ver `docs/BILLING_MODEL.md`).

## Criterio de aceptación (Definition of Done)
- [ ] Ambos checkouts (invitado + autenticado) crean la sesión de Stripe en **EUR** (`currency: 'eur'`),
      no USD. Decidir si hardcodear `'eur'` o introducir una constante/config única `PLATFORM_CURRENCY`
      (recomendado: constante única para no volver a divergir).
- [ ] Defaults de `orders`/`guest-orders` y los formatters del dashboard alineados a EUR (símbolo €).
- [ ] Precios de planes en `plans.ts` expresados y mostrados en EUR (símbolo/format), consistente con el
      cobro real; revisar copy del pricing-section.
- [ ] **Adaptive Pricing:** decidir explícitamente si se deja ON (Stripe presenta la moneda local al
      comprador, base EUR) u OFF; documentar la decisión. Con base EUR y usuarios EU, el cargo ya no
      pasa por conversión — confirmar en una venta de prueba que el fee baja.
- [ ] test de regresión: el payload de la sesión de checkout (mock del cliente Stripe) lleva
      `currency: 'eur'` en invitado y autenticado — falla antes / pasa después.
- [ ] `/code-review` sobre el diff (toca pagos) + `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Órdenes históricas:** no migrar la moneda de filas ya existentes (son las ventas de prueba en USD);
  el fix aplica de aquí en adelante.
- **Relación con T-194 (billing v2):** la moneda EUR es prerequisito del modelo v2 — sin esto, el
  cálculo de break-even está contaminado por el ~2% de conversión. Ejecutar T-193 antes o dentro de la
  implementación de v2.
- Verificación end-to-end: tras el fix, una venta de prueba EU debe cobrar en EUR y mostrar en el
  dashboard de Stripe un fee **sin** la línea de conversión de moneda.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/checkout-currency-eur`.
2. Implementar directo (bug); test de regresión.
3. `/code-review` (pagos) → arreglar findings reales.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
