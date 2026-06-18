# T-008 · Galería del evento full-width en mobile (quitar/reducir padding-x)

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/event-gallery-mobile-full-width`
- **OpenSpec change:** —  (cambio de estilo acotado)
- **PR:** —

## Requerimiento
En la página de un evento, sección de la galería de fotos, en **mobile**: quitar el padding horizontal
(eje X) o dejarlo mucho más leve, para que las fotos se expandan a todo el ancho de la pantalla y se
aproveche mejor el espacio.

## Criterio de aceptación (Definition of Done)
- [ ] En mobile, la galería usa (casi) todo el ancho de pantalla — sin/con padding-x mínimo
- [ ] Las fotos no quedan recortadas ni deformadas; el grid sigue alineado
- [ ] Desktop sin cambios
- [ ] El resto del contenido de la página (no la galería) conserva su padding
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Solo el contenedor de la galería en la página del evento; no aplicar full-width a toda la página.
- Misma página/componente que T-007 (toolbar de la galería mobile) → buenos candidatos a hacerse juntos en un mismo PR si conviene.
- Solo estilos (Tailwind). Sin strings nuevos.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/event-gallery-mobile-full-width`.
2. Cambio de estilo acotado → implementar directo (sin OpenSpec).
3. Implementar.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/event-gallery-mobile-full-width`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
