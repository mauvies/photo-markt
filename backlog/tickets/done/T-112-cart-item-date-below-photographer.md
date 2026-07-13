# T-112 · UI: mover la fecha del evento debajo del fotógrafo en los ítems del carrito

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/cart-item-date-below-photographer`
- **OpenSpec change:** —  (un className, cambio puramente de layout)
- **PR:** #172

## Requerimiento
En cada ítem del carrito, el orden actual es: título del evento, debajo el fotógrafo, y **a la derecha**
del fotógrafo la fecha (misma línea). El usuario pide que la fecha pase a estar **debajo** del fotógrafo
en vez de al lado — quedando: título → fotógrafo → fecha, cada uno en su propia línea, y después el
precio. Única corrección de layout, sin tocar el resto de la tarjeta.

## Criterio de aceptación (Definition of Done)
- [ ] En `/dashboard/talent/cart` (`cart-content.tsx`) y `/[lang]/cart` (`guest-cart-content.tsx`), el
      bloque de metadatos de cada ítem queda apilado verticalmente: título del evento → nombre del
      fotógrafo → fecha del evento → precio (el precio ya vive en su propia fila, sin cambios ahí)
- [ ] El fotógrafo y la fecha ya no comparten fila (`flex flex-wrap items-center gap-3` pasa a layout
      vertical para esos dos campos)
- [ ] Sin regresión visual en los demás elementos de la tarjeta (imagen, botón eliminar, precio)
- [ ] test de regresión/feature que falla antes y pasa después (si aplica — cambio puramente de layout,
      puede bastar con snapshot/DOM-order test o queda documentado por qué no aplica)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Bloque a tocar: `cart-content.tsx` líneas ~294-334 (`<div className="flex flex-wrap items-center
  gap-3 ...">` que envuelve fotógrafo + fecha) y el mismo patrón en `guest-cart-content.tsx`.
- Coordinar con **T-111** (preview de imagen rota) — mismo archivo/bloque, ejecutar contiguos para
  evitar conflicto de merge; T-111 primero por ser bug funcional, T-112 después por ser puramente
  cosmético.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cart-item-date-below-photographer`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
