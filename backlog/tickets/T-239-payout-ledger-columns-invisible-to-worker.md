# T-239 · El worker de payouts no ve las columnas del ledger: `transfer_batch_id does not exist` en una BD que **sí** está migrada

- **Prioridad:** P0
- **Estado:** todo
- **Riesgo:** alto  (pagos · BD/migraciones → `/work-next` entra en plan mode y espera aprobación antes de escribir, y corre `/code-review`)
- **Blockers:** ninguno
- **Rama:** `fix/payout-ledger-columns-invisible`  (tipo = fix)
- **OpenSpec change:** **sí** — toca el pipeline de migraciones (CI) y la ruta de dinero
- **PR:** —
- **Dep:** ninguna. **Ejecutar ANTES de T-236**: ese barrido recupera justo las órdenes que este defecto está dejando sin fila, así que arreglar la causa primero evita que el barrido corra contra un blanco móvil.

## Requerimiento

Reportado por el usuario con el log de Inngest (2026-08-06 15:15:30, hora local):

```
Error: Failed to list stale processing batches: column payouts.transfer_batch_id does not exist
  stepId: 'recover-stale-batches'
```

`recover-stale-batches` es el primer paso de `retryPendingPayouts`
(`src/lib/inngest/functions/retry-pending-payouts.ts:166` → `listStaleProcessingBatches`,
`queries/payouts.ts:408`). La columna la crea `20260807000000_add_payout_ledger.sql:26`
(`add column if not exists transfer_batch_id uuid`).

**Lo que NO es (comprobado, para que nadie lo re-diagnostique):**

- **No es que la migración no se haya aplicado a producción.** `gh run view 31103295818 --log` muestra
  el run de `migrate.yml` de hoy 12:53:47 UTC: `Applying 20260807000000_add_payout_ledger… ✓`. El run
  terminó en **success**, y `20260806000000_add_failed_to_upload_status` figura como *already applied*.
- **No es el caso conocido de «editar una migración ya aplicada no la re-ejecuta»**: el fichero se
  aplicó entero por primera vez en ese run, con el `NOTICE` esperado del `drop constraint if exists`.
- **El error es posterior a la migración**: 15:15:30 CEST = 13:15:30 UTC, ~22 min **después** de que la
  columna existiera en prod.

**Las dos hipótesis que quedan** (hay que decidir cuál antes de escribir código):

1. **El entorno que ejecuta ese cron no es el que migra `migrate.yml`.** `migrate.yml:18` apunta
   **solo** a prod (`postgres.yzdlueeeizdqwuicydbr@aws-0-…`); **no existe ningún job de migraciones
   para staging** (`rozglsxdolgouslaojtm`). Si el deployment registrado como app de Inngest es el de
   staging, su BD nunca recibió `20260807000000` — y ya hay precedente documentado de staging
   quedándose atrás en columnas de dinero (`bundle_all_photos_cents`).
2. **La caché de esquema de PostgREST está rancia.** Todas estas queries van por supabase-js →
   PostgREST, no por SQL directo, y `migrate.yml` aplica el DDL por `psql` contra el **pooler**. Si el
   `NOTIFY pgrst, 'reload schema'` no llega, PostgREST sigue sirviendo el esquema viejo y devuelve
   exactamente este `column … does not exist` contra una tabla que sí tiene la columna. Encaja con la
   ventana de 22 minutos mejor que ninguna otra explicación.

Comprobación que decide entre las dos, en un minuto: consultar
`information_schema.columns where table_name='payouts'` en **ambos** proyectos vía MCP.

## Por qué es P0 (no es solo un cron ruidoso)

`retryPendingPayouts` es la **única** vía de recuperación del dinero retenido: mientras tire, ningún
hold `transfer_failed` / `connect_inactive` / `below_minimum` se paga jamás. Y es peor aguas arriba —
en el webhook, `openPayoutRow` está envuelto en `try/catch` con **`continue`**
(`api/stripe/webhook/route.ts:211-216`), decisión correcta (un fallo del ledger no debe reventar el
webhook y provocar que Stripe reentregue un pago que quizá ya hicimos), pero cuyo efecto en este
escenario es que **cada venta en ese entorno se salta la transferencia del fotógrafo dejando solo un
`console.error`**: sin transferencia y sin fila de deuda. Es exactamente el agujero que T-216 cerró,
reabierto por deriva de entorno en vez de por código.

## Criterio de aceptación (Definition of Done)

- [ ] Determinado y escrito en el PR **cuál de las dos hipótesis** era, con la evidencia (columnas
      reales en prod y en staging, y qué proyecto usa la app de Inngest que emitió el log)
- [ ] La causa raíz queda cerrada de forma que no dependa de acordarse:
      - si es (1): `migrate.yml` cubre staging además de prod, o queda escrito por qué staging no se
        migra y cómo se evita que ejecute jobs contra un esquema viejo
      - si es (2): el job de migraciones emite `NOTIFY pgrst, 'reload schema'` (o equivalente) al
        terminar, de modo que ningún deploy vuelva a quedar sirviendo un esquema rancio
- [ ] `retryPendingPayouts` vuelve a completar sus runs (verificado en el dashboard de Inngest)
- [ ] Cuantificadas las ventas afectadas: órdenes completadas en la ventana del fallo cuyo fotógrafo no
      tiene fila en `payouts`. Si las hay, quedan enumeradas en el PR y se **paga o se abre su hold**
      (esa recuperación es T-236 si conviene separarla, pero el número NO puede quedar sin medir)
- [ ] Una salida de esta clase deja de ser invisible: el `console.error` de `openPayoutRow` sube a
      Sentry (o equivalente), porque hoy una venta sin payout no alerta a nadie
- [ ] Test de regresión que falla antes y pasa después (a nivel del pipeline/consulta, según la causa)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Familia: **T-216** (introdujo el ledger y este cron) · **T-236** (barrido de órdenes sin payout — el que
recupera lo que este defecto dejó tirado; ejecutar después) · **T-215** (`doing`, clawback).

Ojo con el `stepId`: `retry-pending-payouts` tiene **dos** triggers (`cron: '10,40'` **y**
`event: 'payouts.retry-requested'`, `retry-pending-payouts.ts:122`), así que un error en el minuto :15
es coherente con un run disparado por evento desde el webhook — no hace falta buscar una tercera
explicación para el timestamp.

Memoria relevante del proyecto: las migraciones las aplica `migrate.yml` en merge a `main` (no Vercel),
y ese workflow ha estado rojo por presupuesto de Actions en el pasado; hoy está verde, así que **esta
vez no es eso**.

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
