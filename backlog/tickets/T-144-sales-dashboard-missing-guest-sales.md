# T-144 · Bug crítico: las ventas de invitado no aparecen en el dashboard de ventas del fotógrafo

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/sales-dashboard-missing-guest-sales`  (tipo = fix)
- **OpenSpec change:** —  (bug de reporting en la capa de queries; sin migración salvo que se opte por una vista SQL — decidir al ejecutar)
- **PR:** —

## Requerimiento (en palabras del usuario)
En **Ventas** del dashboard de fotógrafos (`/dashboard/photographer/sales`) **no aparece ninguna venta**
aunque sí se han realizado ventas — e incluso esas ventas **sí se ven reflejadas en el tab de Ganancias**.

## Causa raíz (verificada en código)
El dashboard de ventas es una página con dos tabs (`SalesContent` + `EarningsContent`) que leen de **fuentes
distintas**:

- **Todas las queries de Ventas** (`src/database/queries/sales.ts`: `getSalesSummary`, `getRecentSales`,
  `getSalesOverTime`, `getTopSellingEvents`) leen **solo de `order_items`** con `orders.status='completed'`
  (`.eq('photographer_id', …).eq('orders.status','completed')`). Lo mismo la **lista** de Ganancias
  (`getPhotographerEarnings` en `earnings.ts:112-146`).
- **El resumen de Ganancias** (`getEarningsSummary` → `getTotalPaidOut` / `getTotalPendingPayouts`,
  `earnings.ts:66-92`) lee de la tabla **`payouts`**.

Las **compras de invitado** (guest checkout) se registran en un camino **separado**: el webhook de Stripe
(`src/app/api/stripe/webhook/route.ts:255-324`) inserta en **`guest_orders` / `guest_order_items`** (vía
`addGuestOrderItems`) y **crea los transfers → filas en `payouts`** (vía `createTransfersForOrderItems` →
`createPayoutFromTransfer`). **Nunca escribe en `order_items`.**

⇒ Resultado: una venta de invitado **existe en `guest_order_items` + `payouts`** pero **no en `order_items`**.
Por eso el **resumen de Ganancias** (que lee `payouts`) la refleja, mientras que **Ventas** (que solo lee
`order_items`) aparece **vacío**. El dinero fluye correctamente (los payouts se crean); el bug es **de
visibilidad/reporting**, no de pérdida de dinero.

## Alcance / enfoque sugerido (a validar al ejecutar)
- **Fix principal:** hacer que las queries de ventas (y la lista de ganancias) incluyan las órdenes de
  invitado — unir `order_items` **∪** `guest_order_items` (o exponer una vista/RPC combinada en
  `/src/database/queries/`). Cuidar el email del comprador: los invitados tienen su email en `guest_orders`
  (no vía `get_user_emails_batch`, que es para usuarios autenticados).
- **Hipótesis secundaria a descartar (mismo síntoma):** una orden **autenticada** cuyo `orders.status`
  quedara en `pending` (no `completed`) también saldría de Ventas mientras el payout —escrito en
  `payment_intent.succeeded` independientemente del status— aparecería en el resumen de Ganancias.
  Confirmar contra los datos reales del usuario cuál de los dos caminos generó la venta antes de cerrar
  (probablemente invitado, pero verificar).
- **Consistencia:** la **lista** de Ganancias (`getPhotographerEarnings`) tiene el **mismo hueco** (solo
  `order_items`) — si se muestra en el tab, arreglarla en el mismo cambio para que Ventas y Ganancias
  cuadren.

## Criterio de aceptación (Definition of Done)
- [ ] Una venta realizada por **checkout de invitado** aparece en el tab de **Ventas** (resumen,
      ventas recientes, ventas por fecha, top eventos) del fotógrafo dueño de la foto.
- [ ] Los totales de **Ventas** y de **Ganancias** cuadran para el mismo fotógrafo (no que uno muestre
      dinero y el otro cero).
- [ ] La lista de Ganancias (si se renderiza) también incluye las ventas de invitado.
- [ ] El email/identificación del comprador invitado se resuelve desde `guest_orders`, sin romper el de
      compradores autenticados.
- [ ] Toda la lógica nueva vive en `/src/database/queries/` (no inline en actions/componentes).
- [ ] **Test de regresión** que falla antes y pasa después: sembrar una venta de invitado
      (`guest_orders` + `guest_order_items` + payout) y afirmar que aparece en `getSalesSummary` /
      `getRecentSales` (y que Ventas y Ganancias-resumen coinciden). Idealmente también un caso de venta
      autenticada para asegurar que no se rompe ni se duplica.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde. `/code-review` sobre el diff (toca reporting de
      pagos).

## Notas
- Página: `src/app/[lang]/dashboard/photographer/sales/` (`sales-content.tsx` + `earnings-content.tsx` bajo
  un `<Tabs>`; acciones en `sales/actions.ts` y `earnings/actions.ts`).
- No solapa con ningún ticket del backlog (T-116 era el fallback de fotos borradas en el historial de
  órdenes; T-117 la limpieza de `cart_items` huérfanos — ninguno toca la agregación de ventas de invitado).
- Hallazgo derivado del state report 2026-07-17 (`STATE-REPORT-2026-07-17.md`), que ya documentó el camino
  de pago de invitado separado (`guest_order_items` + payouts).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/sales-dashboard-missing-guest-sales`.
2. **Primero** reproducir con un test de caracterización (venta de invitado → Ventas vacío) que quede rojo.
3. Implementar la unión `order_items` ∪ `guest_order_items` en la capa de queries.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. `/code-review` sobre el diff (reporting de pagos) y arreglar findings reales.
6. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
7. `git push -u origin <rama>`.
8. `gh pr create --draft` apuntando a `main`.
9. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
