# T-187 · Investigar por qué el nav re-renderiza al navegar de la página de evento al carrito

- **Prioridad:** P3
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `fix/nav-rerender-events-to-cart`  (tipo = fix)
- **OpenSpec change:** —  (investigación de perf/render de un componente; decidir al ejecutar)
- **PR:** —

## Requerimiento (pregunta del usuario)
> "¿Por qué si paso de `/en/events/marathon-paris-france-2026` a `/en/cart` algunos botones o links en el **nav** tienen que volver a renderizarse?"

Modo diagnóstico: primero **entender la causa**, luego decidir si es un problema real (flicker visible / trabajo desperdiciado) o comportamiento esperado de React, y actuar en consecuencia (arreglar o documentar por qué está bien).

## Contexto (verificado en código)
- Ambas rutas (`/events/[shareCode]` y `/cart`) viven bajo el **mismo layout** `src/app/[lang]/layout.tsx`, que renderiza `<Nav />` (`src/components/nav.tsx`, **client component**). En App Router un layout compartido **se preserva** entre navegaciones soft → `Nav` **no debería remontarse**.
- Aun así `Nav` **se re-ejecuta en cada cambio de ruta** porque llama `usePathname()` (`nav.tsx:19`) — cambia al navegar → re-render de `Nav` → **reconciliación de todos sus hijos** (`LogoLink`, `CartLinkButton`, `LanguageSwitcher`, `UserAvatar`/botones de login). Ninguno está memoizado. En estas dos rutas `showCart` es `true` en ambas y el estado de auth no cambia, así que el **output** de los botones es idéntico — el re-render es reconciliación pura, normalmente barato.

## Hipótesis a verificar (parte del trabajo)
1. **Re-render por `usePathname()` (esperado):** `Nav` se re-ejecuta en cada nav y sus hijos se reconcilian. Si son baratos y no hay flicker, es comportamiento normal de React — la acción sería **documentar** (y opcionalmente `React.memo` en los hijos que no dependen del pathname: `LogoLink`, `LanguageSwitcher`, `CartLinkButton`, `UserAvatar`) para cortar el re-render.
2. **Navegación HARD (full reload) al carrito:** el toast "Ver carrito" de la página pública del evento navega con **`window.location.href`** (`public-event-photo-viewer.tsx`, ver T-168) → recarga de documento completa → el nav **se remonta de verdad** y `useAuthUser()` vuelve a resolver (`user === undefined` → **skeleton** de auth, `nav.tsx:58-72`) antes de reasentar. Si el usuario llega a `/cart` por esa vía, ese es el "re-render" visible. Fix posible: navegar con `router.push`/`<Link>` (soft) en vez de `window.location.href`. **Confirmar por qué ruta navega el usuario** (ícono de carrito = soft `<Link>` en `CartLinkButton`, vs. toast = hard).
3. **Refetch de React Query en hooks del nav:** `useAuthUser()` (`nav.tsx:25`) y `useCartItemCount`/`useGuestCart` dentro de `CartLinkButton` — revisar `staleTime`/`refetchOnMount`/`refetchOnWindowFocus`. Un refetch en cada navegación re-renderizaría el botón de carrito/avatar aunque el dato no cambie.
4. **Props nuevas desde el layout:** confirmar que el layout **no** pasa props que cambien de referencia por navegación (hoy `Nav` no recibe props — se auto-resuelve client-side; verificar que sigue así).

## Criterio de aceptación (Definition of Done)
- [ ] **Diagnóstico escrito** en el PR: cuál(es) de las hipótesis aplica(n), con evidencia (React DevTools "highlight updates" / Profiler, o Network para distinguir soft vs hard nav).
- [ ] Si es un **problema real** (flicker de skeleton por hard-nav, o refetch innecesario, o hijos caros re-renderizando): aplicarlo — p. ej. navegar soft en vez de `window.location.href`, ajustar `staleTime`/`refetchOnMount`, y/o `React.memo` en los hijos del nav independientes del pathname.
- [ ] Si es **comportamiento esperado y barato** (reconciliación por `usePathname`, sin flicker ni refetch): documentarlo (comentario en `nav.tsx` y/o nota) y cerrar sin cambio de código, explicando por qué no vale la pena optimizar.
- [ ] **Sin regresión visual/funcional** del nav (cart icon, language switcher, avatar/login, active states) en ambas rutas, mobile y desktop.
- [ ] Si hay cambio de código: test de regresión que falle antes y pase después (p. ej. guard source-level de que el destino del toast usa navegación soft; o test de que el hijo memoizado no re-renderiza con las mismas props).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.
- [ ] Sin `any`; Biome; sin otros cambios.

## Notas
- **Relación:** T-168 (el toast "Ver carrito" con `window.location.href` — se arregló el locale, pero **sigue siendo navegación hard**, hipótesis #2). Familia de perf frontend T-123/T-124/T-125/T-126 (aunque esto es render del nav, no LCP). Familia de skeletons T-171/T-161 (flashes de skeleton en navegación).
- **No confundir** con un bug funcional: el nav funciona; la pregunta es de **render/perf** (re-render evitable vs. esperado).
- Priorizado **P3**: no hay bug funcional reportado; es pulido de render/perf. Sube a P2 si el diagnóstico revela un flicker de skeleton visible por hard-nav (impacto UX real).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/nav-rerender-events-to-cart`.
2. Diagnosticar primero (DevTools/Profiler/Network); implementar directo si hay fix, sin OpenSpec.
3. Implementar + test de regresión (si hay cambio de código).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
