# T-175 · Posición del toast en mobile según estado de auth

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/mobile-toast-position-by-auth`  (tipo = feat | fix | chore | refactor)
- **OpenSpec change:** —  (UI aislada, 1 archivo — no aplica)
- **PR:** #236

## Requerimiento
En mobile, los toasts hoy salen **arriba para todos**. Eso es correcto para usuarios
**autenticados** (un toast abajo taparía el bottom-nav y su acción "Ver carrito"), pero está
mal para **invitados**, que no tienen bottom-nav — para ellos, abajo es la mejor posición.

Refina la decisión previa (que puso todos los toasts arriba por el bottom-nav), **no la revierte**:

- Mobile, **invitado**: toasts desde **abajo**.
- Mobile, **autenticado**: toasts desde **arriba** (comportamiento actual, sin cambio — el bottom-nav nunca se tapa).
- Desktop: sin cambios (`bottom-right`).

## Criterio de aceptación (Definition of Done)
- [ ] Invitado en mobile ve los toasts desde abajo.
- [ ] Autenticado en mobile ve los toasts desde arriba; el bottom-nav nunca se tapa.
- [ ] Desktop sin cambios.
- [ ] La posición reacciona correctamente si el estado de auth cambia dentro de la sesión (p. ej. tras login).
- [ ] Sin `any`; formato Biome.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Sistema de toast existente: `src/components/ui/sonner.tsx` (wrapper de `sonner`), renderizado
  global en `src/app/[lang]/layout.tsx` dentro de `QueryProvider`. Hoy ya elige posición por `useIsMobile()`.
- Señal de auth cliente: hook `useAuthUser()` (`src/hooks/use-auth-user.ts`) — resuelve el user vía
  Supabase y reacciona a sign-in/out con `onAuthStateChange`. `user` es `undefined` mientras resuelve.
- **Fail-safe recomendado:** mientras `user === undefined` (auth sin resolver), tratar como autenticado
  (toast arriba) para nunca arriesgar tapar un nav que quizá esté presente. Solo `user === null` (logout
  confirmado) → abajo.
- Matiz: el bottom-nav real solo existe en rutas `/dashboard`; keyear por estado de auth (según pide el
  ticket) es más conservador y cubre el criterio de "reacciona al login". UI pura → sin test de componente
  requerido (política CLAUDE.md: "UI polish can ship without component tests").
- Reviewer: verificar en un dispositivo mobile real en ambos estados de auth.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
