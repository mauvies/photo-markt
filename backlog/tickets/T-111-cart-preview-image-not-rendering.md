# T-111 · Bug: preview de foto no se renderiza en los ítems del carrito

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/cart-preview-image-not-rendering`
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** —

## Requerimiento
En la página de carrito de compra, la imagen de preview de cada producto agregado al carrito no se
está renderizando (se ve rota / no aparece). Debe verse correctamente para que el comprador identifique
la foto antes de pagar.

## Criterio de aceptación (Definition of Done)
- [ ] La preview de cada ítem del carrito renderiza correctamente en `/dashboard/talent/cart` (usuario
      autenticado, `cart-content.tsx`) y en `/[lang]/cart` (invitado, `guest-cart-content.tsx`) — ambos
      comparten el mismo patrón `item.previewUrl` + `next/image`
- [ ] Identificada la causa raíz (signed URL nula/expirada, mismatch de path, o problema del optimizador
      de `next/image` con la URL firmada — similar al patrón visto en T-110)
- [ ] Fallback (`ImageIcon`) solo se muestra cuando de verdad no hay preview disponible, no como
      consecuencia del bug
- [ ] test de regresión/feature que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Ambas superficies leen `item.previewUrl` de `CartItemDetail` (`dashboard/talent/cart/actions.ts`,
  `getCurrentCart`), que arma la URL firmada vía `createPhotoUrls(..., useWatermark:false)` sobre
  `photo_url` — revisar ahí primero. El carrito de invitado (`guest-cart-content.tsx`) usa el mismo campo
  pero puede tener su propio fetch — confirmar si comparte la misma causa raíz o es un bug independiente
  antes de tocar código en los dos lados.
- Coordinar con **T-112** (reordenar fecha bajo fotógrafo) — ambos tickets tocan el mismo bloque JSX en
  `cart-content.tsx` / `guest-cart-content.tsx`; ejecutar contiguos para evitar conflicto de merge.
- Precedente relevante: T-110 fue un bug similar de imagen rota en la grilla del dueño (thumb con
  marca de agua servido por `/api/thumb` sin variante limpia) — no necesariamente la misma causa aquí
  (el carrito ya pide `useWatermark:false`), pero vale revisar si el optimizador de `next/image` está
  fallando con timeout/CORS sobre la signed URL igual que en ese caso.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cart-preview-image-not-rendering`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
