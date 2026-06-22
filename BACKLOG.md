# Backlog

Cola ordenada por **orden de ejecución** (`#`): se ejecuta de arriba hacia abajo. El orden respeta
prioridad y dependencias, de modo que ningún ticket bloquea al siguiente si se ejecutan en este orden.
Flujo de cada ticket: ver `tickets/TEMPLATE.md`. Capturar con `/ticket`, ejecutar con `/work-next`.

**Prioridad:** `P0` urgente · `P1` alta · `P2` normal · `P3` algún día.
**Estado:** `todo` · `blocked` · `doing` · `done` (al terminar se mueve a la sección Archivo).
**Dep:** ejecutar después de ese ticket (mismo archivo/área o dependencia lógica). Sin Dep = independiente.

> **Regla anti-conflicto:** mergea (o rebasa) cada PR antes de arrancar el siguiente. Varios tickets
> editan `en.json`/`es.json` y los mismos componentes; en serie con merge previo no hay conflicto.
> El loop `scripts/run-backlog.sh` ya va en serie; respétalo, no lances ramas en paralelo sobre el mismo cluster.

| # | Pri | ID | Título | Dep | Estado |
|---|-----|------|--------|-----|--------|
| 1 | P2 | T-027 | Personalización granular de cookies (panel "Gestionar preferencias") | T-024 (mergeado) | todo |
| — | P2 | T-001 | Subir concurrencia de indexado de caras (10–50) tras pasar a Inngest Pro | **blocked:** Inngest Pro | blocked |

### Clusters (tocan el mismo código — ejecutar contiguos y en orden)
- **Producción / lanzamiento:** ✅ completado — T-021 Términos (PR #78), T-022 Sentry (PR #79), T-023 Analytics (PR #80), T-024 Cookies (PR #81), T-026 Docs go-live (PR #82), T-025 Health endpoint (PR #83). No quedan tickets de este cluster.
- **Galería del evento (mobile):** T-007 → T-010 → T-008. T-007 reestructura la toolbar; los otros dos dependen de esa base.
- **Header / nav:** T-002 → T-003 → T-006. T-003 reusa el borde de T-002; T-006 oculta el header en mobile (coordinar con T-003).
- **Tabs:** T-004 (arregla el salto) → T-013 (restila todos los tabs, incluidos los de eventos destacados).
- **Páginas i18n/producción:** T-014 → T-015 → T-016. Comparten `en.json`/`es.json`; en serie evitan conflictos de diccionario.
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

<!-- Los tickets completados se mueven aquí con su nº de PR. -->

## Descartados / revertidos

- **T-011** · Código de foto por evento — se mergeó (PR #66) y luego se **revirtió** (PR de revert). Poca utilidad como código interno del fotógrafo: texto libre duplicable que no identifica de forma fiable, y el valor real del dominio (número de **dorsal/BIB buscable por el atleta**) es un feature distinto, alineado con el "BIB number recognition" ya anunciado en los planes. Posible repensar como ticket nuevo orientado a talent + OCR.
