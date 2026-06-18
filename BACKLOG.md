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
| 7 | P2 | T-007 | Toolbar de galería del evento en mobile: favorito + modo selección sin salto | — | todo |
| 8 | P2 | T-018 | Detallar features de cada plan en la facturación del fotógrafo | — | todo |
| 9 | P2 | T-011 | Secuencia + identificador editable para fotos de un evento (DB + UI, OpenSpec) | — | todo |
| 10 | P3 | T-010 | Limpiar acciones de la barra de modo selección (quitar descargar/compartir) | tras T-007 | todo |
| 11 | P3 | T-008 | Galería del evento full-width en mobile (quitar/reducir padding-x) | tras T-007 | todo |
| 12 | P3 | T-002 | Pulir diseño del language toggler dropdown (bordes, banderas más pequeñas) | — | todo |
| 13 | P3 | T-003 | Borde fino gris en el avatar del header (consistente con el toggler) | tras T-002 | todo |
| 14 | P3 | T-006 | Mover carrito a la bottom nav del dashboard de talento (mobile) | tras T-003 | todo |
| 15 | P3 | T-013 | Estandarizar el diseño de tabs (underline) en toda la app | tras T-004 | todo |
| 16 | P3 | T-009 | Mejorar UX del Lightbox (header, flechas, transición swipe en mobile) | — | todo |
| 17 | P3 | T-017 | Íconos (lápiz/basura) en el dropdown de acciones de eventos del fotógrafo | — | todo |
| — | P2 | T-001 | Subir concurrencia de indexado de caras (10–50) tras pasar a Inngest Pro | **blocked:** Inngest Pro | blocked |

### Clusters (tocan el mismo código — ejecutar contiguos y en orden)
- **Galería del evento (mobile):** T-007 → T-010 → T-008. T-007 reestructura la toolbar; los otros dos dependen de esa base.
- **Header / nav:** T-002 → T-003 → T-006. T-003 reusa el borde de T-002; T-006 oculta el header en mobile (coordinar con T-003).
- **Tabs:** T-004 (arregla el salto) → T-013 (restila todos los tabs, incluidos los de eventos destacados).
- **Páginas i18n/producción:** T-014 → T-015 → T-016. Comparten `en.json`/`es.json`; en serie evitan conflictos de diccionario.
- **Independientes (sin cluster):** T-005, T-012, T-011, T-018, T-009, T-017. (T-018 reusa `pricing-section`/`lib/plans.ts`.)

<!-- Añade filas con /ticket y recoloca según orden de ejecución (#). -->

## Archivo (done)

- **T-004** · Empty state + altura estable en tabs de eventos destacados (home) — PR #58
- **T-005** · Redirect server-side de la home al dashboard por rol — PR #59
- **T-012** · Fotos compradas sin watermark (signed URL original) en pedidos — PR #60
- **T-014** · Página de soporte: i18n completo + contenido corregido + form real — PR #61
- **T-015** · Página de feedback: i18n completo + roadmap corregido (AI Live) — PR #62
- **T-016** · Privacy policy pública escrita y traducida (es+en) — PR #63

<!-- Los tickets completados se mueven aquí con su nº de PR. -->
