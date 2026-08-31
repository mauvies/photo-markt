# T-255 · Nadie reconcilia: un pedido `completed` sin filas en `payouts` no lo detecta nada

- **Prioridad:** P1
- **Estado:** done
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `feat/reconcile-orders-without-payouts`  (tipo = feat)
- **OpenSpec change:** —
- **PR:** #325

## Requerimiento

El 2026-07-28 se completó una venta de €0,99 con **cero filas en `payouts`**, y nadie se enteró
durante **trece días**. T-249 (PR #306) y T-252 (PR #307) atacaron las *causas* — alertan las siete
salidas que pueden completar un pedido sin pagar, y hacen que ambos webhooks disparen las
transferencias. Pero las dos alertan **en el momento en que el código pasa por ahí**.

Nada mira el **estado resultante**. Si aparece una octava salida, o el fallo ocurre fuera de esas
rutas, el síntoma —un pedido cobrado sin deuda registrada— sigue siendo invisible.

Hace falta una reconciliación periódica que consulte el hecho, no el camino:

> pedidos `completed` con `total_amount_cents > 0`, de más de N horas, sin **ninguna** fila en
> `payouts` para ese `order_id`.

Y lo mismo para `guest_orders`.

## Criterio de aceptación (Definition of Done)

- [x] Una función Inngest con cron detecta pedidos completados sin filas en `payouts` y alerta vía
      `reportMoneyIncident`
- [x] **Cuarto slot de cron**, sin solaparse con los tres existentes (`0,30` limpieza de storage ·
      `15,45` reconciliación de indexado · `10,40` reintentos de payouts) — regla de CLAUDE.md
- [x] Cubre `orders` **y** `guest_orders`
- [x] Ventana de gracia (N horas) para no alertar de pedidos cuya entrega aún está en vuelo
- [x] No re-alerta del mismo pedido en cada pasada
- [x] Sin PII del comprador — solo ids e importes
- [x] Test de regresión: un pedido `completed` sin payouts dispara el incidente; uno con payouts, no
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Distinto de **T-254**, que alerta de un hold que **existe** y no drena. Este alerta de la deuda que
**nunca se abrió**. Los dos tocan la misma superficie de alertas de payouts → ejecutar contiguos.

Reutilizar `reportMoneyIncident` (`src/lib/observability/report-money-incident.ts`); el `kind`
`needs-reconciliation` ya existe en el tipo y hoy no tiene productor (lo comparte con T-254 —
acordar cuál lo usa, o añadir uno nuevo).

Relación: **T-249** (PR #306, las alertas) · **T-252** (PR #307, ambos handlers disparan) ·
**T-216** (el ledger) · **T-254** (holds atascados).
