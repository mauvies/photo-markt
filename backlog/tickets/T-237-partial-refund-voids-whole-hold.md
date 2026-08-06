# T-237 · Un reembolso parcial anula el hold entero y deja al fotógrafo sin la parte no reembolsada

- **Prioridad:** P2
- **Estado:** todo
- **Riesgo:** alto  (pagos)
- **Blockers:** ninguno
- **Rama:** `fix/partial-refund-payout-hold`  (tipo = fix)
- **OpenSpec change:** — (decidir al ejecutar: si se hace dentro de T-215, lo cubre su change)
- **PR:** —
- **Dep:** **ejecutar junto a T-215**, que ya tiene el reembolso parcial en su DoD para el camino gemelo (revertir una transferencia **ya emitida**)

## Requerimiento

T-216 añadió `voidHoldsForCharge` (`src/database/queries/payouts.ts`), que al recibir `charge.refunded`
anula los payouts `pending` de ese charge para que el worker de reintentos no envíe el dinero de un
comprador reembolsado. Correcto en el caso total — pero **`charge.refunded` también se dispara en
reembolsos parciales**, y la query anula el hold **entero** sin mirar el importe:

```
.eq('stripe_charge_id', stripeChargeId).eq('status', 'pending')  → status = 'cancelled'
```

Así que si se reembolsan 5 € de una venta de 20 €, el fotógrafo pierde **su neto sobre los 15 €
restantes**, no sobre los 5 reembolsados. Y lo pierde de forma **irrecuperable por diseño**: el índice
único parcial `(stripe_charge_id, photographer_id)` impide crear una fila de reemplazo para ese charge,
así que no hay forma de re-abrir el hold por la diferencia sin tocar el esquema.

Es un defecto **introducido por T-216** y documentado a propósito en el docstring de la función (se
eligió la dirección recuperable: no enviar dinero es reversible, enviarlo no), pero documentado ≠
resuelto.

## Criterio de aceptación (Definition of Done)

- [ ] `charge.refunded` distingue reembolso **total** de **parcial** (`charge.amount_refunded` vs
      `charge.amount`) en vez de tratarlos igual
- [ ] Reembolso **total** → comportamiento actual (anular el hold entero)
- [ ] Reembolso **parcial** → el fotógrafo conserva su neto sobre la parte **no** reembolsada: reducir el
      `amount_cents` del hold en la proporción correspondiente en vez de anularlo, **o** documentar por
      qué no y marcarlo para revisión manual (mismo criterio que ya tiene T-215 para las reversiones)
- [ ] La reducción no puede dejar `amount_cents <= 0` (el CHECK de la tabla lo rechaza): si la parte
      restante no llega a un importe válido, anular y registrar el motivo
- [ ] Decidir y documentar qué pasa con un hold `processing` en un reembolso parcial (hoy se deja en paz
      a propósito: puede tener una transferencia en vuelo, y revertirla es T-215)
- [ ] Revisar de paso la incoherencia **pre-existente** que este ticket destapa: `charge.refunded` marca
      la orden entera como `refunded` —revocando **todo** el acceso de descarga del comprador— también en
      un reembolso parcial. O es correcto y se documenta, o es su propio bug
- [ ] Test de integración: reembolso parcial → el hold sobrevive con el importe reducido
- [ ] Test de integración: reembolso total → el hold se anula (no debe regresionar)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

**Solapa con T-215 y por eso va con él.** El DoD de T-215 ya pide «reembolso parcial revierte
proporcionalmente, o se documenta por qué no y se marca para revisión manual» — pero para el camino de
**revertir una transferencia ya emitida** (`transfers.createReversal`), que es código distinto. Este
ticket es el camino gemelo sobre dinero **aún no enviado** (`voidHoldsForCharge`), que no existía cuando
se escribió T-215. Al ejecutarlos juntos la decisión de producto («¿se reparte proporcionalmente?») se
toma **una vez** para ambos lados; hacerlos por separado se arriesga a que discrepen, que es justo el
tipo de divergencia que T-216 encontró entre sus dos escritores.

Si quien ejecute T-215 prefiere absorber esto en su alcance, **archivar este ticket apuntando a aquel PR
en vez de abrir una rama aparte** — no duplicar el trabajo.

Contexto: `voidHoldsForCharge` en `src/database/queries/payouts.ts` (con el caveat ya escrito en su
docstring) y el `case 'charge.refunded'` de `src/app/api/stripe/webhook/route.ts`. Ver también
`ARCHITECTURE.md` §4.3 y la capability `photographer-payout-ledger`, cuyo requirement «A refunded charge
does not pay out» habrá que ampliar con el caso parcial.

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
