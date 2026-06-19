# T-009 · Mejorar UX del Lightbox (header, flechas y transición de swipe en mobile)

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/lightbox-mobile-ux`
- **OpenSpec change:** —  (cambio acotado a 1 componente; si la transición crece, evaluar)
- **PR:** #74

## Requerimiento
Mejoras en el componente Lightbox (`components/photo-lightbox.tsx`) al abrir una foto desde la galería:
1. **Quitar el contador** "1/6" del centro superior (interfiere con los iconos de acción de la derecha).
2. **Header:** a la izquierda solo la **X de cerrar**, pegada al borde izquierdo respetando el padding/margen;
   a la derecha, los iconos de acción (se quedan como están).
3. **Mobile:** ocultar las flechas izquierda/derecha por defecto — el usuario navega con **swipe** (scroll en eje X).
   Opcional (nice-to-have): mostrar las flechas solo cuando el usuario toca el lado izq./der. de la pantalla.
4. **Transición fluida** al cambiar de foto: que al hacer swipe la siguiente foto vaya apareciendo pegada a la
   que sale (efecto carrusel/scroll-snap), no un cambio brusco.

## Criterio de aceptación (Definition of Done)
- [ ] No se muestra el contador "N/total"
- [ ] X de cerrar a la izquierda pegada al borde (con su padding); iconos de acción a la derecha sin cambios
- [ ] En mobile las flechas no se muestran por defecto; el swipe horizontal cambia de foto
- [ ] (Opcional) tap en lado izq./der. revela las flechas
- [ ] Transición de cambio de foto fluida (foto entrante pegada a la saliente)
- [ ] Desktop sigue navegable (flechas/teclado como corresponda)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Componente: `components/photo-lightbox.tsx`.
- **Transición/swipe:** intentar primero con CSS nativo (`scroll-snap-type: x mandatory` + `overflow-x` por slide) o con
  una librería ya instalada — NO añadir una dependencia nueva de carrusel salvo que lo nativo no alcance. (ponytail)
- Quitar el contador puede eliminar un string i18n; si añades aria-labels nuevos, a `en.json` y `es.json`.
- Mantener accesibilidad: la X y las acciones deben seguir teniendo labels accesibles.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/lightbox-mobile-ux`.
2. Cambio acotado a 1 componente → implementar directo (sin OpenSpec, salvo que la transición se ramifique).
3. Implementar.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/lightbox-mobile-ux`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
