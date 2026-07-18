# T-152 · Actualizar Stripe SDK (major 20 → 22)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `chore/stripe-sdk-v22`  (tipo = chore)
- **OpenSpec change:** —  (probable: toca pagos; crear al ejecutar)
- **PR:** —

## Requerimiento
Follow-up de T-151 (auditoría de deps, `docs/DEPENDENCY_AUDIT.md`). El SDK `stripe` está en
`20.4.1` y el latest es `22.3.2` — **dos majors** (20→21→22). Es el bump de mayor blast-radius
(app de pagos con Stripe en vivo): pin de API version + cambios en recursos tipados a lo largo de
checkout, webhook (`payment_intent.succeeded`), Connect transfers/payouts y suscripciones.

Aplicar **un major a la vez** siguiendo cada migration guide (v21, luego v22), ajustando el código
a los breaking changes. NO bump en bloque.

## Criterio de aceptación (Definition of Done)
- [ ] `stripe` en `22.x`, con el `apiVersion` pinneado actualizado si la guía lo exige.
- [ ] Cada breaking change de las guías v21 y v22 revisado y aplicado al código.
- [ ] `/code-review ultra` sobre el diff (pagos) y findings reales resueltos.
- [ ] `pnpm build` (producción) + `pnpm typecheck` + `pnpm lint` + `pnpm test` en verde.
- [ ] Smoke-test manual: checkout de foto (talent), webhook de Stripe, Connect transfer per-order,
      alta/cancelación de suscripción de fotógrafo.
- [ ] Sin cambios de comportamiento; sin nuevos `any`.

## Notas
- Migration guides: https://github.com/stripe/stripe-node/blob/master/CHANGELOG.md
- El webhook vive en `src/app/api/stripe/webhook/route.ts`; transfers en el handler de
  `payment_intent.succeeded` (ver `ARCHITECTURE.md` §4.3).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
