# T-006 · Mover el carrito a la bottom nav del dashboard de talento (mobile)

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/talent-mobile-cart-tab`
- **OpenSpec change:** —  (cambio de UI acotado)
- **PR:** —

## Requerimiento
En el dashboard de talento en **mobile**, el header (logo izq. + carrito der.) ocupa espacio que podría
usar el contenido principal. La bottom nav solo tiene 4 tabs. Añadir el **carrito como 5º tab** en la
bottom nav y quitar/ocultar el header en mobile para liberar ese espacio vertical.
Solo afecta a mobile; desktop se mantiene igual.

## Criterio de aceptación (Definition of Done)
- [ ] En mobile, el carrito aparece como tab en la bottom nav del dashboard de talento
- [ ] El header del dashboard de talento se oculta en mobile (libera espacio para el contenido)
- [ ] El badge/contador de items del carrito se conserva en el nuevo tab
- [ ] Desktop sin cambios (header y carrito como están)
- [ ] El tab navega a la misma ruta de carrito que el icono actual
- [ ] Label del tab "Carrito"/"Cart" en `en.json` y `es.json` (si la bottom nav usa labels)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Buscar la bottom nav del dashboard de talento y el header de ese layout.
- Solo mobile: usar breakpoints de Tailwind, no romper desktop.
- Interacción: T-003 (borde del avatar del header) — confirmar si el avatar vive en este header de talento;
  si se oculta en mobile, el borde solo aplicaría en desktop. No es blocker, solo coordinar si se hacen juntos.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/talent-mobile-cart-tab`.
2. Cambio de UI acotado → implementar directo (sin OpenSpec).
3. Implementar.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/talent-mobile-cart-tab`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
