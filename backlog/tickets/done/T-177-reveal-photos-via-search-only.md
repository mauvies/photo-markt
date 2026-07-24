# T-177 · [PLAN] Setting por evento: revelar fotos solo vía búsqueda facial/dorsal

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno — **PERO requiere modo PLAN + aprobación antes de implementar** (feature de control de acceso). NO ejecutar autónomamente con `/work-next`.
- **Rama:** `feat/reveal-photos-via-search-only`  (tipo = feat | fix | chore | refactor)
- **OpenSpec change:** requerido (>1 archivo, seguridad/control de acceso) — `/opsx:propose` al arrancar.
- **PR:** —

## Requerimiento
Nuevo setting por evento donde el evento **es públicamente descubrible pero sus fotos NO son
navegables**. Las fotos solo se revelan a un visitante que se identifica vía **búsqueda facial**
(selfie) o, opcionalmente, **número de dorsal**. Sirve a privacidad (los atletas no son navegables
por extraños) y engagement. Patrón establecido en otras plataformas de foto deportiva.

### Parte 1 — El setting
- Opción por evento, p. ej. "Reveal photos only through search" / "Mostrar fotos solo mediante búsqueda",
  configurable en el **wizard de creación** y en **settings del evento**.
- Sub-opción: qué métodos desbloquean — **face-only** o **face + dorsal**. El fotógrafo elige (dorsal es
  baja entropía y enumerable; youth sports → face-only; carrera masiva → dorsal conviene). No hardcodear.
- Distinguir claramente del concepto **evento privado/share-code**: ese gatea el **acceso al evento**;
  este gatea la **visibilidad de las fotos** dentro de un evento por lo demás público. Deben coexistir sin
  conflicto — documentar cómo interactúan.

### Parte 2 — Enforcement (lo crítico)
- **Server-side y fail-closed.** Con el setting on, los registros de foto de ese evento **no** deben
  volver en queries/respuestas a un visitante que no probó un match. Ocultar el grid en cliente enviando
  igual los datos **no** es aceptable (trivial de bypassear por el network tab).
- Misma filosofía fail-closed que `needsProtectedPreview`: estado desconocido/no-probado ⇒ "oculto", nunca "visible".
- El reveal es **acotado**: probar un match revela **las fotos matcheadas**, no el evento entero.
- Definir cómo se representa un match probado y cuánto persiste (sesión / por request / almacenado).
  Considerar reusar el modelo de prueba per-item `cart_items.access_share_code` (T-134). Reportar el
  enfoque elegido y sus propiedades de seguridad.
- El page del evento sigue renderizando público (título, portada, fotógrafo, fecha, punto de entrada de
  búsqueda) — solo las fotos se gatean.

### Parte 3 — Qué ve el visitante
- El punto de entrada de búsqueda es la **acción primaria** (no secundaria), con copy claro de que las
  fotos se revelan mediante búsqueda.
- Estado gateado **intencional y explicativo**, no un grid vacío que parezca roto.
- Tras una búsqueda exitosa, las fotos matcheadas aparecen con las protecciones de preview **intactas**
  (watermark, face blur, protección de menores).

### Parte 4 — Impacto en los controles de costo de IA (reportar, no adivinar)
- Estimar el cambio en calls-por-visitante de un evento gateado vs uno normal (browsing forzado a face
  search ⇒ mucho más Rekognition por evento).
- Evaluar si los caps de T-034 (per-event/día default 1000, global/día default 2000) siguen siendo
  apropiados para un evento gateado real; recomendar valores o un **override por evento**.
- Flag si esto vuelve más urgente la decisión de **CAPTCHA diferida (T-141)** — su tripwire era
  explícitamente "revisitar cuando se suba el cap global para un evento real", y esta feature puede forzar eso.

### Parte 5 — Enumeración de dorsales
- Si el desbloqueo por dorsal está on, evaluar: ¿el rate limit actual `(shareCode, IP)` 30/h basta para
  hacer impráctica la enumeración? Qué expondría una enumeración exitosa (previews watermarked y
  face-blurred — exposición limitada pero no-cero). Recomendar si se justifica mitigación adicional para
  eventos gateados **sin** implementar CAPTCHA en este ticket.

## Criterio de aceptación (Definition of Done)
- [ ] Setting por evento existe (wizard + settings), con sub-opción de qué métodos desbloquean.
- [ ] Enforcement server-side y fail-closed: las fotos gateadas **ausentes** de las respuestas hasta probar
      un match — verificado por **network tab**, no solo visualmente.
- [ ] El reveal es acotado a las fotos matcheadas, no al evento entero.
- [ ] Interacción con eventos privados/share-code documentada y sin conflicto.
- [ ] El page renderiza público con estado gateado claro e intencional y entrada de búsqueda prominente.
- [ ] Protecciones de preview (watermark, face blur, menores) intactas sobre las fotos reveladas.
- [ ] Reporte entregado: impacto de costo Rekognition + ajuste de caps recomendado + riesgo de enumeración de dorsal.
- [ ] Strings en `en.json` y `es.json`.
- [ ] Reusa la lógica existente de face search, bib search y preview-protection — sin paths paralelos.
- [ ] Sin `any`; formato Biome; queries en `/database/queries/`, mutaciones vía Server Actions.
- [ ] `/code-review` (obligatorio: control de acceso) antes de commit; considerar `/code-review ultra`.
- [ ] Test de regresión/feature (incl. el enforcement fail-closed) que falla antes y pasa después.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas — landscape ya investigado (para el plan)
**A. Schema/setting:** flags booleanos por evento se agregan como columnas de `public.events` vía migración
aditiva (`add column if not exists <flag> boolean not null default false`), patrón de `ai_matching_enabled`
(`20260518000003_...`) / `bib_detection_enabled` (`20260625000000_...`). Wiring end-to-end: insert en
`createEvent` (`src/database/queries/events.ts`), update en `updateEvent`, helpers de lectura tipo
`getEventRekognitionState` / `getEventBibDetectionState` (devuelven `null` si soft-deleted → fail-closed).
UI: wizard `events/new/steps/step-2-config.tsx` + action `events/new/actions.ts`; edit
`events/[id]/edit/components/event-form-fields.tsx` + `events/[id]/edit/actions.ts`. `contains_minors`
fuerza AI/bib off (patrón a espejar).

**B. Superficie de enforcement (queries de foto visitante-facing):** en `src/database/queries/photos.ts` —
`getEventPhotosPublic` (allowlist; ya usada como cross-ref por face/bib search), `getEventPhotosPublicPage`
(page-1 + load-more), `countEventPhotosByStatus`. El page público `events/[shareCode]/page.tsx` las llama
vía `getCachedEventData`. Actions que emiten fotos firmadas: `loadMoreEventPhotos`, `searchFacesInEvent`,
`searchPhotosByBibInEvent`, `getEventPhotoDownloadUrlAction`. **Hoy no hay gate que oculte el grid** — es la
superficie a gatear (las de browse deben devolver **nada** con el flag on; las de search ya cross-refean
contra `getEventPhotosPublic`).

**C. Reuso face/bib:** ambas en `events/[shareCode]/actions.ts`. `searchFacesInEvent(shareCode, selfieFormData)`
y `searchPhotosByBibInEvent(shareCode, bib)` devuelven el set **completo** de `matchedPhotos` firmados (no un
filtro del grid ya cargado). Cliente: `event-gallery-with-face-search.tsx` + `find-my-photos-banner.tsx` +
`public-event-photo-viewer.tsx` (que hace **unión** de grid ∪ matchedPhotos por id). O sea la mecánica de
"aparecen fotos fuera de la página 1 tras el match" ya existe y sirve para el reveal acotado.

**D. Patrones de prueba/acceso reusables:** `cart_items.access_share_code` (T-134, migración
`20260715000000_...`) — prueba per-item validada en vivo; helpers `isEventAccessible` /
`getAccessibleAuthedCartPhotoIds` en `photos.ts`. `needsProtectedPreview` (`src/lib/preview-protection.ts`)
= modelo fail-closed a espejar (default-deny salvo confirmación positiva). `resolveEventByParam`
(`events.ts`) resuelve privados **solo** por share code — el nuevo gate es **ortogonal** al gate de
`share_code`.

**E. Costo IA (T-034):** `src/lib/face-search-limits.ts` — `AWS_CALLS_PER_FACE_SEARCH=1`; caps por env
`FACE_SEARCH_GLOBAL_DAILY_CALLS` (default 2000), `FACE_SEARCH_EVENT_DAILY_CALLS` (default 1000),
`FACE_SEARCH_ALERT_EMAIL`. Tres tiers en `searchFacesInEvent`: (1) `(event,IP)` 10/h, (2) per-event/día,
(3) global/día breaker + alerta 50%. Bib rate limit `(shareCode, IP)` 30/h (DB puro, sin AWS).

**Familia/relacionados:** T-034 (caps), T-141 (CAPTCHA tripwire — este ticket puede subir su prioridad),
T-134 (access_share_code), T-133/T-136 (preview protection). Reviewer: verificar enforcement por network tab
(no visual), reveal acotado, e impacto en caps de T-034.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. **PLAN primero (aprobación del usuario) + `/opsx:propose`** — control de acceso, no autónomo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
