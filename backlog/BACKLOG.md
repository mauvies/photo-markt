# Backlog

Cola ordenada por **orden de ejecución** (`#`): se ejecuta de arriba hacia abajo, respetando prioridad
y dependencias. **El flujo completo (comandos, prioridades, estados, archivado, regla anti-conflicto)
vive en [`README.md`](./README.md).** Plantilla de ticket: [`TEMPLATE.md`](./TEMPLATE.md). Capturar con
`/ticket`, ejecutar con `/work-next`; el loop en serie es `scripts/run-backlog.sh`.

**Prioridad:** `P0` urgente · `P1` alta · `P2` normal · `P3` algún día. ·
**Estado:** `todo` · `blocked` · `doing` · `done` (al archivar: a la sección Archivo, y el archivo del
ticket a [`tickets/done/`](./tickets/done/)). · **Dep:** ejecutar después de ese ticket. Sin Dep = independiente.

| # | Pri | ID | Título | Dep | Estado |
|---|-----|------|--------|-----|--------|
| 4 | P2 | T-058 | [Bug] El estado de IA del evento dice "ready" mientras las fotos aún se indexan (debería decir "indexing") | — | todo |
| 5 | P2 | T-059 | Al crear evento: modal "continuar borrador en progreso" o "empezar de cero" (gestión del draft) | T-052 | todo |
| 6 | P2 | T-060 | Paginar la galería del detalle del evento (load more, ~50) en las 3 vistas — hoy firma/renderiza todas | — | todo |
| — | P2 | T-034 | [DISEÑO] Modelo anti-abuso/coste de búsqueda facial (buscador anónimo vs plan del fotógrafo) | **blocked:** decisión de producto | blocked |
| — | P2 | T-001 | Subir concurrencia de indexado de caras (10–50) tras pasar a Inngest Pro | **blocked:** Inngest Pro | blocked |

### Clusters (tocan el mismo código — ejecutar contiguos y en orden)
- **Producción / lanzamiento:** ✅ completado — T-021 Términos (PR #78), T-022 Sentry (PR #79), T-023 Analytics (PR #80), T-024 Cookies (PR #81), T-026 Docs go-live (PR #82), T-025 Health endpoint (PR #83). No quedan tickets de este cluster.
- **Galería del evento (mobile):** T-007 → T-010 → T-008. T-007 reestructura la toolbar; los otros dos dependen de esa base.
- **Header / nav:** T-002 → T-003 → T-006. T-003 reusa el borde de T-002; T-006 oculta el header en mobile (coordinar con T-003).
- **Tabs:** T-004 (arregla el salto) → T-013 (restila todos los tabs, incluidos los de eventos destacados).
- **Carrito:** ✅ completado — ~~T-038~~ (PR #92, ítems navegables/lightbox) → ~~T-039~~ (PR #93, sin parpadeo del merge) → ~~T-040~~ (PR #94, excluye eventos eliminados de carrito y favoritos). No quedan tickets de este cluster.
- **Páginas i18n/producción:** T-014 → T-015 → T-016 (hechas). Mismo patrón pendiente: **T-028 (`/about`) → T-029 (`/contact`)** — placeholders `staticPages.preparing` por completar; comparten `en.json`/`es.json`, ejecutar en serie con merge previo para evitar conflictos de diccionario. (Contacto: no duplicar el formulario que ya vive en `/support`.)
- **Independientes (sin cluster):** T-005, T-012, T-018, T-009, T-017, T-019, T-020. (T-018 reusa `pricing-section`/`lib/plans.ts`; T-019 es refactor de toda la raíz — ejecutar aislado, con el resto de la cola mergeada. T-020 es rename trivial.)

<!-- Añade filas con /ticket y recoloca según orden de ejecución (#). -->

## Archivo (done)

- **T-061** · Bug: el logo del dashboard llevaba al home público, y el middleware redirigía por `active_role`; como los layouts gatean por **capacidad** (no por `active_role`), un fotógrafo con `active_role=talent` desincronizado acababa en el dashboard de talento, que además podía entrar en bucle de redirección (`ERR_TOO_MANY_REDIRECTS`). El logo ahora apunta al home del rol actual vía `dashboardHomeForRole(activeRole)` (independiente de `active_role`); `/dashboard` desambigua por roles **realmente poseídos** (`resolveDashboardHome`, con fallback a un rol poseído para romper el bucle); onboarding gatea por rol poseído (no por `active_role`) para no rebotar a usuarios con onboarding parcial; `getRoleContext` lee rol activo + poseídos en un solo auth. Helper puro + tests de href del logo (fallan antes/pasan después) + casos de desincronía de `getRoleContext`. `/code-review high` aplicado (bucle de onboarding + round-trips redundantes) — PR #117

- **T-062** · Bug: la búsqueda por dorsal y facial fallaba con "Event not found" en eventos públicos abiertos por slug. El param de ruta `shareCode` puede ser UUID/slug/share_code, pero `searchPhotosByBibInEvent` y `searchFacesInEvent` resolvían solo por share code (`getEventByShareCode`) → los eventos públicos-solo (`share_code = null`, URL por slug) nunca se encontraban. Añadido `resolveEventByParam` (UUID → slug → share_code, mismo orden que la página) en `queries/events.ts`, usado por ambas acciones; visibilidad, gating de minors/AI/bib y rate-limits intactos. Tests de regresión en ambas acciones (evento público solo-slug) — PR #116

- **T-057** · Bug: el conteo de fotos en la tarjeta del evento del dashboard del fotógrafo crecía durante el procesamiento de Inngest. `getPhotosForEvents` filtraba `approved`-only; añadida `getPhotoCountsForEvents` (`pending+approved`, excluye `rejected`) para el contador de la tarjeta; `getPhotosForEvents` sigue siendo `approved`-only para la imagen de portada. Ambas queries en paralelo en el listado de eventos y en el overview del dashboard — PR #115

- **T-056** · Bug: tras reintentar una foto fallida el wizard quedaba atascado en el paso 4 (no navegaba al evento). `onRetryFailed` descartaba el resultado con `void`; ahora await-ea la respuesta, acumula `attachedCount` con `resolveRetryOutcome` (helper puro + 5 tests) y navega vía `goToEventRef` si no quedan fallos — PR #114

- **T-052** · Bug: config del paso 1 del wizard (AI matching / BIB) se pierde al refrescar. `form.reset(values)` modificaba `options.defaultValues`, que TanStack Form sobreescribía con `EMPTY_DEFAULTS` en el siguiente render; reemplazado por `form.setFieldValue()` por campo con `dontUpdateMeta/dontValidate/dontRunListeners`; `readStoredState` extraída a `wizard-storage.ts` para testabilidad + 8 tests de regresión — PR #113

- **T-055** · Foto de presentación / portada del evento (configurable al crear). Imagen **dedicada** (subida aparte de las fotos a la venta) → `events.cover_path`; subida owner-only validada al bucket `photos`, servida sin watermark vía signed URL; campo en el paso 2 del wizard (best-effort, no descarta el evento si falla — respeta T-054); los 6 builders + OG/JSON-LD de la página pública prefieren la portada con fallback a la primera foto; cron de limpieza excluye portadas (fail-safe) y el borrado de evento la elimina. OpenSpec `add-event-cover-image`; `/code-review high` aplicado — PR #112

- **T-054** · Bug: el evento se creaba igual aunque la subida fallara (eventos huérfanos). El wizard persiste el evento antes de subir (necesita el `eventId` para las signed URLs); si la subida terminaba en `error`/`cancelled` sin nada adjuntado, el evento quedaba huérfano. Ahora se soft-borra vía `deleteEventAction` (helper puro `shouldDiscardCreatedEvent` + test) conservando el form en memoria para reintentar; errores de creación/plan pasan a toasts (sonner) en vez de texto rojo inline — PR #111

- **T-051** · Bug: subida de evento con 258 fotos fallaba con "The related resource does not exist"; `createSignedUploadUrls` limitado a 10 concurrentes con `runWithConcurrency` — PR #109

- **T-050** · Ver saldo real de Stripe Connect (disponible / en camino) + próximo depósito — **ya implementado en `main`, sin PR nuevo**. La pestaña Ganancias (`/dashboard/photographer/sales?tab=earnings`) ya muestra "Stripe available" + "Stripe pending" (live vía `stripe.balance.retrieve`) y el payout schedule. Captura imprecisa; cerrado como already-done (ver commit `0317cb9`). Gap menor no perseguido: fecha exacta del próximo payout (hoy texto "every Monday" hardcodeado)

- **T-037** · Estructura de DB: se documenta el split deliberado (infra `supabase/` CLI-bound en la raíz vs código de app `src/database/` bajo `src/` por T-019) en vez de mover archivos —mover choca con el CLI y con T-019—. `ARCHITECTURE.md` §2.1 + un `README.md` en cada dir que apunta al otro. Doc-only, sin mover nada — PR #108

- **T-049** · Error/not-found boundaries traducidos (es/en): bloques `errorPage`/`notFound` en ambos diccionarios; `[lang]/error.tsx` y `[lang]/not-found.tsx` derivan locale del pathname (fuera del provider); `GlobalError` raíz y root `not-found` detectan locale por cookie `preferred-locale` (GlobalError post-mount para evitar hydration mismatch); helpers puros `localeFromPathname`/`localeFromCookie` + tests de paridad — PR #107

- **T-048** · Tab activo correcto en `/settings/payout-profile`: helper puro `resolveActiveSlug(pathname, sections)` (match exacto → subruta anidada → mapa de rutas hermanas `payout-profile → payouts`, con guard para el shell de talent) reemplaza el match por igualdad exacta que caía a `sections[0]` (Perfil) — PR #106

- **T-045** · Checkout de upgrade blindado: toda llamada a Stripe en `createBillingCheckoutAction` devuelve un código de dominio limpio (`checkout_failed` / `yearly_unavailable`) en vez de dejar propagar el error crudo (Next lo redacta en prod). Chequeo explícito del error de `insert` (evita customer huérfano), mensaje distinto y accionable para yearly-no-configurado, y toasts traducidos prop-drilled (el subárbol no tiene `TranslationsProvider`) — PR #104

- **T-047** · Toggle de detección por dorsal movido al wizard paso 1 y formulario de edición; eliminado de la página de detalle — PR #103

- **T-046** · Salto de página al eliminar foto del preview de subida: `filePreviews` como fuente de verdad; URLs creadas/revocadas por archivo (no regeneradas todas) — PR #102

- **T-033** · ~~Prioridad en resultados de búsqueda por plan~~ — **descartado** (decisión de producto, 2026-06-26). No se implementará; las features anunciadas "Priority/Highest priority in search results" se retiraron del pricing (`pricingSection.*Feature7`), de `plan-features.ts` y de sus tests. Nunca hubo lógica de ranking por plan en las queries, así que no quedó código que limpiar.

- **T-044** · Readiness endpoint `/api/health/ready` (sondas read-only por servicio, token + rate-limit, sin filtrar errores) + dashboard admin `/dashboard/admin/status` + `docs/monitoring.md` para monitor externo — PR #99

- **T-032** · Reconocimiento de dorsal (BIB): opt-in por evento + Rekognition `DetectText` (Inngest) + `photo_bib_numbers` + búsqueda de talent por dorsal en la galería pública; badge "Coming soon" retirado. Diseño OpenSpec `add-bib-number-recognition` (24 tareas) — PR #97 (backend+opt-in+acción) + PR #98 (UI búsqueda+ship)

- **T-042** · Bulk "Agregar a favoritos" deduplica las ya favoritas y reporta el conteo real (info "ya en favoritos" si ninguna es nueva); helper puro `filterNewIds` compartido con el bulk del carrito — PR #96

- **T-041** · Ocultar el botón "Descargar" muerto del modo selección en eventos de pago sin compras: helper compartido `shouldShowBulkDownload` (free ∨ compradas) usado por visor de talento y público — PR #95

- **T-040** · Excluir eventos soft-deleted del carrito y favoritos: filtro `events.deleted_at IS NULL` en `getCartItemsWithDetails`/count y `getTaggedPhotosForTalent`/count + rechazo al agregar/mergear; biblioteca comprada intacta — PR #94

- **T-039** · Merge carrito invitado→autenticado sin parpadeo: skeleton gatea todo el carrito (helper puro `cartView`, `merging` gana sobre lista) + timeout de seguridad; tests de `mergeGuestCartAction` (unión/dedup) — PR #93

- **T-038** · Ítems del carrito navegables: lightbox close-only de la foto + enlaces a evento (`/events/[shareCode]`) y fotógrafo (`/photographer/[slug]`); query enriquecida con `share_code` + slug — PR #92

- **T-043** · Mobile: zoom-in fantasma al cargar (`w-screen`→`w-full` en `Main`) + `viewport-fit=cover`; arregla la posición de bottom nav y toolbar de selección — PR #91

- **T-004** · Empty state + altura estable en tabs de eventos destacados (home) — PR #58
- **T-005** · Redirect server-side de la home al dashboard por rol — PR #59
- **T-012** · Fotos compradas sin watermark (signed URL original) en pedidos — PR #60
- **T-014** · Página de soporte: i18n completo + contenido corregido + form real — PR #61
- **T-015** · Página de feedback: i18n completo + roadmap corregido (AI Live) — PR #62
- **T-016** · Privacy policy pública escrita y traducida (es+en) — PR #63
- **T-007** · Toolbar de galería sticky única en mobile (sin salto) + favorito reubicado — PR #64
- **T-018** · Features detalladas por plan en facturación (fuente única i18n compartida) — PR #65
- **T-010** · Quitar descarga masiva en galería pública con watermark (solo eventos gratis) — PR #68
- **T-008** · Galería del evento full-width en mobile (grid sangra a los bordes; toolbar queda) — PR #69
- **T-002** · Pulir diseño del language toggler dropdown (rounded-xl, banderas text-xs) — PR #70
- **T-003** · Borde fino gris en el avatar del header (`border border-input`, igual que el toggler) — PR #71
- **T-006** · Carrito como tab en la bottom nav de talento (mobile) + header oculto en mobile — PR #72
- **T-013** · Tabs underline estándar en toda la app (variante `line` por defecto, subrayado primary) — PR #73
- **T-009** · Lightbox: transición carrusel (slide), sin contador, flechas solo desktop (swipe en mobile) — PR #74
- **T-017** · Íconos lápiz/basura en el dropdown de acciones de tarjetas de evento (fotógrafo) — PR #75
- **T-019** · Mover código fuente a `src/` (convención Next); raíz solo configs/docs/public/test — PR #76
- **T-020** · Renombrar claves localStorage del wizard `picdemi_` → `photo-markt_` (dir local: manual) — PR #77
- **T-021** · Términos de Servicio: contenido real production-ready + i18n (es+en) — PR #78
- **T-022** · Monitoreo de errores con Sentry (gated por DSN, no-op sin DSN, PII off) — PR #79
- **T-023** · Vercel Web Analytics + Speed Insights (wrapper `WebAnalytics` en layout) — PR #80
- **T-024** · Banner de consentimiento de cookies (GDPR) que gatea analytics; preferencias en footer — PR #81
- **T-026** · Checklist de go-live + `docs/deployment.md`; arregla enlace roto del README — PR #82
- **T-025** · Health check endpoint `/api/health` (liveness puro, `no-store`) — PR #83
- **T-027** · Cookies granulares: panel "Personalizar" con consentimiento por categoría + migración legacy — PR #84
- **T-031** · Enlaces a Términos/Privacidad en aviso de `/signup` + corrige copy "Supabase"→Photo Markt — PR #85
- **T-030** · Congruencia pricing↔lógica: free AI quota 100→10, fee de fuente única, badges coming-soon, test de guardia — PR #86
- **T-036** · Quitar cuota mensual de búsqueda IA a medias + drop `ai_search_usage` huérfano (rediseño en T-034) — PR #87
- **T-035** · Consolidar el flujo de backlog/tickets en `backlog/` (un solo dir) + separar `done/`; README único del flujo — PR #88
- **T-028** · Página "Sobre nosotros" (`/about`) production-ready + i18n (es+en), bloque `aboutPage` + test de paridad — PR #89
- **T-029** · Página "Contacto" (`/contact`) production-ready + i18n (es+en), bloque `contactPage` (emails mailto, sin duplicar `/support`) + test de paridad — PR #90

<!-- Los tickets completados se mueven aquí con su nº de PR. -->

## Descartados / revertidos

- **T-011** · Código de foto por evento — se mergeó (PR #66) y luego se **revirtió** (PR de revert). Poca utilidad como código interno del fotógrafo: texto libre duplicable que no identifica de forma fiable, y el valor real del dominio (número de **dorsal/BIB buscable por el atleta**) es un feature distinto, alineado con el "BIB number recognition" ya anunciado en los planes. Posible repensar como ticket nuevo orientado a talent + OCR.
