# T-101 · [Carrito/Perf] Quitar el `router.refresh()` del add-to-cart (doble refresh en hot path)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/add-to-cart-double-refresh`  (tipo = fix)
- **OpenSpec change:** —  (un componente)
- **PR:** —
- **Origen:** auditoría de caching T-083 (`docs/CACHING_AUDIT.md`, **F-09**, ítem #22 del plan)

## Requerimiento
`add-to-cart-button.tsx:59-61` (add) y `:83-85` (remove) llaman **ambos**
`queryClient.invalidateQueries(['cart-count'])` **y** `router.refresh()` por click. La invalidación
ya actualiza el badge; el `router.refresh()` re-renderiza todo el subtree de server components en
cada add/remove — un round-trip RSC completo en un hot path. El flujo optimista paralelo
(`use-optimistic-photos-in-cart.ts`) deliberadamente NO llama `router.refresh()` — las dos
implementaciones de add-to-cart son inconsistentes y esta es la pesada.

## Criterio de aceptación (Definition of Done)
- [ ] **Cobertura previa:** tests de caracterización del comportamiento visible actual del botón
      (add → badge sube, remove → baja, estado del botón cambia) en verde **antes** del cambio
- [ ] `router.refresh()` removido de los handlers de add/remove del botón
- [ ] Verificar que nada del subtree dependía del refresh para reflejar el carrito (el badge va
      por `['cart-count']`; el estado "en carrito" del botón por su propio estado/props) — si algo
      dependía, resolverlo con invalidación de RQ, no con refresh global
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Alinear con el patrón de `use-optimistic-photos-in-cart.ts` (optimista + reconcile) si el
  refactor es barato; si no, el mínimo es quitar el refresh.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/add-to-cart-double-refresh`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
