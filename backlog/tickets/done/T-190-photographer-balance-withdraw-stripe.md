# T-190 · [DISEÑO] Saldo del fotógrafo + retiro, dentro de Stripe Connect (vender sin bloquear por payouts)

- **Prioridad:** P2
- **Estado:** done (fase diseño — PR #251; OK del usuario pendiente antes de abrir tickets hijos)
- **Blockers:** ninguno (el diseño es ejecutable ya; la implementación resultante saldrá como tickets hijos)
- **Rama:** `feat/photographer-balance-withdraw` (para la fase de implementación; el diseño no necesita rama)
- **OpenSpec change:** `photographer-balance-withdraw` (creado; queda ACTIVO para los tickets hijos — no archivar hasta completar la implementación)
- **PR:** #251

## Requerimiento
(en palabras del usuario) Poder aceptar ventas **aunque el fotógrafo no haya configurado su cuenta de
pagos**, para **no bloquear el flujo de ventas**: la app retiene el dinero como **saldo** del fotógrafo
y, cuando este configure Stripe Connect, le da la opción de **retirar** lo pendiente. Hacerlo **dentro
de Stripe mismo** (no Wise/PayPal/banco directo) para mantener el paraguas regulatorio de Stripe.

## Contexto — modelo actual (verificado, `ARCHITECTURE.md §4.3`)
- Passthrough puro: en `payment_intent.succeeded` el webhook dispara **una `stripe.transfers.create` por
  (order_item, fotógrafo)**, síncrona e inmediata. `payouts` es solo registro histórico (`status='paid'`).
- Si el fotógrafo no está `stripe_connect_status='active'`: la transferencia se **salta con un
  `console.warn`** y los fondos quedan varados en la cuenta de plataforma **sin ledger** — hoy no hay
  registro estructurado de "cuánto le debemos a quién". Otros gaps conocidos: transfers <50¢ saltados,
  reembolsos no revierten transfers.
- El checkout **bloquea** la compra si algún fotógrafo del carrito no está `active`
  (`cart/actions.ts:170-177` + equivalente autenticado) — el origen de T-189.

## Objetivo del diseño (decisiones a producir)
1. **Modelo de ledger** — la pieza central. Propuesta de partida a validar en el diseño:
   - Evolucionar `payouts` o (mejor) nueva tabla `ledger_entries` append-only:
     `(id, photographer_id, type: sale_credit|refund_debit|withdrawal|adjustment, amount_cents,
     currency, order_item_id?, stripe_transfer_id?, created_at)`. El **saldo = SUM(entries)**, nunca una
     columna mutable. Invariante: cuadrar contra el balance real de Stripe (reconciliación periódica).
   - Idempotencia por evento de webhook (mismo patrón `transfer_<charge>_<order>` actual).
2. **Flujo de venta nuevo**: webhook acredita `sale_credit` SIEMPRE (fotógrafo active o no).
   Decidir: ¿transfer inmediato cuando está `active` (modo passthrough conservado como "auto-retiro")
   o todo pasa por saldo + retiro manual/programado? Recomendación inicial: **conservar el transfer
   inmediato para `active`** (cero cambio de UX para los que ya cobran) y saldo solo para no-active
   — minimiza el blast radius.
3. **Flujo de retiro**: al completar onboarding (webhook `account.updated` → `active`), notificar +
   UI en `/dashboard/photographer/sales?tab=earnings` con saldo pendiente y botón "Retirar" →
   `stripe.transfers.create` por el saldo acumulado + `withdrawal` en el ledger. Decidir si el retiro
   es manual (botón) o automático al activarse (recomendación: **automático al activarse**, con
   registro — menos fricción, el fotógrafo ya expresó querer cobrar al onboardearse).
4. **Reembolsos**: `refund_debit` en el ledger; definir comportamiento con saldo insuficiente
   (saldo negativo permitido + neteo contra ventas futuras vs. `transfer_reversal` si ya retiró).
   Cierra de paso el gap conocido de "refunds no revierten transfers" para el camino con saldo.
5. **Checkout desbloqueado**: eliminar el gate de `photographerNotConnected` en ambos checkouts
   (autenticado + invitado) — la venta siempre procede; el dinero queda acreditado.
   **Impacto directo sobre T-189**: su alcance principal (deshabilitar add-to-cart + tooltip) queda
   **superseded**; sobrevive solo su sub-ítem de "error tipado en checkout" como patrón general.
6. **Compliance (checklist a resolver, no bloquea el diseño técnico):** confirmar que retener fondos
   en el **balance de plataforma de Stripe** (no en banco propio) con acreditación diferida mantiene
   el modelo Connect estándar (separate charges & transfers con transfer diferido — patrón soportado
   y documentado por Stripe); revisar ventana máxima recomendada para transfers diferidos y
   obligaciones DAC7 si aplica.

## Criterio de aceptación (Definition of Done — fase diseño)
- [ ] OpenSpec change (`/opsx:propose`) con: modelo de ledger (schema + invariantes), diagrama del flujo
      de venta/retiro/reembolso nuevo, decisión sobre passthrough-para-active, y plan de migración
      (¿qué pasa con fondos ya varados de ventas pre-ledger?).
- [ ] Respuestas escritas a las decisiones 2, 3 y 4 (con el porqué).
- [ ] Checklist de compliance (punto 6) con respuestas o "pendiente de confirmar con asesor".
- [ ] Descomposición en tickets hijos de implementación (estimados), en orden ejecutable — p.ej.:
      migración ledger → webhook acredita → retiro al activarse → reembolsos → desbloqueo de checkout
      → reconciliación/alerta.
- [ ] Revisión y OK del usuario sobre el diseño ANTES de abrir tickets de implementación.

## Notas
- **Relación con T-189:** T-189 (gate de add-to-cart + tooltip) es el parche UX del modelo actual; este
  ticket cambia el modelo para que el gate no haga falta. Si T-190 se aprueba y prioriza pronto,
  **reevaluar T-189 antes de ejecutarlo** (quizá solo sobreviva su parte de error tipado). Si T-190 se
  aplaza, T-189 sigue valiendo como mitigación barata.
- **Dentro de Stripe a propósito:** descartadas Wise/PayPal/banco directo por ahora (rails nuevos, KYC
  propio, FX, y — clave — retener fondos fuera de Stripe rompe el escudo regulatorio). Ver conversación
  de origen: Stripe-con-saldo es "M", Wise es "L" + compliance.
- La implementación tocará: `stripe/webhook/route.ts` (acreditación), `cart/actions.ts` + checkout
  autenticado (quitar gate), `queries/payouts.ts`/nueva `queries/ledger.ts`, earnings UI, webhook
  `account.updated` (retiro al activarse), migración SQL. **`/code-review ultra` obligatorio** en los
  PRs de implementación (pagos).
- Familia: T-074 (gate del webhook), T-045 (errores tipados en checkout), T-144 (fuente única de
  ventas), T-164 (Accounts v1 — el diseño debe funcionar con v1, sin asumir v2).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>` (fase diseño: solo docs/OpenSpec).
2. `/opsx:propose` para generar el change (obligatorio aquí).
3. Implementar + test de regresión (en los tickets hijos; el diseño produce el change + descomposición).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
