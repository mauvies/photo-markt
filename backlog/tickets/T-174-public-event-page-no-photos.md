# T-174 · La página pública del evento muestra 0 fotos aunque el dashboard del fotógrafo dice 35

- **Prioridad:** P2
- **Estado:** done

## Resolución (hallazgo del paso 1 + fix)
**No es bug de la página pública** — su query es correcta (approved-only). Diagnóstico definitivo del
ciclo de vida de `upload_status` (verificado en código):
- Toda subida del owner entra `pending` en el insert (`attachPhotosToEvent` → `createPhoto` con
  `upload_status: 'pending'` hardcodeado) y **solo el worker Inngest `indexPhotoFaces`** la promueve a
  `approved` (step 3 `promote-upload-status`). Si el worker no corre (local sin worker levantado, o el
  fallo de "Inngest prod sync drift"), las fotos del owner quedan `pending` **para siempre** → la pública
  (approved-only) muestra 0. Es hipótesis **1b** del ticket: **entorno/worker**, no bug de código.
- **No se pudo verificar el evento reportado en datos:** un `db:reset` (necesario para los grants de los
  tests de integración) borró la BD local; solo quedó el evento de seed. La pública sigue siendo correcta
  por diseño, así que se cerró por la vía UX (path 1 del DoD).

**Fix (mejora de claridad UX, no toca el contrato de visibilidad):** en el dashboard del fotógrafo, para
eventos **solo** (no-moderación, donde el grid mezcla approved+pending bajo un único "N fotos"), se
añadió un aviso `PhotosProcessingNotice` que desglosa cuántas están **públicas ahora** vs cuántas **aún se
están procesando** (approved vs pending), para que "35 fotos" no se lea como fotos perdidas cuando la
pública muestra 0. Se renderiza solo cuando hay pendientes; los eventos de moderación ya desglosan esto
via la pestaña Pending. La pública sigue mostrando **solo** approved + `deleted_at IS NULL`.
- **Blockers:** ninguno (pero el **primer paso es verificar los `upload_status` en la BD** — de eso depende si es bug o estado esperado; ver DoD)
- **Rama:** `fix/public-event-no-photos`  (tipo = fix)
- **OpenSpec change:** —  (bug de visibilidad/estado; evaluar al ejecutar)
- **PR:** —

## Requerimiento (reporte del usuario)
> En **local**, no veo fotos de este evento en `/en/events/valida-los-caracas-surf-naiguata-2026`,
> pero en el **dashboard de fotógrafos**, al visitar el evento, sí veo que tiene **35 fotos**.

## Causa raíz (candidatos — verificados en código, falta confirmar en datos)
Las dos superficies cuentan/filtran distinto (mismo patrón approved-vs-total que **T-173**):
- **Página pública** (`src/app/[lang]/events/[shareCode]/page.tsx`): las fotos salen de
  `getEventPhotosPublicPage` + `countEventPhotosByStatus(['approved'])`, que filtran
  **`upload_status='approved'` AND `deleted_at IS NULL`** (`src/database/queries/photos.ts`). Solo
  approved.
- **Dashboard del fotógrafo** (`dashboard/photographer/events/[id]`): usa `countEventPhotos` = total
  **no-rejected** (approved **+ pending**), con `EventModerationTabs` para moderar las pending.

Que la pública muestre **0** y el dashboard **35** significa que el evento tiene **0 fotos `approved`** y
las 35 están en otro estado (casi seguro **`pending`**). Hipótesis por probabilidad:

1. **Las 35 están `pending` (dominante).** Dos sub-causas:
   - **`require_upload_approval=true`** en el evento → las fotos quedan `pending` hasta que el fotógrafo
     las **aprueba** manualmente en la moderación. Entonces la pública en 0 es **correcta** (aún no son
     públicas) — no es bug de código, es que faltan aprobar. Posible **hueco de UX**: el dashboard dice
     "35 fotos" sin dejar claro cuántas son **approved/públicas** vs **pending**.
   - **El worker de Inngest no está corriendo en local** → las subidas del owner (que van con
     `requireApprovalAfterValidation:false`) **nunca se promueven a `approved`** (esa promoción la hace
     el worker tras validar/indexar) y quedan `pending` para siempre. Público → 0. Es un problema de
     **entorno local**, no de la app. (Relacionado con la memoria "Inngest prod sync drift", pero aquí
     es local: verificar que el worker de Inngest esté levantado y procesando.)
2. **Fotos approved pero la pública igual muestra 0 → bug real.** Si al verificar la BD las fotos
   **sí** están `approved` y `deleted_at IS NULL`, entonces es un bug de verdad (posible **caching
   stale** de la página pública `'use cache'`/RSC — fotos aprobadas después de poblar el cache, sin
   revalidar la tag; o un mismatch de resolución del evento). Escalar a **P1** si bloquea ventas.
3. **Resolución del evento:** `getEventBySlug` exige `is_public=true`, así que si la página cargó por el
   slug, el evento **es público** (visibilidad descartada como causa). Confirmar que el usuario llega a
   la página (no 404) por el slug y no por otra vía.

## Criterio de aceptación (Definition of Done)
- [ ] **Paso 1 (decisivo):** en la BD **local**, para el evento del slug
      `valida-los-caracas-surf-naiguata-2026`, verificar: `events.is_public`, `require_upload_approval`,
      y el desglose `photos.upload_status` (cuántas approved / pending / rejected) + `deleted_at`.
      Documentar el hallazgo. (No se puede via MCP — es la BD local del usuario; correr en local.)
- [ ] Según el hallazgo:
      - **Si las 35 están `pending` por `require_upload_approval`** → no es bug de la pública (correcta).
        Cerrar como "esperado" y, si aplica, **mejorar la claridad de UX** en el dashboard del fotógrafo
        (dejar visible cuántas son approved/públicas vs pending, para que "35 fotos" no confunda) — mismo
        espíritu que el ítem de vista-fotógrafo de T-173.
      - **Si las 35 están `pending` porque el worker de Inngest no corre en local** → documentar que es
        entorno (levantar el worker / procesar la cola); no es bug de código. Opcional: mejorar el
        feedback en el dashboard de "N pendientes de procesar".
      - **Si las 35 están `approved` y la pública igual muestra 0** → **bug real**: reproducir, ubicar
        (caching stale / query / resolución) y arreglar + test de regresión. Escalar prioridad si
        bloquea ventas.
- [ ] Sin romper el contrato de visibilidad: la pública **debe** seguir mostrando solo `approved` +
      `deleted_at IS NULL` (no exponer pending/no-moderadas).
- [ ] test de regresión **según el caso**: si es bug real (approved no se muestran), test que falle antes
      / pase después; si es UX del dashboard, test source-level del nuevo desglose approved/pending.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **P2** — visibilidad en el funnel público de compra: si las fotos están approved y no se muestran, es
  **revenue-blocking** (subir a P1); si están pending, es estado esperado + posible confusión de UX
  (mantener P2/bajar a P3). El paso 1 decide.
- **Familia T-173** (approved vs total en colaborativos) — misma raíz "las superficies filtran por
  estado distinto", distinta cara (aquí: público 0 vs dashboard 35). **No** duplica T-173 (aquel era el
  contador "My photos" del talento).
- Reproducir en **local** (el usuario dijo "en local"); el evento vive en su Supabase local, no en
  prod/staging — la verificación del paso 1 se corre en local.
- Archivos: `src/app/[lang]/events/[shareCode]/page.tsx` (resolución + query pública),
  `src/database/queries/photos.ts` (`getEventPhotosPublicPage`, `countEventPhotosByStatus`),
  `dashboard/photographer/events/[id]/page.tsx` (`countEventPhotos`, `EventModerationTabs`),
  flujo de promoción a `approved`: `src/lib/inngest/functions/` + `upload-urls/actions.ts`.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. **Verificar `upload_status`/visibilidad en la BD local** (paso decisivo) antes de tocar código.
2. `git checkout main && git pull` → crear rama `fix/public-event-no-photos`.
3. Según el hallazgo: arreglar el bug real + test, o mejorar la claridad de UX del dashboard, o cerrar
   como entorno/esperado documentándolo.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
7. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
