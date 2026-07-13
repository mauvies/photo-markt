# T-107 · Capturar y persistir ciudad + estado/provincia + país del evento (hoy solo ciudad+país)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/event-location-state`  (tipo = feat)
- **OpenSpec change:** — (UI reusando columnas existentes; sin migración; se implementó directo)
- **PR:** #171
- **Dep:** T-105 (toca el paso Detalles del wizard)

## Requerimiento
La ubicación se captura hoy con la API de Google Places pero solo se guardan **ciudad y país**. El schema de
`events` **ya tiene** una columna `state` (default `''`) que **no se rellena** (no hay UI ni se mapea al crear).
Rellenar **estado/provincia** además de ciudad y país para cada evento, extrayéndolo del mismo resultado de
Google Places, y persistir los tres.

**Futuro (no en este ticket, solo dejar la puerta abierta):** en vez de "ciudad y país", permitir un lugar más
**específico** (playa, spot, pueblo) usando los tipos de lugar que ofrece Google. De momento: ciudad + estado + país.

## Criterio de aceptación (Definition of Done)
- [ ] `LocationAutocomplete` extrae `administrative_area_level_1` (estado/provincia) del resultado de Google,
      además de ciudad y país, y lo expone al form.
- [ ] `createEvent` (y edición) mapea y persiste `city`, `state` y `country` en `events`.
- [ ] Eventos existentes sin `state` siguen funcionando (campo opcional, `''` válido).
- [ ] Donde ya se muestra la ubicación del evento (página pública / cards), incluir estado si está disponible,
      con fallback limpio a "ciudad, país" cuando no lo esté (sin romper el formato actual).
- [ ] strings/labels en `en.json` y `es.json` si se añade texto visible.
- [ ] test de regresión/feature que falla antes y pasa después (parseo del `state` desde el resultado de Places +
      persistencia de los tres campos).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
Ejecutar **después** de mergear T-105 (ambos tocan `steps/step-2-details.tsx` — la ubicación va en la columna de
datos del layout de 2 columnas). Referencias: `LocationAutocomplete` (`src/components/ui/location-autocomplete.tsx`),
`steps/step-2-details.tsx:127-155` (campo actual), `wizard.schema.ts` (`country`/`state` con default `''` sin UI),
`actions.ts` `createEvent` (payload). Google Places API es **solo** para formularios de evento (nunca en búsqueda) —
respetar esa regla de CLAUDE.md.
