# T-142 · Proteger fotos compradas ante el borrado del fotógrafo (Option A: soft-delete + retener)

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno  (follow-up de PR #202, pero toca código distinto — no bloquea)
- **Rama:** `feat/protect-purchased-photos-from-deletion`  (tipo = feat)
- **OpenSpec change:** sí  (toca migración/BD + un path de borrado adyacente al cobro — capturar diseño antes)
- **PR:** —

## Requerimiento
La parte de **protección ante borrado** del ticket CRÍTICO original (Part 3). PR #202 arregló el lado de
**visualización/RLS** (el comprador ya ve y descarga sus fotos compradas); esto arregla el lado de
**borrado**: la posesión del comprador debe ser robusta y permanente sin depender de que el FK + una guarda
de app estén siempre bien puestos.

**Estado actual (verificado):** las fotos compradas **no son destruibles hoy** — `order_items.photo_id` y
`guest_order_items.photo_id` son `ON DELETE RESTRICT`, y `deleteEventAction` ya excluye las fotos vendidas
(conserva filas + storage, solo soft-borra el evento). Los huecos reales: (a) los paths de borrado de foto
**individual/bulk/colaborador** no son purchase-aware → borrar una foto vendida falla con un error crudo del
FK (feo, pero **sin pérdida de datos**); (b) la descarga ZIP del comprador da **404** tras soft-delete del
evento porque la ruta filtra por `events.deleted_at IS NULL`.

**Enfoque = Option A (soft-delete + retener), NO Option B (copy-on-purchase).** Justificación: el FK
`ON DELETE RESTRICT` ya hace las fotos del comprador físicamente indestructibles, así que el riesgo de A
("falla en silencio si una query olvida el filtro `deleted_at`") solo afecta la **visibilidad del lado
fotógrafo**, nunca el acceso del comprador. B duplicaría storage y añadiría todo un subsistema de copia con
reintentos para resolver un problema que el FK ya resuelve. (Con 0 ventas reales en prod, no hay urgencia de
pérdida de datos — es endurecimiento antes de la primera venta real.)

## Criterio de aceptación (Definition of Done)
- [ ] **Migración:** `photos.deleted_at timestamptz null` (+ índice parcial `where deleted_at is null`). El FK
      `ON DELETE RESTRICT` se conserva como backstop duro. (Lleva migración → el preview build de Vercel falla
      hasta aplicarla a prod vía merge a main / `migrate.yml`.)
- [ ] **Todos los paths de borrado son purchase-aware** vía un check por-foto `isPhotoSold` sobre
      `order_items` + `guest_order_items` (admin client, reusando la idea de `getSoldPhotoIdsForEvent`):
  - [ ] `deletePhotoAction` (`.../events/[id]/edit/actions.ts`), el fan-out bulk en `event-photo-album.tsx`, y
        `deleteContributorPhotoAction` (`events/[shareCode]/actions.ts`): si está vendida → **soft-delete**
        (`deleted_at = now()`, conservar storage) y devolver un resultado elegante ("conservada para el
        comprador") en vez del error crudo del FK; si no → hard-delete + remove de storage como hoy.
  - [ ] `deleteEventAction`/`deleteEventPhotos` ya excluyen las vendidas del hard-delete — extender para
        **estampar `deleted_at`** también, así salen de las vistas del propio fotógrafo.
- [ ] **Enumeración de queries (obligación de Option A):**
  - **EXCLUIR `deleted_at IS NOT NULL`** (superficies fotógrafo/público/búsqueda/carrito): `getEventPhotosPublicPage`
    + load-more, vista talent del evento, álbum del dashboard del fotógrafo, mapeo de resultados de búsqueda
    por cara/dorsal, add al carrito (`getPurchasablePhotoIds`), resolvers de portada/`og:image`, keying del
    orphan-cleanup.
  - **INCLUIR soft-deleted** (el comprador conserva acceso): `getTalentPurchasedPhotos`, `getTalentClaimedPhotos`,
    `getPhotoDownloadUrl`, previews de órdenes, y la ruta de descarga ZIP.
- [ ] **Acceso del comprador tras el borrado:** `/api/events/[id]/download/route.ts` no debe filtrar los ítems
      **comprados** del comprador por `events.deleted_at IS NULL`.
- [ ] **Cuota de storage:** las fotos vendidas-retenidas no cuentan contra la cuota del fotógrafo (son de facto
      del comprador) — N/A si aún no hay cuota; anotarlo.
- [ ] **Nunca** borrar/alterar `orders` / `order_items`. El teardown de índice de cara/dorsal de una foto
      borrada puede proceder; solo se preserva el acceso del comprador.
- [ ] **Fallback (Part 4):** conservar el "Photo no longer available" / "Foto no disponible" existente (T-116)
      para el caso —ahora prácticamente imposible— de foto genuinamente perdida.
- [ ] strings nuevos en `en.json` y `es.json` (el aviso "conservada para el comprador" del flujo de borrado).
- [ ] **E2E:** comprar una foto → borrar el evento/foto como fotógrafo → el comprador la sigue viendo en
      perfil + órdenes y puede descargarla; la foto desaparece de la galería pública, búsqueda, carrito y del
      dashboard del fotógrafo. Tests de regresión por cada path de borrado (vendida → soft-delete + retenida;
      no vendida → hard-delete) y del e2e de acceso-tras-borrado.
- [ ] `/code-review` sobre el diff antes de commitear (toca BD/migración + path adyacente al cobro).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` (+ `pnpm build`) en verde.

## Notas
- Follow-up de **PR #202** (`fix/purchased-photos-buyer-visibility`), que cerró el lado display/RLS (Parts 1–2
  del ticket original). Este ticket es Part 3 (+ el fix de acceso ZIP tras borrado, que solapa con Part 4).
- No solapa con ningún ticket existente del backlog.
- Investigación completa en el plan de la sesión: `~/.claude/plans/critical-purchased-photos-not-lovely-key.md`.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/protect-purchased-photos-from-deletion`.
2. `/opsx:propose` para generar el change (toca BD/migración) → `/opsx:apply`.
3. Implementar + tests de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. `/code-review` sobre el diff (BD/migración + cobro) y arreglar los findings reales.
6. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
7. `git push -u origin <rama>`.
8. `gh pr create --draft` apuntando a `main`.
9. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
10. `/opsx:archive`.
