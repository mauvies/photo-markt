# T-136 · Seguridad/Pagos: las galerías (no el carrito) siguen firmando el ORIGINAL full-res pre-bake en eventos vendibles sin watermark + índice para `photos.original_url`

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/gallery-prebake-fullres-free-events`
- **OpenSpec change:** — (superficie de pagos/seguridad → `/code-review` antes de commitear; el índice es una migración additive trivial)
- **PR:** #196

## Requerimiento
Hallazgo CONFIRMED del `/code-review high` de T-133. T-133 cerró la ventana pre-bake para el **carrito**
(`getPhotoPreviewUrls` enruta todo lo vendible por `/api/watermark/`, que ahora decide el tratamiento
server-side: tiles para watermarked, downscale limpio del presupuesto medium para vendible-sin-marca).
Pero las **galerías** siguen con el criterio viejo — `useWatermark: event.watermark_enabled === true` —
así que para un evento **vendible sin watermark** con thumbnail pendiente firman el **original full-res**
directo y lo ponen en el tile. Superficies (todas comparten el patrón):

- `src/app/[lang]/events/[shareCode]/page.tsx:175` (galería pública) y `actions.ts:156` (load-more)
- `src/app/[lang]/dashboard/talent/events/[id]/page.tsx:114` (vista talent del evento)
- `src/app/[lang]/dashboard/talent/actions.ts:59` y `favorites/actions.ts:68` (fotos guardadas)

Es exactamente el leak de T-133 en una superficie **más descubrible** que el carrito (la galería pública).
El fix del lado ruta ya existe (T-133): basta cambiar el criterio de cada call site de
"¿watermarked?" a "¿hay algo que proteger?" (watermarked O vendible), idealmente extrayendo el predicado
compartido para no re-derivarlo cinco veces. Los eventos genuinamente gratis y sin watermark conservan el
sign directo (decisión documentada en T-133).

## Además (mismo review, hallazgo de eficiencia)
`photos.original_url` no tiene índice y la ruta `/api/watermark/` (no autenticada) lo filtra en cada
CDN-miss (`getPreviewPolicyByStoragePath`; antes también `getPhotoFaceBoxesByStoragePath`, hoy fusionadas
en una sola query). Con la tabla creciendo, cada miss es un seq scan. Añadir
`create index if not exists photos_original_url_idx on photos (original_url);` — migración additive.
**Ojo:** los PRs con migración fallan el preview build de Vercel hasta aplicar la migración a prod
(ver memoria del repo / `migrate.yml` solo corre en merge a main).

## Criterio de aceptación (Definition of Done)
- [ ] Predicado compartido "necesita protección pre-bake" (watermarked O `price_per_photo > 0`) aplicado
      en las cinco superficies de galería listadas — pre-bake enrutan por `/api/watermark/` en vez de
      firmar el original directo. Gratis+sin-watermark conserva el sign directo.
- [ ] Migración: índice sobre `photos.original_url`.
- [ ] Test de regresión (falla antes, pasa después): galería pública de un evento vendible sin watermark
      con thumbnail pendiente → el tile NO es un signed URL directo del original.
- [ ] Actualizar la línea de CLAUDE.md (§Image Handling) que hoy documenta el gap de galerías como
      pendiente (T-136) — pasa a estar cerrado.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde (+ `pnpm build`: toca queries compartidas).

## Constraints
- Reusar la ruta y el predicado de T-133 — no inventar otro mecanismo de protección.
- El índice es la única migración; nada de cambios de esquema adicionales.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/gallery-prebake-fullres-free-events`.
2. Implementar + test de regresión.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. `/code-review` (seguridad/pagos) sobre el diff; arreglar findings reales.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main` (título/cuerpo en inglés).
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
