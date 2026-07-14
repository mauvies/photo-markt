# T-130 · Bug: las previews del carrito no se ven para usuarios autenticados (sí para invitados)

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno (coordinar merge con T-121 / cluster Carrito — mismos archivos)
- **Rama:** `fix/authenticated-cart-preview`  (tipo = fix)
- **OpenSpec change:** —  (bug de fuente de URL de preview; requerimiento claro)
- **PR:** —

## Requerimiento
Las previews de las fotos del carrito **se ven para usuarios NO autenticados** (carrito de invitado) pero
**no se ven para usuarios autenticados** (carrito de talento). El carrito autenticado muestra el fallback
(ícono de imagen) o una imagen rota/vacía en vez de la miniatura de la foto.

## Estado actual (verificado en el código)
Las dos superficies resuelven la preview de **forma distinta**, y la del carrito autenticado es la frágil:

- **Invitado — funciona.** `resolveGuestCartPreviewsAction` (`src/app/[lang]/cart/actions.ts`) usa
  **`supabaseAdmin`** (bypass RLS) y `resolvePhotoPreviewUrl` (`src/lib/thumbnails.ts`): sirve el
  **thumbnail horneado inmutable** (`/api/thumb`) cuando `thumbnail_status='ready'`, y un signed URL recién
  firmado con admin como fallback. Siempre obtiene una URL válida.
- **Autenticado — falla.** `getCurrentCart` (`src/app/[lang]/dashboard/talent/cart/actions.ts`) genera la
  preview con el **cliente user-scoped**: `createPhotoUrls(supabase, 'photos', photoPaths, { useWatermark:false, expiresIn:3600 })`.
  El talento **no es dueño** de la foto (la posee el fotógrafo), así que la RLS/policy del bucket privado
  `photos` puede **denegar** firmar un signed URL para un path ajeno → `previewUrl` queda `null` (fallback)
  o el signed URL no sirve → imagen rota. Además nunca usa el thumbnail horneado.

**No es T-111.** T-111 (PR #159) arregló que el `<Image>` autenticado enrutaba el original multi-MB por el
optimizer de Vercel (añadió `unoptimized`) — asumía que el signed URL existía. Este bug es sobre la **fuente
de la URL** (user-scoped vs admin/thumbnail), no el optimizer. Convergencia pendiente ya anticipada en las
notas de T-115/T-121: "una sola query de cart items con previews resueltas".

## Criterio de aceptación (Definition of Done)
- [ ] Las previews del carrito **autenticado** se ven para todas las fotos comprables (misma fiabilidad que
      el carrito de invitado), tanto con thumbnail horneado como sin él.
- [ ] El carrito autenticado resuelve la preview con el **mismo criterio robusto** que el invitado —
      thumbnail horneado (`/api/thumb`) cuando `ready`, signed URL (admin) como fallback — reutilizando el
      helper compartido (`resolvePhotoPreviewUrl` / la lógica de `resolveGuestCartPreviewsAction`), sin
      duplicar.
- [ ] El fallback de ícono solo aparece cuando de verdad no hay preview posible (no por un signed URL
      denegado por RLS).
- [ ] Sin regresión: el lightbox del carrito, el subtotal, el conteo y el checkout siguen igual.
- [ ] test de regresión que falle antes y pase después (p. ej.: `getCurrentCart` devuelve una `previewUrl`
      no nula para una foto comprable cuyo talento no es el dueño; y sirve el thumbnail horneado cuando
      `thumbnail_status='ready'`).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Dirección de fix:** unificar la resolución de preview del carrito autenticado con la del invitado —
  firmar con `supabaseAdmin` y preferir el thumbnail horneado vía `resolvePhotoPreviewUrl`, en vez del
  signed original user-scoped. Idealmente una sola fuente de resolución compartida por ambos carritos
  (converge con lo que dejó T-115/T-121). El render (`<Image unoptimized>` de T-111) ya está bien; el
  cambio es en `getCurrentCart`.
- **Solape / merge:** toca `dashboard/talent/cart/actions.ts` (y quizá `cart-content.tsx`) — mismos archivos
  que **T-121** (PR #181, abierto) y el cluster Carrito. Mergear T-121 antes y rebase, o coordinar para
  evitar conflictos. Independiente de los cambios de cliente de T-121 (esto es server-side, generación de
  URL) — no es una regresión de T-121.
- Sin strings nuevos (no cambia copy). Sin `any`. Biome. **Sin otros cambios.**

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/authenticated-cart-preview`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
