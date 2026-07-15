# T-133 · Seguridad: el fallback de preview del carrito sirve el ORIGINAL a resolución completa en eventos sin watermark (pre-bake)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/cart-preview-fullres-free-events`
- **OpenSpec change:** —  (superficie de pagos/seguridad → `/code-review` antes de commitear)
- **PR:** —

## Requerimiento
Hallazgo CONFIRMED del `/code-review high` de T-131 (pre-existente; T-131 lo dejó fuera de alcance a
propósito — su DoD decía "eventos gratis / sin watermark conservan el comportamiento actual"). Para
eventos con `watermark_enabled = false` pero **con `price_per_photo`** (el fotógrafo vende sin marca de
agua), el fallback pre-thumbnail de `getPhotoPreviewUrls` firma el **original a resolución completa**
(`useWatermark: false`, señal de 1h) del bucket privado `photos`. En estado estacionario el carrito y
las galerías nunca muestran el original: sirven la variante **medium** reducida vía `/api/thumb`. Así
que la ventana pre-bake expone estrictamente más (full-res sin pagar) que el estado estacionario para
esos eventos — un comprador puede abrir la URL firmada desde devtools y guardarse el original vendible.

T-131 cerró exactamente esta ventana para eventos **watermarked** (los enruta por `/api/watermark/`).
Este ticket es el gemelo de resolución: eventos de pago sin watermark también deben degradar a algo que
no sea el original full-res antes de que hornee el thumbnail.

## Criterio de aceptación (Definition of Done)
- [ ] Para fotos de eventos con `price_per_photo` (vendibles) y thumbnail pendiente, el fallback del
      carrito **no** expone el original a resolución completa aunque `watermark_enabled = false`.
      Opciones a decidir/documentar: firmar una variante reducida on-the-fly, servir placeholder hasta
      hornear, o reutilizar `/api/watermark/` sin patrón visible (degradado de calidad sin marca).
- [ ] Eventos genuinamente gratis (`price_per_photo` null/0) pueden conservar el comportamiento actual
      si se decide que no hay nada que proteger — decidir y documentar.
- [ ] Aplica a ambos carritos (comparten `getPhotoPreviewUrls` — un solo punto de cambio).
- [ ] Test de regresión: foto vendible de evento sin watermark con thumbnail pendiente → la URL resuelta
      no es un signed URL directo del original full-res (falla antes, pasa después).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Origen: `/code-review high` de T-131 (PR pendiente al crear este ticket). Finding hermano cerrado: T-131.
- El invariante de CLAUDE.md ("Full resolution only accessible via short-lived signed URLs **after
  purchase**") aplica a **todo** evento vendible, no solo a los watermarked — de ahí que esto sea un gap
  real y no solo una preferencia estética.

## Constraints
- Un solo criterio compartido en `getPhotoPreviewUrls` — no bifurcar por carrito. Sin otros cambios.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cart-preview-fullres-free-events`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
