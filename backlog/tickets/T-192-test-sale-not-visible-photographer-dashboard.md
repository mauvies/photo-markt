# T-192 · [DIAGNÓSTICO] Venta de prueba (@vzla_surf) invisible en el dashboard de fotógrafo

- **Prioridad:** P1
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `fix/test-sale-not-visible-dashboard`  (si el diagnóstico revela bug de código; si es config/infra, cerrar sin rama como T-172/T-185)
- **OpenSpec change:** —  (decidir tras el diagnóstico; solo si el fix toca pagos multi-archivo)
- **PR:** —

## Requerimiento
(en palabras del usuario) "Acabo de hacer una venta de prueba desde la cuenta **@vzla_surf** y no la
veo por ninguna parte en el dashboard de fotógrafos." — presumiblemente **producción** (las ventas de
prueba recientes del usuario vienen siendo en prod; confirmar al ejecutar).

## Modo: diagnóstico PRIMERO (patrón T-172/T-174)
No tocar código hasta identificar la causa. Hipótesis ordenadas por probabilidad, con su verificación:

1. **H1 — El checkout nunca se completó por el gate de Connect (relación directa con T-191/T-189).**
   @vzla_surf podría ser justamente la cuenta **US** cuyo `createExpressAccount` falla en livemode
   (T-191) → su `stripe_connect_status` ≠ `active` → **ambos checkouts rechazan** cualquier carrito
   con sus fotos (`photographerNotConnected`, `cart/actions.ts:170-177`) con el error opaco de T-189.
   La "venta" habría muerto en el intento de pago sin sesión de Stripe creada → no hay nada que
   mostrar. *Verificar:* perfil de @vzla_surf en prod (`stripe_connect_status`,
   `stripe_connect_account_id`) + ausencia total de `orders`/`guest_orders` recientes.
2. **H2 — Pago completado pero webhook caído/mal configurado en prod.** La orden queda `pending`
   (o ni existe) → invisible en Ventas/Ganancias (leen solo completadas vía `getCompletedSaleItems`,
   T-144) **y el comprador pagó sin entrega** — el sub-caso grave. *Verificar:* `orders`/`guest_orders`
   en prod con `status='pending'` reciente; entregas del endpoint webhook en el dashboard de Stripe
   (¿4xx/5xx? ¿`STRIPE_WEBHOOK_SECRET` correcto en Vercel?); logs de Vercel del route handler.
3. **H3 — La venta se registró pero a nombre de otro fotógrafo** (foto de un colaborador: `order_items.photographer_id`
   es el dueño de la foto, no el dueño del evento) o **regresión de visibilidad** del unificado
   auth+guest de T-144. *Verificar:* `order_items`/`guest_order_items` recientes en prod y a qué
   `photographer_id` apuntan; si existen y están `completed`, reproducir la lectura de
   `getCompletedSaleItems` para ese id.
4. **H4 — Compra en modo test de Stripe contra prod** (mezcla livemode/testmode: el pago "salió" en
   test pero el webhook de prod solo escucha livemode, o viceversa). *Verificar:* en Stripe, si el
   payment intent es livemode; recordar que preview de Vercel usa la BD de prod (memoria conocida) —
   una compra hecha desde un preview con keys de test escribe distinto.

## Criterio de aceptación (Definition of Done)
- [ ] Causa raíz identificada y documentada en el ticket (queries MCP prod read-only + evidencia de
      Stripe/Vercel), clasificada en: gate de checkout (H1) / webhook-infra (H2) / bug de código (H3) /
      mezcla de modos (H4).
- [ ] Si es H1: cerrar este ticket referenciando **T-191** (el fix real del onboarding US) y
      **T-190/T-189** (el gate desaparece con el modelo de saldo); sin cambio de código aquí.
- [ ] Si es H2: config del webhook reparada + verificación de que una venta nueva aparece end-to-end;
      si además hay un pago cobrado sin orden completada, backfill/reembolso manual documentado.
- [ ] Si es H3: fix de código con **test de regresión que falla antes y pasa después** (+ `/code-review`
      — es pagos) y la venta original visible tras el fix.
- [ ] Si es H4: documentar la separación test/livemode (y en su caso proteger el flujo), sin fix de prod.
- [ ] La venta de prueba (o una repetida) termina visible en Ventas y Ganancias del dashboard de
      @vzla_surf, o queda explicado y aceptado por qué no debía verse.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde (si hubo cambio de código).

## Diagnóstico (2026-07-27, MCP prod read-only)

- **@vzla_surf existe en prod** (`f4b0784f-…`), Connect **`active`** (`acct_1Txt5fEwaVkfNxhM` — NO es la
  cuenta US bloqueada de T-191, `acct_1TR6ZS…`) → **H1 descartada** (el gate no bloqueó esta venta).
- Su evento "3ra Valida Los Caracas Open" existe en prod (hoy, 35 fotos, €0.99, público) → la compra
  pasó por el sitio de prod, livemode.
- **`orders` = 0, `guest_orders` = 0, `payouts` = 0 en prod ALL-TIME** (no solo 72 h) — y staging
  tampoco tiene la venta. El webhook de prod **jamás** escribió una orden. → **H2 confirmada** al nivel
  alcanzable sin el dashboard de Stripe. H3/H4 descartadas (no hay fila en ninguna BD que malatribuir).
- ~~Primera hipótesis: doc de setup con solo 2 de 8 eventos~~ — **superseded** por la evidencia de las
  entregas (abajo), aunque el fix de la doc queda (era un gap real de la doc).
- **CAUSA RAÍZ CONFIRMADA (2026-07-28, entregas del dashboard de Stripe aportadas por el usuario):**
  cada delivery — incluidos los `account.updated` — termina en
  `{"redirect": "https://www.photomarkt.com/api/stripe/webhook", "status": "307"}`. El endpoint estaba
  registrado en el dominio **apex** (`photomarkt.com`), prod 307-redirige apex → `www`, y **Stripe no
  sigue redirects en webhooks** → **TODAS las entregas fallan** desde siempre. Explica el 0-todo
  all-time (ventas, suscripciones/T-172, transfers). El `active` de @vzla_surf no vino del webhook:
  lo curó `reconcileAndPersistConnectStatus` (live-check de T-074) al visitar el dashboard. La URL
  apex estaba documentada en el propio header del handler ("In production: https://photomarkt.com/...").
- **Evidencia adicional de la venta:** `checkout.session.completed` livemode `cs_live_a107pz…`,
  `payment_status: paid`, 99¢ (USD por adaptive pricing), guest checkout
  (comprador mauricio.viera6@gmail.com), foto `1a725f54-…` de @vzla_surf, PI `pi_3TxtC1IXonFCVhXo…` —
  **pago cobrado, orden nunca creada** (el sub-caso grave de H2: comprador pagó sin entrega; se
  recupera con el resend post-fix, handler idempotente).
- **Fix de código en este PR:** la doc de setup ahora lista los 8 eventos + test source-level
  (`stripe-webhook-setup-doc.test.ts`) que obliga a que la sección de setup cubra cada `case` del
  switch (rojo antes / verde después, verificado con stash).
- **Pendiente del usuario (yo no tengo acceso al dashboard de Stripe):**
  1. ~~Eventos + secret~~ ✅ verificado por el usuario (8 eventos, secret coincide).
  2. **Corregir la URL del endpoint** (livemode) a `https://www.photomarkt.com/api/stripe/webhook`
     (con `www` — editar la URL conserva el signing secret).
  3. **Re-enviar** (`Resend`) los eventos de la venta: `checkout.session.completed`
     (`evt_1TxtC7IXonFCVhXos3j5QN5F`) y luego `payment_intent.succeeded`
     (`evt_3TxtC1IXonFCVhXo1EKbpWEp`) — deben responder **200**; el handler creará la orden
     retroactivamente y disparará el transfer a @vzla_surf.
  4. Verificación end-to-end: la venta visible en Ventas/Ganancias (query de confirmación en prod + UI).

## Notas
- **Prod refs Supabase:** producción = `yzdlueeeizdqwuicydbr` (staging `rozglsxdolgouslaojtm` — no
  confundir; diagnóstico SIEMPRE contra prod, memoria `supabase-project-refs`).
- Queries de arranque (read-only): perfil por username `vzla_surf` (id + `stripe_connect_status`);
  `orders` y `guest_orders` de las últimas 48 h con su `status`; `order_items`/`guest_order_items`
  por ese `photographer_id`.
- **No confundir con T-144** (ya archivado): aquel unificó la lectura auth+guest en Ventas — si H3
  apunta ahí, es una regresión o un caso no cubierto (p. ej. moneda/estado), no re-hacer T-144.
- Familia: T-191 (Connect US, posiblemente la misma cuenta), T-189 (error opaco del gate en checkout),
  T-190 (diseño que elimina el gate), T-172 (patrón "no-es-bug: nunca hubo checkout"), T-144 (fuente
  única de ventas).
- Contexto operativo conocido: `migrate.yml` de prod bloqueado por billing (irrelevante aquí — no hay
  migración pendiente de esta superficie); sync de Inngest en prod tuvo drift histórico (irrelevante —
  las ventas no pasan por Inngest; el path es webhook de Stripe síncrono).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/test-sale-not-visible-dashboard` (solo si hay fix de código).
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
