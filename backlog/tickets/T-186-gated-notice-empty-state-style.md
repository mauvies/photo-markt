# T-186 · Reestilizar el aviso "búsqueda facial no disponible" al estilo del estado vacío del carrito

- **Prioridad:** P3
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `fix/gated-notice-empty-state-style`  (tipo = fix)
- **OpenSpec change:** —  (UI/estilo de un componente, no lo amerita)
- **PR:** —

## Requerimiento
> El mensaje **"Face search isn't available / This event reveals photos through face search, but search isn't available right now. Please check back later or contact the photographer."** que aparece en `/en/events/marathon-paris-france-2026` debe usar el **mismo estilo** que el estado vacío del carrito en `/en/cart`: **"Your cart is empty / Browse events to find and add your photos. / [Browse events]"**.

Es puro ajuste visual: que el aviso del reveal gate se vea como el empty-state del carrito (ícono grande centrado, título grande, descripción muted, misma jerarquía), en vez del recuadro con borde punteado actual.

## Contexto (verificado en código)
- El aviso lo renderiza **`src/components/gated-face-search-notice.tsx`** (creado en **T-184**, PR #243). Un solo componente, **dos estados** (`processing` y `unavailable`), usado en **ambas** superficies: la pública `events/[shareCode]/page.tsx` y la del dashboard de talento `dashboard/talent/events/[id]/page.tsx`. Reestilizar el componente arregla las dos de una.
- **Estilo actual** (`gated-face-search-notice.tsx:34-39`): contenedor con **recuadro** `rounded-lg border border-dashed border-input bg-muted/30 py-16 text-center`, ícono `h-12 w-12 ... opacity-40`, título `text-lg font-semibold`, descripción `text-sm text-muted-foreground`.
- **Estilo objetivo** = empty-state del carrito (`src/app/[lang]/cart/guest-cart-content.tsx:163-172`; el autenticado `dashboard/talent/cart/cart-content.tsx` es idéntico):
  - contenedor **sin recuadro**: `flex flex-col items-center justify-center py-16 px-4 text-center`
  - ícono **grande**: `h-16 w-16 text-muted-foreground/50`
  - título: `<h3 className="text-2xl font-semibold mb-2">`
  - descripción: `<p className="text-sm text-muted-foreground mb-6 max-w-md">`

## Criterio de aceptación (Definition of Done)
- [ ] `GatedFaceSearchNotice` usa el layout/tipografía del empty-state del carrito: **sin** borde punteado ni `bg-muted/30`; ícono `h-16 w-16 text-muted-foreground/50`; título `text-2xl font-semibold mb-2` (usar `<h3>`); descripción `text-sm text-muted-foreground mb-6 max-w-md`; contenedor centrado `py-16 px-4 text-center`.
- [ ] Ambos estados (`processing` y `unavailable`) quedan con el nuevo estilo; ambas superficies (pública + dashboard talento) lo heredan sin tocarlas.
- [ ] **Sin cambio funcional:** el componente sigue recibiendo `state` + `labels`, misma lógica de ícono/título/descripción; solo cambian las clases y el markup del título a `<h3>`.
- [ ] test de regresión (source-level o render) que falla antes y pasa después: el componente ya no usa `border-dashed`/`bg-muted/30` y sí usa las clases del empty-state del carrito.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.
- [ ] Sin `any`; Biome; sin otros cambios.

## Notas
- **Decisión menor a resolver al ejecutar (no bloquea):** el empty-state del carrito incluye un **botón CTA** ("Browse events"). El aviso del reveal gate hoy **no** tiene CTA y no hay una acción obvia para los estados "procesando/no disponible" (el copy dice "vuelve más tarde o contacta al fotógrafo"). **Recomendación:** copiar la **jerarquía visual** (ícono/título/descripción) pero **omitir el botón** salvo que se decida un destino con sentido (p. ej. "Browse events" → `/events`). Si se agrega, requiere 1 string nuevo en `en.json`+`es.json`; si no, **no hay strings nuevos** (reusa `aiSearch.gatedNotice.*`).
- **Follow-up de T-184** (creó el componente) — no duplica; es solo el ajuste de estilo pedido por el usuario.
- Los íconos actuales (`ScanFace` para procesando, `TriangleAlert` para no-disponible) pueden conservarse; solo cambia el tamaño/opacidad para calzar con el `ShoppingCart h-16 w-16 text-muted-foreground/50` del carrito.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/gated-notice-empty-state-style`.
2. Implementar directo (UI de un componente); sin OpenSpec.
3. Implementar + test de regresión.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
