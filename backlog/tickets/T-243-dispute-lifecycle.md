# T-243 · Ciclo de vida de disputas: chargebacks, inquiries y su escalado

- **Prioridad:** P1
- **Estado:** doing — **absorbido en T-215** (2026-08-10): misma rama, mismo PR. No abrir rama aparte.
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `feat/dispute-lifecycle`  (tipo = feat)
- **OpenSpec change:** **sí** — es una máquina de estados, y hay que dibujarla antes de escribirla
- **PR:** —
- **Dep:** después de T-215 (reutiliza su kernel de clawback)

## Requerimiento

El webhook maneja 8 eventos de Stripe y **ninguno es de disputa**. Al perder un chargeback: Stripe
retira el importe de la cuenta de plataforma, cobra ~15 € de tasa, la orden sigue en `completed` —o
sea que **el comprador conserva el acceso indefinidamente**—, el fotógrafo conserva su transferencia, y
no queda ni log, ni alerta, ni fila. Una foto de 5 € cuesta ~20 € y el archivo se va igual.

Aplica **aunque no se ofrezcan reembolsos**: la disputa la fuerza el comprador por su banco, sin pasar
por los términos. Es justo el camino de quien quiere descargar sin pagar.

**Salió de T-215 (2026-08-07)** porque es donde está la complejidad real. Tres revisiones seguidas
encontraron fail-opens aquí, y casi todos vienen de tratar la disputa como un par de eventos sueltos en
vez de como un ciclo de vida. Lo que hay que **diseñar antes de codificar**:

1. **Inquiry ≠ chargeback.** Los estados `warning_*` llegan por el **mismo** `charge.dispute.created`,
   pero el banco aún no ha retirado dinero y muchas se cierran solas. Decisión ya tomada: congelar el
   pago, **no** tocar el acceso.
2. **El escalado no es un evento nuevo.** Una inquiry que se convierte en chargeback real se anuncia
   con **`charge.dispute.updated`**, que hoy ni se maneja ni está suscrito — así que el acceso nunca se
   revoca en ese camino y el comprador descarga durante todo el chargeback (semanas).
3. **Los cierres son cuatro, no dos:** `lost`, `won`, `warning_closed` y `prevented`.
4. **Congelar y reembolsar se cruzan.** Reembolsar *para* zanjar una disputa es el camino normal;
   descongelar al ganarla no puede devolver a pagable un hold cuya venta ya se reembolsó.
5. **Congelar un hold mueve el saldo del fotógrafo.** Un hold `cancelled` sale de
   `getTotalPendingPayouts`, así que congelarlo **sube** su saldo retirable — lo contrario de lo que
   congelar significa.
6. **La tasa de disputa la absorbe la plataforma** (decisión tomada): el fotógrafo no controla ni el
   fraude ni el proceso.

## Criterio de aceptación (Definition of Done)

- [ ] Máquina de estados dibujada y aprobada **antes** de implementar: qué mueve el acceso, qué mueve
      el dinero, y qué hace cada cruce con un reembolso
- [ ] `charge.dispute.created`, `.updated` y `.closed` manejados y **suscritos** en el dashboard
- [ ] Una inquiry congela el pago y no toca el acceso; su escalado sí lo revoca
- [ ] Los cuatro estados de cierre tratados explícitamente
- [ ] Escribir el estado de la orden **nunca promueve** una orden que no estaba `completed`
- [ ] Un fallo de lectura contra Stripe nunca **restaura** acceso ni paga un hold: al no poder decidir,
      no se toca nada
- [ ] Congelar/descongelar no altera el saldo retirable mostrado al fotógrafo
- [ ] Tests de integración por cada cruce, no solo por cada evento

## Notas

⚠️ **La lección de las tres revisiones de T-215:** los fallos no estaban en la aritmética sino en los
caminos de error — leer Stripe y no poder, recibir eventos fuera de orden, y suponer que «restaurar»
es lo contrario de «revocar». Cualquier default que se elija ante un fallo de lectura debe comprobarse
en **las dos** direcciones (acceso y dinero) y en **cada** llamador.

Contexto: los tipos instalados (`stripe@22.3.2`) declaran el union de `Dispute.status` y documentan
`Dispute.amount` como el importe **disputado**, no el del cargo. `src/lib/payouts/clawback.ts` ya tiene
los predicados (`isChargeback`, `isDisputeOpen`, `isDisputeClosed`).
