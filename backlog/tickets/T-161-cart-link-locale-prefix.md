# T-161 · Links in-app que pierden el prefijo `/[lang]` → flip de locale (es→en) + skeleton del home en la transición

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/locale-prefix-inapp-links`  (tipo = fix)
- **OpenSpec change:** —  (bug-fix de i18n/routing, no toca pagos/BD/auth)
- **PR:** —

> **Alcance ampliado (2026-07-20):** el reporte original era el botón del carrito, pero una
> auditoría encontró **~20 call-sites en 14 archivos** con el mismo defecto (href/`router.push`
> sin prefijo `/[lang]`). Este ticket ahora es el **barrido completo**, no solo el carrito.

## Requerimiento (reporte del usuario)
> Al navegar desde `/es/dashboard/talent/events/maraton-madrid-2026-madrid-spain-2026` a la página
> del carrito (click en el ícono de carrito del nav):
> 1. la ruta pasa de `/es/dashboard/talent/events/...` a **`/en/dashboard/talent/cart`** — cambia el
>    lang de **es a en**.
> 2. en la transición se muestra **primero el skeleton del home page**, luego un ícono de loading
>    centrado, y recién después renderiza el carrito.

## Causa raíz (verificada en código) — una sola, dos síntomas
`src/components/cart-link-button.tsx` construye el `href` **sin el prefijo `/[lang]`**:
- `AuthCartLinkButton` → `<CartIconButton href="/dashboard/talent/cart" />`
- `GuestCartLinkButton` → `<CartIconButton href="/cart" />`

Al ser un path **sin locale**, el middleware (`src/proxy.ts`) re-detecta el idioma
(cookie `preferred-locale` → `accept-language` → default). El navegador del usuario manda
`accept-language: en-US` → resuelve a **`en`**, no al `es` en el que estaba. **Ese es el síntoma 1.**

**El síntoma 2 es consecuencia del 1:** como el segmento **`[lang]` cambia** (es→en), Next
**re-monta todo el subárbol `[lang]`**, así que muestra el `src/app/[lang]/loading.tsx` (que tras
T-156/T-157 es el **skeleton del home explore**) como loading de nivel superior durante la
navegación cross-locale; luego cae al loading del subárbol del dashboard, y por último el carrito.
Si el href preservara `/es`, el segmento `[lang]` no cambiaría y no aparecería el skeleton del home.

**Es el mismo tipo de bug que T-150** (PR #207, "links sin prefijo `/[lang]`"), que arregló los
call-sites de `eventLinkPrefix`/`basePath` + el ternario del middleware + la escritura de la cookie
del language switcher, **pero dejó fuera muchos otros links** (nav del dashboard, quick-actions,
menús, pricing, etc.). No se solapa con T-111/T-112 (render de ítems del carrito).

## Superficie completa (auditoría 2026-07-20)
~20 call-sites en 14 archivos con `href`/`router.push`/`router.replace` a rutas de app **sin**
prefijo `/[lang]` (excluidos los que ya usan `lp()`/`localizedPath`, y los root `not-found.tsx`/
`error.tsx` que legítimamente no conocen el lang y dependen del middleware). **Cada uno debe
verificarse** — son candidatos del grep; casi todos deberían preservar locale.

**Componentes compartidos (client — necesitan `useParams().lang`):**
- `src/components/cart-link-button.tsx` — `/dashboard/talent/cart` (auth) y `/cart` (guest) ← el reportado
- `src/components/dashboard-top-header.tsx` — `/dashboard/talent/cart`
- `src/components/dashboard-user-menu.tsx` — `/dashboard/talent/privacy`, `` `/dashboard/${role}/support` ``, `` `/dashboard/${role}/feedback` ``
- `src/components/pricing-plan-button.tsx` — `/signup?plan=…` (Link + `router.push`), `/dashboard/photographer/settings?updated=true`
- `src/components/pricing-section.tsx` — `/contact`
- `src/components/support-page.tsx` — `/dashboard/photographer/settings?tab=billing`
- `src/components/google-signin-button.tsx` — `` `/login?message=…` `` (rama de error)
- `src/components/user-avatar.tsx` — `router.push('/dashboard')`

**Páginas/componentes dentro de `[lang]` (tienen `lang` por params o `useParams`):**
- `src/app/[lang]/dashboard/talent/quick-actions.tsx` — `/dashboard/talent/events`, `/favorites`, `/cart`
- `src/app/[lang]/dashboard/talent/view-all-link.tsx` — `/dashboard/talent/favorites`
- `src/app/[lang]/dashboard/talent/empty-state.tsx` — `/dashboard/talent/events`
- `src/app/[lang]/dashboard/talent/profile/profile-content.tsx` — `/dashboard/talent/events`, `/favorites`, `router.replace('/dashboard/talent/profile')`
- `src/app/[lang]/dashboard/talent/favorites/talent-photos-grid.tsx` — `` `/dashboard/talent/events/${id}` ``
- `src/app/[lang]/dashboard/photographer/settings/payout-profile-section.tsx` — `/dashboard/photographer/settings/payout-profile`
- `src/app/[lang]/dashboard/photographer/earnings/payout-profile-banner.tsx` — idem
- `src/app/[lang]/dashboard/photographer/earnings/earnings-content.tsx` — idem
- `src/app/[lang]/login/page.tsx` — `` `/signup${…}` ``

> Nota: el barrido que los detecta es
> `grep -rnE "(href=[\"\`]|router\.(push|replace)\([\"\`])/(dashboard|cart|events|login|signup|onboarding|pricing|checkout|photographer|support|feedback|contact|about|terms|privacy|auth)" src/ | grep -vE "localizedPath|lp\("`
> — reusar al ejecutar para no dejar ninguno (y volver a correrlo al final: debe dar 0).

## Criterio de aceptación (Definition of Done)
- [ ] **Todos** los call-sites de la lista de arriba prefijan con `/[lang]`: componentes cliente
      compartidos vía `useParams().lang` + `localizedPath`; páginas/comps dentro de `[lang]` vía el
      `lang` de params (o `useParams`). Mismo patrón que `event-card.tsx` en T-150. El grep final del
      barrido debe dar **0** resultados.
- [ ] Caso reportado (carrito): navegar desde `/es/...` al carrito aterriza en
      `/es/dashboard/talent/cart` (y `/es/cart` para invitado), **sin flip a `en`**.
- [ ] Tras el fix, la transición del carrito **ya no** muestra el skeleton del home
      (`[lang]/loading.tsx`): al no cambiar el segmento `[lang]`, no hay re-mount cross-locale.
      Verificar visualmente.
- [ ] Si tras arreglar el locale **aún** queda un flash raro (p. ej. spinner sin skeleton propio del
      carrito), evaluar añadir `src/app/[lang]/dashboard/talent/cart/loading.tsx` (hoy **no existe**) —
      opcional, solo si el flash persiste.
- [ ] Cada link corregido se verifica que **preserva** el locale y **no rompe** query params
      existentes (`?plan=`, `?tab=billing`, `?updated=true`, `?message=`, `?next=`, etc.).
- [ ] Sin regresión funcional (contador del carrito, estado vacío del ícono, flujo de signup/pricing,
      OAuth de Google, menús de rol).
- [ ] test de regresión: al menos el `CartLinkButton` (auth y guest) incluye el prefijo `/[lang]`
      (falla antes / pasa después); idealmente un guard que verifique que **ningún** componente
      cliente compartido del nav emite un href pelado (source-level o render con `useParams` mockeado).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Familia **T-150** (i18n/prefijo de locale) — es literalmente el resto del barrido que T-150 no
  completó. Considerar extraer un helper/patrón único (p. ej. un `<LocalizedLink>` o un hook
  `useLocalizedHref`) para que futuros links no vuelvan a caer en el path pelado — evaluar al ejecutar
  si vale la pena o si `useParams().lang` + `localizedPath` inline alcanza.
- **`nav.tsx` y `talent-dashboard-header.tsx` ya usan `lp()`** (correctos) — no están en la lista.
- Root `not-found.tsx`/`error.tsx` quedan fuera a propósito (no conocen el lang; dependen del
  middleware).
- Es un cambio de muchos archivos pero mecánico y con requerimiento claro → implementar directo.
  Solo UI/i18n/routing — no toca pagos/auth/BD → sin `/code-review`, sin OpenSpec.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cart-link-locale-prefix`.
2. Implementar directo (prefijo de locale en el link + verificar la transición) + test de regresión.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
