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
| 1 | P2 | T-029 | Completar y traducir la página "Contacto" (`/contact`) | — | todo |
| 2 | P3 | T-032 | Implementar reconocimiento de número de dorsal (BIB) | — | todo |
| 3 | P3 | T-033 | Implementar prioridad en resultados de búsqueda por plan | — | todo |
| 4 | P3 | T-037 | Centralizar estructura de base de datos (`supabase/` raíz vs `src/database/`) | — | todo |
| — | P2 | T-034 | [DISEÑO] Modelo anti-abuso/coste de búsqueda facial (buscador anónimo vs plan del fotógrafo) | **blocked:** decisión de producto | blocked |
| — | P2 | T-001 | Subir concurrencia de indexado de caras (10–50) tras pasar a Inngest Pro | **blocked:** Inngest Pro | blocked |

### Clusters (tocan el mismo código — ejecutar contiguos y en orden)
- **Producción / lanzamiento:** ✅ completado — T-021 Términos (PR #78), T-022 Sentry (PR #79), T-023 Analytics (PR #80), T-024 Cookies (PR #81), T-026 Docs go-live (PR #82), T-025 Health endpoint (PR #83). No quedan tickets de este cluster.
- **Galería del evento (mobile):** T-007 → T-010 → T-008. T-007 reestructura la toolbar; los otros dos dependen de esa base.
- **Header / nav:** T-002 → T-003 → T-006. T-003 reusa el borde de T-002; T-006 oculta el header en mobile (coordinar con T-003).
- **Tabs:** T-004 (arregla el salto) → T-013 (restila todos los tabs, incluidos los de eventos destacados).
- **Páginas i18n/producción:** T-014 → T-015 → T-016 (hechas). Mismo patrón pendiente: **T-028 (`/about`) → T-029 (`/contact`)** — placeholders `staticPages.preparing` por completar; comparten `en.json`/`es.json`, ejecutar en serie con merge previo para evitar conflictos de diccionario. (Contacto: no duplicar el formulario que ya vive en `/support`.)
- **Independientes (sin cluster):** T-005, T-012, T-018, T-009, T-017, T-019, T-020. (T-018 reusa `pricing-section`/`lib/plans.ts`; T-019 es refactor de toda la raíz — ejecutar aislado, con el resto de la cola mergeada. T-020 es rename trivial.)

<!-- Añade filas con /ticket y recoloca según orden de ejecución (#). -->

## Archivo (done)

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

<!-- Los tickets completados se mueven aquí con su nº de PR. -->

## Descartados / revertidos

- **T-011** · Código de foto por evento — se mergeó (PR #66) y luego se **revirtió** (PR de revert). Poca utilidad como código interno del fotógrafo: texto libre duplicable que no identifica de forma fiable, y el valor real del dominio (número de **dorsal/BIB buscable por el atleta**) es un feature distinto, alineado con el "BIB number recognition" ya anunciado en los planes. Posible repensar como ticket nuevo orientado a talent + OCR.
