# T-131 · Seguridad/Pagos: el fallback de preview del carrito sirve el original SIN watermark antes de que hornee el thumbnail

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/cart-preview-watermark-fallback`
- **OpenSpec change:** —  (tocará el criterio de watermark — evaluar al ejecutar; es superficie de pagos/seguridad → `/code-review` antes de commitear)
- **PR:** —

## Requerimiento
Hallazgo CONFIRMED del `/code-review high` de T-130 (pre-existente desde el carrito original / T-115;
T-130 lo centralizó en `getPhotoPreviewUrls` sin cambiar el criterio). El fallback de preview del
carrito — cuando `thumbnail_status != 'ready'` (recién subida, bake fallido, o legacy sin thumbnail) —
firma el **original a resolución completa SIN watermark** (`useWatermark: false`, señal de 1h) y lo pone
en el `<img src>` del carrito (autenticado e invitado). Para eventos de pago con `watermark_enabled`,
cualquier comprador puede abrir la URL desde devtools y guardarse el original sin pagar — viola el
invariante de CLAUDE.md: "Full resolution only accessible via short-lived signed URLs **after purchase**".
El thumbnail horneado SÍ va watermarked para eventos de pago (contrato de `generateThumbnail`), así que
el fallback es estrictamente más débil que el estado estacionario.

## Criterio de aceptación (Definition of Done)
- [ ] Para fotos de eventos con `watermark_enabled`, el fallback pre-thumbnail del carrito **nunca**
      expone el original sin watermark: servir vía `/api/watermark/` (`createPhotoUrls` ya soporta
      `useWatermark: true` + `baseUrl`, con fail-closed) o placeholder hasta que hornee — decidir y
      documentar.
- [ ] Eventos gratis / sin watermark conservan el comportamiento actual (no hay nada que proteger).
- [ ] Aplica a ambos carritos (comparten `getPhotoPreviewUrls` — un solo punto de cambio).
- [ ] Test de regresión: foto de evento watermarked con thumbnail pendiente → la URL resuelta no es
      un signed URL directo del original (falla antes, pasa después).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Origen: `/code-review high` de T-130 (PR pendiente al crear este ticket). Findings hermanos: T-132.
- `getPhotoPreviewUrls` necesitará `watermark_enabled` del evento (join) o recibirlo del caller.
- El watermark on-the-fly por `/api/watermark` es más pesado que el signed URL — el thumbnail ready
  sigue ganando; esto solo afecta la ventana pre-bake.

## Constraints
- Un solo criterio compartido en `getPhotoPreviewUrls` — no bifurcar por carrito. Sin otros cambios.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cart-preview-watermark-fallback`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
