# T-012 · Mostrar fotos compradas sin marca de agua en la página de pedidos

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/orders-unwatermarked-purchased`
- **OpenSpec change:** —  (acotado; si toca varias capas de auth, evaluar propose)
- **PR:** —

## Requerimiento
En la página de pedidos, al expandir un pedido se ven las fotos compradas **con marca de agua**. Como ya
fueron compradas, deben mostrarse **sin marca de agua** (imagen original), aunque sea como thumbnail/preview.

## Criterio de aceptación (Definition of Done)
- [ ] En el detalle del pedido, las fotos compradas se muestran sin watermark (versión original)
- [ ] Aunque sea miniatura/preview, la fuente es la imagen original, no la servida por `/api/watermark`
- [ ] El acceso se autoriza server-side: solo el comprador del pedido ve la original (verificar ownership del order_item)
- [ ] Se usa **signed URL de corta duración** — nunca se expone el storage path original públicamente
- [ ] Fotos NO compradas / otros contextos siguen con watermark
- [ ] Test: el dueño del pedido obtiene URL sin watermark; un usuario ajeno NO
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Convención del repo: fotos compradas se acceden vía signed URLs de corta vida (ver CLAUDE.md → Image Handling).
- Revisar la query de pedidos en `/database/queries/orders.ts` y cómo arma la URL de cada foto comprada hoy.
- **Seguridad:** la decisión de servir sin watermark debe basarse en una compra confirmada (order `completed`),
  validada en el servidor, no en un flag del cliente.
- Relacionado con T-010 (acciones sobre fotos compradas): no romper ese flujo.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/orders-unwatermarked-purchased`.
2. Acotado → implementar directo (si la autorización se ramifica, `/opsx:propose`).
3. Implementar + test de ownership (dueño sí / ajeno no).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/orders-unwatermarked-purchased`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
