# T-171 · El skeleton del home se filtra a otras páginas (loading.tsx en la raíz de `[lang]`)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/scoped-loading-skeletons`  (tipo = fix)
- **OpenSpec change:** —  (routing/UI de loading states; no toca pagos/auth/BD)
- **PR:** #228

## Requerimiento (reporte del usuario)
> La página `/en/photographer/mauricioviera` cuando carga usa los **skeletons de la home page**. Revisar
> bien que **ninguna otra página** que no sea la home o `/[lang]/dashboard/talent/events` muestre los
> skeletons de esas páginas.

## Causa raíz (confirmada leyendo el código)
`src/app/[lang]/loading.tsx` renderiza `EventsExploreViewSkeleton` (el skeleton del **home explore**,
T-156/T-157) pero vive en la **raíz de `[lang]`**. En Next App Router un `loading.tsx` es el fallback de
Suspense de **todo el subárbol** de su segmento → cualquier ruta bajo `[lang]/*` que **no tenga su
propio `loading.tsx`** hereda el skeleton del home. `[lang]/photographer/[slug]/` **no tiene** loading
propio → muestra el skeleton del home (justo lo reportado).

**Rutas afectadas hoy** (async, sin `loading.tsx` propio → heredan el skeleton del home): `photographer/[slug]`,
`photographers`, `cart`, `checkout`, `onboarding`, `download`, y la raíz `dashboard`. (Las páginas
estáticas —about/terms/privacy— no suspenden, así que rara vez lo muestran, pero igual lo heredarían.)

**Lo que SÍ está bien scoped** (no tocar): `dashboard/talent/events/loading.tsx` aplica solo a esa ruta;
su hijo `[id]` tiene su **propio** `loading.tsx` (T-128) → el skeleton de la lista de eventos de talento
no se filtra al detalle. Rutas con loading correcto propio: `events`, `events/[shareCode]`,
`dashboard/(photographer|talent)` y sus `events`/`orders`, `signup`.

## Criterio de aceptación (Definition of Done)
- [ ] El skeleton del **home** (`EventsExploreViewSkeleton`) se muestra **solo** en la home (`/[lang]`),
      no en `photographer/[slug]`, `photographers`, `cart`, `checkout`, `onboarding`, `download`, ni la
      raíz `dashboard`.
- [ ] El skeleton de **`/[lang]/dashboard/talent/events`** sigue mostrándose solo ahí (y su detalle
      `[id]` con el suyo) — no se filtra a otras rutas (verificar que sigue OK tras el cambio).
- [ ] Ninguna otra ruta muestra un skeleton que no le corresponde. Enfoque recomendado: **mover la home
      a un route group** (`[lang]/(home)/page.tsx` + `[lang]/(home)/loading.tsx`) para que el skeleton
      del home quede **scopeado al grupo** sin cambiar la URL (`/[lang]` sigue resolviendo a la home), y
      **quitar** el `[lang]/loading.tsx` de la raíz. Alternativa: dar a cada ruta async su propio
      `loading.tsx` (más archivos, whack-a-mole — menos robusto para el "ninguna otra página" que pide
      el usuario).
- [ ] Definir qué ven mientras cargan las rutas que queden sin skeleton propio: idealmente un
      `loading.tsx` **neutral/genérico** (spinner o shell mínimo) a nivel `[lang]` como red de seguridad
      —nunca el grid del home— o dejar sin fallback (Next espera) si es más limpio. La página del
      fotógrafo idealmente gana un skeleton **propio** que calce su layout (nice-to-have).
- [ ] test de regresión source-level (patrón `route-loading-skeletons.test.tsx` / T-128): asserta que el
      `EventsExploreViewSkeleton` ya **no** es el fallback de rutas no-home (p. ej. que `[lang]/loading.tsx`
      no lo renderiza / vive en `(home)`), y que las rutas afectadas no lo heredan — falla antes / pasa
      después.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` (+ `pnpm build`, porque se reestructuran archivos de
      ruta/route-group) en verde.

## Notas
- **P2** — jank visual visible en varias páginas públicas (perfil de fotógrafo, listado, carrito) con el
  skeleton equivocado; misma familia que los tickets de skeletons (T-128 P2). No es funcional/datos.
- **Relacionado con T-161** (done): ahí el skeleton del home aparecía como síntoma del **flip de locale**
  (re-montaje del subárbol `[lang]`). Esto es la **otra cara**: aun sin flip de locale, el
  `[lang]/loading.tsx` del home se filtra a todo `[lang]/*` en cargas normales. Causa distinta
  (ubicación del `loading.tsx`, no prefijos de link) → no es duplicado.
- Al mover la home a un route group, verificar que `layout.tsx`, `error.tsx`, `not-found.tsx` de `[lang]`
  siguen aplicando bien (esos deben quedarse en `[lang]/`, no entrar al grupo) y que metadata/`generateMetadata`
  de la home no se rompe.
- Contexto: skeleton del home = T-156/T-157; sincronía de skeletons = T-128 (todos done).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/scoped-loading-skeletons`.
2. Si aplica, `/opsx:propose` (mueve varios archivos de ruta); si es acotado, implementar directo.
3. Reestructurar (route group para la home / scopear el skeleton) + red de seguridad neutral + test.
4. `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
7. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
