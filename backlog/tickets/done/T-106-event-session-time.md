# T-106 · Añadir "hora de la sesión" al evento — hora **manual** que introduce el fotógrafo (independiente del time-sync de cámara)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (decisión de producto tomada — ver Notas)
- **Rama:** `feat/event-session-time`  (tipo = feat)
- **OpenSpec change:** — (diseño ya fijado en el ticket — columna nullable additive + hora naive local; se implementó directo, con `/code-review high` por ser migración)
- **PR:** #170
- **Dep:** T-105 (el campo va en el paso Detalles rediseñado)

## Requerimiento
Otras apps (ej. SurfCloud) muestran la **hora de la sesión** del evento. Hoy el wizard solo captura `date` a
nivel **día**. Añadir un campo de **hora de inicio de la sesión que introduce manualmente el fotógrafo** al
crear/editar el evento.

**Decisión de producto (tomada por el usuario):** son **dos conceptos distintos**, no reutilizar el mismo campo:
- **Hora de la cámara** (a la que se tomó cada foto) → sirve para el **matching/filtrado por tiempo**
  (`time_offset`/`time_sync_enabled`), feature hoy **desactivada** en la app. **Fuera de alcance de este ticket.**
- **Hora de la sesión** (la que pone el fotógrafo a mano) → para **mostrar/buscar** cuándo fue la sesión. Es la
  de este ticket. Se elige manual **porque la hora de la cámara puede estar mal configurada o ausente**, y el
  fotógrafo prefiere indicarla él.

## Criterio de aceptación (Definition of Done)
- [ ] El fotógrafo puede indicar una **hora de sesión** (input de hora) junto a la fecha en el paso Detalles.
- [ ] Campo **opcional** (no todos los eventos la tienen); si no se indica, comportamiento actual sin cambios.
- [ ] Se persiste en un campo **propio, separado** del time-sync de cámara (NO reutilizar `time_offset`/
      `time_sync_enabled`; añadir p. ej. `events.session_time` o combinar con `date` en un `session_at`).
- [ ] Se muestra en la página pública del evento (y en la card/detalle del dashboard donde tenga sentido).
- [ ] Zona horaria definida: guardar hora "local del evento" (naive) es lo más simple y evita depender de TZ del
      navegador — confirmar en el diseño; el evento ya tiene `lat`/`lng` si se quisiera derivar TZ a futuro.
- [ ] strings nuevos en `en.json` y `es.json`.
- [ ] test de regresión/feature que falla antes y pasa después.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
Ejecutar **después** de mergear T-105 para que el campo caiga en el paso Detalles ya rediseñado (evita conflicto
sobre `steps/step-2-details.tsx`). Va en la misma columna de datos que la fecha.

Referencia: `wizard.schema.ts` (`date` día-only), `steps/step-2-details.tsx:163-211` (calendar popover donde iría
el input de hora al lado), schema `events` en `CLAUDE.md`. La tabla `events` ya tiene `start_date`/`end_date`/
`time_offset`/`time_sync_enabled` (feature time-sync) — **no** tocarlos; este campo es un concepto aparte.

Sinergia con T-108: si a futuro se lee EXIF de las primeras fotos, el timestamp podría **pre-rellenar** este campo
(pero siempre editable a mano — es la razón de existir de este ticket).
