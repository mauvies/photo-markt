# T-135 · Quitar la dependencia `framer-motion` (apenas usada)

- **Prioridad:** P3
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `chore/remove-framer-motion`  (tipo = chore)
- **OpenSpec change:** —  (limpieza de dependencia + reimplementación CSS de un componente)
- **PR:** —

## Requerimiento
Eliminar el paquete `framer-motion` (`^12.42.2`, `package.json`), que apenas se usa — reimplementando las
animaciones que quedan con CSS/Tailwind, para recortar el bundle del cliente.

## Estado actual (verificado en el código)
- `framer-motion` se importa en **un solo** componente real: `src/components/feedback-view.tsx`
  (`import { AnimatePresence, motion } from 'framer-motion'`) — varios `motion.div/h2/p` con entradas de
  opacity/slide + un `AnimatePresence mode="wait"` que hace swap de un `<motion.span>` (palabra que cambia).
- La otra coincidencia, `src/components/event-search-bar/EventSearchBar.tsx:305`, es **solo un comentario**
  ("...instead of framer-motion — this was the only motion usage...") — ese componente **ya** migró a CSS y
  no importa la lib.
- Por tanto `framer-motion` es una dependencia pesada (~100 KB+) al servicio de **un** componente de baja
  frecuencia (vista de feedback/agradecimiento).

## Criterio de aceptación (Definition of Done)
- [ ] `feedback-view.tsx` reproduce sus animaciones (entradas fade/slide con delays escalonados + el swap de
      la palabra del `AnimatePresence`) con **CSS/Tailwind** (transiciones/keyframes), sin `framer-motion` —
      resultado visual equivalente (o muy cercano, sin regresión perceptible).
- [ ] Se elimina `framer-motion` de `package.json` y del lockfile (`pnpm remove framer-motion`); ningún
      `import ... 'framer-motion'` queda en `src/`.
- [ ] `pnpm build` no arrastra `framer-motion`; la vista de feedback sigue funcionando en mobile y desktop.
- [ ] Sin cambios funcionales fuera de la animación; sin libs nuevas.
- [ ] test/verificación de que no queda ninguna importación de `framer-motion` en el árbol (o build verde
      que lo confirme) — falla antes / pasa después no aplica a UI de animación, pero sí a "no imports".
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Dirección:** el `AnimatePresence mode="wait"` (swap con exit antes de entrar el siguiente) es lo menos
  trivial de portar; con CSS se puede hacer con una key + `animation` de entrada y un pequeño timeout de
  cross-fade, o simplificar a un cross-fade si el exit exacto no aporta. Priorizar simplicidad sobre paridad
  pixel-perfect del easing.
- Complementa el trabajo de bundle del cluster de perf (T-123/T-125/T-126) — recorte page-scoped (solo donde
  monta `feedback-view`), no global; por eso **P3** (limpieza real pero no urgente).
- Sin strings nuevos (no cambia copy). Sin `any`. Biome. **Sin otros cambios.**

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `chore/remove-framer-motion`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
