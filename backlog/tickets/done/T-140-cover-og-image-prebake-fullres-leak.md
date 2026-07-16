# T-140 · Seguridad/Pagos: el fallback de portada de las event cards y el `og:image` del evento público firman el ORIGINAL full-res de la primera foto en eventos con fotos en venta

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/cover-og-image-prebake-fullres-leak`
- **OpenSpec change:** — (superficie de pagos/seguridad → `/code-review` antes de commitear)
- **PR:** #199

## Requerimiento
Hallazgos CONFIRMED del `/code-review high` de T-136 — la misma clase de leak que
T-131/T-133/T-136 cerraron (galerías + carrito), en dos superficies que ese ticket no tocó:

1. **Fallback de portada de las event cards.** Cuando un evento no tiene `cover_path` dedicado,
   `resolvePublicEventCoverStats` (`src/lib/event-cover-stats.ts`) usa el `original_url` de la
   **primera foto** como portada, y los tres consumidores lo firman **directo** (sin ruta watermark):
   - `src/app/[lang]/dashboard/talent/events/actions.ts:92` (explore de talento)
   - `src/app/[lang]/actions/saved-events.ts:145` (eventos guardados)
   - `src/app/[lang]/photographer/[slug]/actions.ts:103` (perfil público del fotógrafo)
   El payload de la card lleva un `/storage/v1/object/sign/` al original full-res payment-gated —
   descargable desde devtools sin pagar (`coverUrl` viaja incluso cuando `coverThumbUrl` existe).

2. **`og:image` del evento público.** `generateMetadata` en
   `src/app/[lang]/events/[shareCode]/page.tsx` (~línea 254): sin cover dedicado, firma el original
   de la primera foto en venta por **24 h** y lo pone en `<meta property="og:image">` — view-source
   o cualquier scraper OG obtiene el full-res sin pagar, mientras los tiles de la galería de la misma
   foto ya van por `/api/watermark/`.

CLAUDE.md (§Image Handling) documenta este gap como "Known remaining gap (T-140)".

## Criterio de aceptación (Definition of Done)
- [ ] Ambas superficies deciden con el predicado compartido `needsProtectedPreview`
      (`src/lib/preview-protection.ts`): si la foto-portada necesita protección, servir la ruta
      `/api/watermark/` (o el thumb horneado) en vez del sign directo del original. Evento
      genuinamente gratis (precio null) y sin watermark conserva el sign directo.
- [ ] Test de regresión (falla antes, pasa después) por superficie: evento vendible sin watermark
      sin `cover_path` → ni la card ni el `og:image` exponen un signed URL directo del original.
- [ ] Actualizar la línea "Known remaining gap (T-140)" de CLAUDE.md — pasa a estar cerrado.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde (+ `pnpm build` si toca queries/lib compartidos).

## Constraints
- Reusar la ruta `/api/watermark/` y el predicado de T-136 — no inventar otro mecanismo.
- Ojo con el tamaño del og:image: la ruta watermark sirve un derivado razonable (medium); si se
  prefiere el thumb horneado para OG, que el fallback pre-bake siga siendo fail-closed.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cover-og-image-prebake-fullres-leak`.
2. Implementar + test de regresión.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. `/code-review` (seguridad/pagos) sobre el diff; arreglar findings reales.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main` (título/cuerpo en inglés).
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
