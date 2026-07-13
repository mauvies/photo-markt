# T-115 · Fix: previews del carrito rotas para fotos activas — resolver la URL en vivo (no snapshot guardado)

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/cart-preview-live-resolution`
- **OpenSpec change:** —  (bug de resolución de imagen)
- **PR:** —
- **Cluster:** Carrito/previews & integridad — T-115 → T-116 → T-117 (ver notas; ejecutar en serie con merge previo, tocan el mismo código de carrito)

## Requerimiento (Parte 1 del reporte)
Las previews del carrito fallan al renderizar **incluso para fotos actualmente activas** (no borradas).
Hipótesis: no es un problema de datos borrados, es un bug de **resolución/render** de la URL. El carrito
debe resolver la imagen de preview **igual que el resto de la app** — un lookup **en vivo** del path de
preview/thumbnail actual de la foto, **no** una URL guardada/cacheada al momento de agregar al carrito.
Reusar la lógica de resolución de preview que ya usan las galerías que sí funcionan.

## Estado actual (verificado en el código)
- **Carrito de invitado** (`localStorage`): `GuestCartItem` (`src/lib/guest-cart.ts:14`) guarda
  `previewUrl: string | null` — un **snapshot** tomado al agregar (en `public-event-photo-viewer.tsx`,
  `previewUrl: photo.url`). Ese `photo.url` es un **URL firmado de Supabase** (`createPhotoUrls`,
  `useWatermark:false`) que **expira (~1h)** → una foto activa agregada hace más de una hora muestra
  preview rota. **Ésta es la causa raíz más probable del bug reportado para el carrito de invitado.**
- **Carrito autenticado** (`cart_items`): la acción del carrito resuelve `previewUrl` server-side por
  carga de página (más "en vivo"). **Ojo:** T-111 (PR #164) ya arregló otra causa aquí — la preview del
  carrito autenticado no renderizaba por falta de `unoptimized` (el optimizador de Vercel timeout-eaba el
  original multi-MB). **No re-hacer T-111.** Investigar si queda alguna causa residual en el auth cart
  además de la del invitado.

## Criterio de aceptación (Definition of Done)
- [ ] **Investigación reportada en el PR:** confirmar la causa raíz por tipo de carrito (invitado: URL
      firmada expirada en snapshot; autenticado: ya cubierto por T-111 ¿o queda algo?).
- [ ] El carrito **resuelve la preview en vivo** desde el registro actual de la foto (path de
      preview/thumbnail vigente), no desde una URL guardada al agregar. Reusar la resolución de
      preview/thumbnail existente de las galerías (**no** construir un método paralelo de URLs).
- [ ] Invitado: dejar de depender del `previewUrl` snapshot en `localStorage` para renderizar (resolver
      el path actual al cargar el carrito). Si se mantiene un campo cacheado por otras razones, que **no**
      sea la fuente de verdad del render.
- [ ] Las previews de fotos **activas** renderizan correctamente en carrito de invitado y autenticado
      (incl. tras >1h de haber agregado el ítem).
- [ ] Sin regresión en agregar/quitar del carrito ni en el checkout.
- [ ] strings nuevos en `en.json` y `es.json` (si hace falta algún texto).
- [ ] test de regresión/feature que falla antes y pasa después (p. ej.: el render del ítem no usa un URL
      firmado guardado sino el path resuelto en vivo; o el ítem de invitado con `previewUrl` stale igual
      renderiza la preview vigente).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Archivos:** `src/lib/guest-cart.ts` (shape del ítem), `src/app/[lang]/cart/guest-cart-content.tsx`
  (render invitado), `src/app/[lang]/dashboard/talent/cart/cart-content.tsx` + `.../cart/actions.ts`
  (auth), `src/app/[lang]/events/[shareCode]/public-event-photo-viewer.tsx` (donde se arma el
  `GuestCartItem`). Resolución de preview/thumbnail: `createPhotoUrls`/pipeline `/api/thumb`, `/api/watermark`.
- **Relación con T-117 (Parte 3):** el carrito de invitado necesitará de todos modos un fetch/validación
  server-side de las fotos actuales (T-117) — esa misma consulta puede alimentar la resolución en vivo de
  esta preview. Coordinar: si T-117 se hace primero, reusar su lookup; si éste va primero, dejar el
  gancho listo.
- **No confundir con T-111** (auth cart `unoptimized`, ya hecho) ni con T-110 (owner watermark).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cart-preview-live-resolution`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
