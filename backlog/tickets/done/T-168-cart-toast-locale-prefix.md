# T-168 · El toast "foto agregada al carrito" flipea el idioma al navegar al carrito

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/cart-toast-locale-prefix`  (tipo = fix)
- **OpenSpec change:** —  (bug de i18n/routing acotado, un archivo; no toca pagos/auth/BD)
- **PR:** —

## Requerimiento (reporte del usuario)
> Si navego al carrito desde la toast notification de "1 foto ha sido agregada al carrito", la página
> cambia de idioma. Revisar esto.

## Causa raíz (confirmada leyendo el código)
Es el **mismo defecto de la familia T-150/T-161** (links que sueltan el prefijo `/[lang]`), en un
call-site que **el barrido de T-161 no cazó**.

- `src/app/[lang]/events/[shareCode]/public-event-photo-viewer.tsx:301`:
  ```ts
  const cartHref = isAuthenticated ? '/dashboard/talent/cart' : '/cart';
  ```
  → path **sin** el prefijo `/${lang}`. El botón "Ver carrito" del toast hace
  `window.location.href = cartHref` (líneas ~348 y ~376) — una navegación **full-page** que pasa por el
  middleware (`proxy.ts`), que re-detecta el locale (cookie → `accept-language` → default; navegador
  `en-US`/`es-…` → decide) y sirve `/es/...` o `/en/...` según eso → **el idioma flipea**.
- Los otros call-sites de `showAddedToCartToast` **sí** están bien: los viewers de talento
  (`talent-photos-grid.tsx`, `event-photo-viewer.tsx`) usan `router.push(lp('/dashboard/talent/cart'))`
  con el helper localizado. Solo el **viewer público** quedó con el path pelado.

**Por qué T-161 lo dejó pasar:** el barrido (PR #222) apuntó a `href`/`router.push` literales; aquí la
navegación es `window.location.href = cartHref` con `cartHref` **definido en una variable aparte** (no
inline), así que el grep del sweep no lo cazó — pese a que T-161 reportó "0 links pelados". Es un hueco
del sweep, no un duplicado (T-150 PR #207 y T-161 PR #222 ya están **done**).

**Fix trivial:** el componente ya recibe la prop `locale` (línea ~137, usada en ~177) → basta con
`const cartHref = localizedPath(locale, isAuthenticated ? '/dashboard/talent/cart' : '/cart')`
(o el `lp()`/`useLocalizedPath` que usa el resto), preservando el locale actual.

## Criterio de aceptación (Definition of Done)
- [ ] Desde la página pública del evento en un idioma (p. ej. `/en/events/[shareCode]`), agregar una
      foto y pulsar "Ver carrito" en el toast lleva a `/en/(dashboard/talent/)cart` **manteniendo el
      idioma** — no flipea a español ni a otro locale.
- [ ] Cubrir las dos ramas de `cartHref` (invitado `/cart` y autenticado `/dashboard/talent/cart`) y los
      dos usos (add single ~348 y bulk-add ~376).
- [ ] Usar el prefijo de locale del helper compartido (`localizedPath(locale, …)` / `lp()`), no
      construir el path a mano — misma convención que los viewers de talento y que T-150/T-161.
- [ ] test de regresión que falla antes / pasa después: el `cartHref` (o el destino del toast) incluye
      el prefijo de locale (p. ej. render con `locale='en'` → href empieza con `/en/`).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **P2** — bug de correctitud i18n en el funnel de compra (evento público → carrito); mismo nivel que
  T-161 (P2). Fix de un archivo/una línea.
- **Familia T-150/T-161** (ambos done): este ticket **cierra un hueco del sweep de T-161**. Vale
  documentar en el fix que el patrón `window.location.href = <var pelada>` es una forma que el grep del
  sweep no cubría, por si aparecen más.
- **A verificar de paso (baja confianza, fuera del síntoma reportado):**
  `src/components/bottom-nav-account.tsx:83` define `settingsHref = \`/dashboard/${activeRole}/settings\``
  sin locale — T-161 afirmó que `bottom-nav-account` ya usa `lp()`, así que probablemente esa var se
  pasa por `lp()` aguas abajo; confirmar rápido que no es otro pelado. `EventSearchBar.tsx:66`
  (`searchHref='/events'`) es un default que los callers sobreescriben con el prefijo ya localizado
  (verificado por T-161) — no tocar.
- No confundir con los `window.location.href = url` de checkout (Stripe): esos son URLs **absolutas**
  de sesión, correctas.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cart-toast-locale-prefix`.
2. Implementar directo (localizar `cartHref` con `locale`) + test de regresión.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
