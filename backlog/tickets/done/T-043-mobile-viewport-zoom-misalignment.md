# T-043 · Mobile: zoom-in fantasma al cargar la página descoloca la bottom nav y la toolbar de selección

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/mobile-viewport-zoom`  (tipo = fix)
- **OpenSpec change:** —  (no aplicó: fix de UI)
- **PR:** #91

> **Resuelto:** causa raíz = `Main` aplicaba `w-screen` (100vw) en dashboard/auth, que ignora la
> barra de scroll y desborda horizontalmente → zoom fantasma en mobile y barras fixed/sticky
> descolocadas. Fix: `w-screen`→`w-full` en `src/components/main.tsx` + `export const viewport` con
> `viewport-fit=cover` en `src/app/layout.tsx` (para que `env(safe-area-inset-*)` resuelva en iOS).
> Tests de regresión: `test/unit/components/main.test.tsx` (nunca emite `w-screen`) y
> `test/unit/components/root-viewport.test.ts` (viewport a 1:1 con cover).

## Requerimiento
En **mobile**, al visitar o refrescar una página hay "un poquito de zoom" en la vista. Si se hace zoom-out
completo, todo se renderiza perfecto; pero con ese zoom residual, **la barra inferior de navegación**
(bottom nav) y la **barra de modo selección** (toolbar sticky de arriba) quedan fuera de su posición — en
el eje vertical se ven descentradas. No se entiende por qué se hace ese zoom-in al cargar/refrescar.

## Criterio de aceptación (Definition of Done)
- [ ] Al cargar o refrescar cualquier página en mobile, la vista se renderiza a escala correcta (sin
      zoom-in residual) — sin tener que hacer zoom-out a mano.
- [ ] La bottom nav y la toolbar sticky de selección quedan **bien posicionadas** (centradas/ancladas
      como corresponde) desde el primer render en mobile.
- [ ] No se introduce **scroll/overflow horizontal**: ningún elemento excede `100vw` / `device-width`.
- [ ] **No** se desactiva el zoom del usuario (nada de `maximum-scale=1` / `user-scalable=no` — rompe
      accesibilidad). El fix es de layout/viewport, no de bloquear el pinch-zoom.
- [ ] Verificación **manual en dispositivo real** (iOS Safari + Android Chrome) documentada en el PR. Si la
      causa admite test (p. ej. guard de overflow o config de viewport), añadirlo; si es puramente visual,
      basta la verificación manual (CLAUDE.md permite shippear polish de UI sin test de componente).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas

**Síntoma = causa típica.** "Zoom-in al cargar que se arregla haciendo zoom-out" es el patrón clásico de
**overflow horizontal**: algún elemento es más ancho que `device-width`, el navegador móvil encoge el
viewport para encajarlo, y los elementos `fixed`/`sticky` (bottom nav, toolbar) quedan posicionados contra
ese viewport descuadrado. Al hacer zoom-out manual, el navegador "encaja" todo y se ve bien.

**Pistas concretas detectadas (investigar y descartar en este orden):**
1. **Overflow horizontal (lo más probable):** la galería usa márgenes negativos para sangrar a los bordes
   — toolbar `-mx-4 px-3` (`public-event-photo-viewer.tsx` / `event-photo-viewer.tsx`) y grid `-mx-3.5`.
   Si el negativo supera el padding del contenedor, se desborda > `100vw`. Buscar cualquier
   `-mx-*`/`w-[100vw]`/min-width/imagen sin acotar que empuje el ancho. Como **guard global** evaluar
   `overflow-x: hidden` en `html, body` (`src/app/globals.css`) y, sobre todo, **corregir el elemento que
   desborda** (no solo taparlo).
2. **No hay `export const viewport`** en el árbol de `app/`. Next App Router inyecta por defecto
   `width=device-width, initial-scale=1`, pero **sin `viewport-fit=cover`**. El layout usa
   `env(safe-area-inset-*)` (p. ej. la bottom nav: `bottom-[calc(4rem+env(safe-area-inset-bottom))]`,
   `src/app/[lang]/dashboard/talent/cart/cart-content.tsx`); **sin `viewport-fit=cover` esos insets
   resuelven a 0 en iOS**, lo que puede explicar el descuadre vertical de las barras. Añadir un
   `export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }`
   en `src/app/layout.tsx` y revisar si corrige la posición de las barras.
3. **`100vh` vs viewport dinámico:** en navegadores móviles con toolbar dinámica, `100vh` no coincide con
   el área visible. Si alguna barra fija se ancla con `100vh`/`h-screen`, considerar `100dvh`/`svh`.
   (Grep inicial no encontró `100vh`/`dvh` en layout/globals, pero revisar componentes de nav/toolbar.)

**Variables relevantes:** `--header-height: 4.5rem` (`globals.css:111/158`) — la toolbar sticky se ancla con
`top-[var(--header-height)]`. Confirmar que ese offset es correcto bajo el header real en mobile.

**Prioridad:** P2 por ser defecto **visual no bloqueante**, pero **roza P1** si se confirma que afecta a
**todos** los dispositivos (es chrome global en cada página de una app mobile-first). Subir a P1 si la
verificación en dispositivo lo confirma universal.

**Sin duplicado:** ningún ticket abierto toca el viewport/zoom. Relacionado de lejos con T-006 (bottom nav
de talento, done) y con la toolbar compartida que tocan T-038–T-042, pero el problema y el fix (viewport /
overflow global) son distintos. Independiente.

**Archivos probables:**
- `src/app/layout.tsx` (añadir `export const viewport`)
- `src/app/globals.css` (guard `overflow-x`, revisar `--header-height`, safe-area)
- `src/components/bottom-nav.tsx`, `src/components/photo-selection-toolbar.tsx` (anclajes fixed/sticky)
- Visores que usan `-mx-*` de sangrado: `events/[shareCode]/public-event-photo-viewer.tsx`,
  `dashboard/talent/events/[id]/event-photo-viewer.tsx`, y el grid en `components/photo-gallery/`.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/mobile-viewport-zoom`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige; si es puramente visual, verificación manual en
   dispositivo documentada en el PR).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del
   ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
