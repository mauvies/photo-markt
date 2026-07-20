# T-162 · Inconsistencia de datos del carrito: ítems desactualizados/parciales tras agregar, y borrados que reaparecen (el contador sí se actualiza)

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/cart-revalidate-on-add`  (tipo = fix)
- **OpenSpec change:** —  (bug-fix de caching/routing, no toca pagos/BD/auth de fondo)
- **PR:** —

## Requerimiento (reporte del usuario)
> En `/en/dashboard/talent/events/maraton-madrid-2026-madrid-spain-2026` agrego fotos al carrito.
> Al navegar al carrito **no veo esas fotos, o solo una fracción** de las que agregué — aunque el
> **contador del ícono del carrito en el nav sí se actualizaba** correctamente al instante. Si en la
> página del carrito **refresco (F5), sí las veo**.
>
> **(2ª parte del reporte)** Además, ya en el carrito, al **borrar** varios ítems, **algunos se
> borran bien pero otros vuelven a aparecer**.

## Causa raíz (verificada en código)
Dos caminos **desacoplados** leen el estado del carrito:
- **Contador (correcto):** `useCartItemCount` (`src/hooks/use-cart-item-count.ts`) es un hook
  **client** con react-query (`queryKey: ['cart-count']`, `refetchOnWindowFocus`, `staleTime 30s`)
  montado en el nav persistente → se refresca en vivo. Por eso el número es correcto al instante.
- **Página del carrito (stale):** `page.tsx` es un **Server Component**
  (`getCurrentCart()`), con `export const dynamic = 'force-dynamic'` → el **servidor** siempre
  re-renderiza fresco. **Pero** el **Router Cache del cliente** (`next.config.ts` →
  `experimental.staleTimes.dynamic = 30`) sirve el **payload RSC prefetcheado/cacheado** de la ruta
  del carrito durante 30s en navegación client-side. Ese snapshot se capturó **antes o a mitad** de
  agregar las fotos → ves 0 o una fracción. **F5 salta el Router Cache** → render fresco → correcto.

**El hueco concreto (síntoma 1 — al agregar):** `addPhotoToCartAction` (`cart/actions.ts:144`)
escribe en la BD pero **nunca llama `revalidatePath`** para la ruta del carrito, así que el Router
Cache del cliente no se invalida al agregar. `removePhotoFromCartAction` y `clearCartAction` tienen
el mismo hueco. En contraste, el webhook de Stripe (`api/stripe/webhook/route.ts`) **sí** hace
`revalidatePath('/[lang]/dashboard/talent/cart', 'page')` tras la compra — es exactamente el patrón
que falta en las mutaciones de agregar/quitar.

**Síntoma 2 — borrados que reaparecen (race de optimistic-update + refetch):** `handleRemove`
(`cart-content.tsx:160`) hace remove **optimista** sobre `queryClient.setQueryData(['cart-data'])` y
al confirmar dispara `await queryClient.invalidateQueries(['cart-data'])`, que **refetchea**
`getCurrentCart`. Con varios borrados en secuencia rápida, cada uno lanza su propio refetch en un
`startTransition` aparte; un refetch en vuelo **disparado por un borrado anterior** puede resolver
cuando el `DELETE` de **otro** ítem aún no committeó → devuelve un snapshot del servidor que **todavía
trae ese ítem** y **sobrescribe el estado optimista** que ya lo había quitado → **reaparece**. Es una
race clásica de optimistic-update: falta cancelar los queries en vuelo antes de mutar / evitar que un
refetch viejo pise una remoción más nueva (o usar una `useMutation` con `onMutate`/`onSettled`
bien encadenado en vez de invalidaciones sueltas por acción). Distinto mecanismo que el síntoma 1
(cliente/react-query vs. Router Cache), pero **mismo problema de cara al usuario**: el carrito no
refleja la realidad — por eso van juntos.

## Criterio de aceptación (Definition of Done)
- [ ] `addPhotoToCartAction` (y `removePhotoFromCartAction`, `clearCartAction`) invalidan la ruta del
      carrito tras la mutación —  `revalidatePath('/[lang]/dashboard/talent/cart', 'page')` (mismo
      patrón que el webhook), o el mecanismo equivalente que garantice que la **siguiente navegación**
      al carrito refetchea (no sirve el snapshot del Router Cache).
- [ ] Repro 1 arreglado: agregar N fotos desde la vista del evento → navegar al carrito (sin F5)
      muestra **las N** fotos, no 0 ni una fracción. El contador sigue correcto.
- [ ] Repro 2 arreglado: borrar varios ítems en secuencia rápida → **todos** los borrados
      persisten; **ninguno reaparece**. Corregir la race de optimistic-remove + refetch en
      `handleRemove` (p. ej. `cancelQueries(['cart-data'])` antes de mutar y no dejar que un refetch
      viejo pise una remoción más nueva; o migrar a `useMutation` con `onMutate`/`onSettled`).
- [ ] Verificar que también aplica al **carrito de invitado** si comparte el mismo defecto (revisar
      `/cart` — el guest cart vive en `localStorage`, así que probablemente **no** aplica el mismo
      mecanismo; confirmar y acotar el fix al autenticado si es el caso).
- [ ] Sin regresión: el contador del nav, el badge, y el flujo de checkout siguen bien; no re-introduce
      el problema que `staleTimes.dynamic = 30` resolvía (back-nav instantáneo) — la invalidación debe
      ser **dirigida a la ruta del carrito**, no bajar el `staleTimes` global.
- [ ] test de regresión: **(a)** que `addPhotoToCartAction` dispara la revalidación de la ruta del
      carrito (falla antes — hoy no revalida / pasa después; mockear `revalidatePath` y asertar la
      llamada, o test de integración del efecto); **(b)** que borrados concurrentes en `handleRemove`
      no reintroducen ítems (un refetch viejo no pisa una remoción más nueva) — test del handler con
      react-query + acciones mockeadas.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Prioridad P1:** es el flujo core de compra y **parece pérdida de datos** al usuario (agregué fotos,
  no están en el carrito) — alto riesgo de abandono/confusión, aunque los datos están a salvo en BD y
  el F5 los recupera. Si se prefiere P2 por eso último, se puede bajar; lo dejo P1 por el impacto de
  percepción en el revenue path.
- Familia caching (silent staleness, cf. auditoría T-084–T-101) pero **no duplica** ninguno de esos
  (aquellos ya cerrados/otras superficies); tampoco T-115/T-116/T-117 (integridad de ítems) ni T-134
  (prueba de acceso). Es específicamente la **revalidación de ruta al mutar el carrito**.
- Relacionado con **T-161** solo por compartir el flujo "navegar al carrito", pero **causa distinta**
  (T-161 = prefijo de locale del link; T-162 = staleness del Router Cache). Independientes; se pueden
  ejecutar por separado.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cart-revalidate-on-add`.
2. Implementar directo (revalidatePath en las mutaciones del carrito) + test de regresión.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
