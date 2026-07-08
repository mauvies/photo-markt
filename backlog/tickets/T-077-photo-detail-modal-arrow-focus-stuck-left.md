# T-077 · Bug: en el photo-detail-modal, al navegar con las flechas siempre queda el focus/selected en la flecha izquierda

- **Prioridad:** P2
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `fix/photo-detail-modal-arrow-focus-stuck-left`  (tipo = fix)
- **OpenSpec change:** —  (fix aislado de UI/a11y, implementar directo)
- **PR:** —

## Requerimiento
En el **modal de detalle de foto a dos paneles** (T-066, PR #128) — el que se usa para ver la imagen en detalle en **eventos públicos de pago** (foto con marca de agua) — al pasar de foto con las flechas prev/next, **presione la que presione (izquierda o derecha), siempre la flecha izquierda muestra el estado de focus/selected**. Nunca la derecha. Debería corregirse: pulsar una flecha no debe dejar un anillo de focus/estado "seleccionado" persistente en la flecha equivocada (ni en ninguna, con ratón); y la navegación por teclado debe seguir siendo coherente y accesible.

## Criterio de aceptación (Definition of Done)
- [ ] Al pulsar la flecha **derecha**, el efecto visual de focus/selected **no** aparece en la flecha izquierda
- [ ] Con navegación por **ratón/touch**, no queda un anillo de focus persistente en ninguna de las flechas tras avanzar/retroceder
- [ ] La **accesibilidad por teclado** se conserva (Tab/Enter/flechas del teclado siguen funcionando y el focus visible aparece donde corresponde al navegar con teclado)
- [ ] El fix aplica en las 3 superficies donde se monta el modal de compra (evento público, evento en dashboard de talento, resultados de búsqueda facial) — todas usan el `PhotoCarousel` compartido
- [ ] Sin regresión en el lightbox de eventos gratis / fotógrafo (comparten `PhotoCarousel`)
- [ ] test de regresión/feature apropiado (foco tras onNext/onPrevious)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Componente:** `src/components/photo-carousel.tsx` — botones prev (`aria-label="Previous photo"`, `ArrowLeft`, L124-136) y next (`aria-label="Next photo"`, `ArrowLeft rotate-180`, L177-189), dentro del marco Shadcn/Radix `Dialog` de `src/components/photo-detail-modal.tsx`.
- **Causas probables a investigar (capture-only):**
  - Tras `onNext()`/`onPrevious()` el componente re-renderiza con el nuevo `currentIndex` y **el focus se reasigna al primer focusable** del subárbol (la flecha izquierda), o el `Dialog` de Radix reubica el focus. Verificar si hay un remonte/reset de focus.
  - Falta de gestión de **`:focus-visible`** vs `:focus`: el anillo/estilo persiste tras un click de ratón. Considerar solo mostrar el estilo de focus en navegación por teclado (`focus-visible`) y/o quitar el focus del botón tras el click, sin romper a11y.
  - Los dos botones son visualmente el mismo icono (`ArrowLeft`, uno con `rotate-180`); confirmar que no hay un solo estado compartido/duplicado de "selected" mal atribuido.
- **Elegir el fix mínimo que preserve la accesibilidad** — no eliminar el focus por teclado; el objetivo es que el *estado visual* no quede pegado en la flecha equivocada al navegar con puntero.
- **Origen:** introducido con el `PhotoCarousel` compartido de T-066 (PR #128). No bloquea la verificación pendiente en dispositivos reales de ese ticket, pero conviene arreglarlo antes de pulir del todo el modal.
- **Prioridad P2:** glitch de UI/a11y, cosmético; molesto pero no rompe la navegación.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/photo-detail-modal-arrow-focus-stuck-left`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
