# T-138 · [Ops/Auditoría] Auditar qué funciones Inngest estuvieron muertas en prod y reconciliar datos/storage

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** — (ops, sin cambios de código)
- **OpenSpec change:** —
- **PR:** —

## Auditoría (2026-07-15, contra prod vía MCP)

5 eventos en prod (3 borrados sin fotos, 2 vivos con 300 fotos).

| Superficie | Estado | Acción |
|---|---|---|
| Thumbnails | ✅ 300/300 `ready` | Ninguna — reconciliado por T-125 |
| Indexado de caras | ✅ 300/300 terminal | Ninguna — `index-photo-faces` era de las 5 vivas |
| **Detección de dorsales** | ❌ 2 eventos opt-in, 0 filas `photo_bib_numbers` | Backfill solo del Marathon (ver abajo) |
| Cleanup de eventos borrados | ✅ Limpio | Ninguna — los 3 borrados tenían 0 fotos y sin colección |
| Storage huérfano | ✅ 1 original suelto (300 rows / 301 objetos) | Ninguna — el cron de cleanup (ya vivo) lo barre |
| Colecciones AWS huérfanas | ⚠️ No verificable vía DB | Chequeo manual en consola Rekognition (`eu-west-1`) |

**Decisión de reconciliación (confirmada con el usuario):** backfillear dorsales **solo** en
"Marathon Madrid 2026" (`b5b4a5ee`, 265 fotos) — ahí los dorsales tienen sentido. Se **salta**
"Surf Session Los Caracas" (`cfa8d0ee`, 35 fotos): surfistas no llevan dorsal, correr `DetectText`
ahí es coste AWS tirado. Disparo: el usuario deshabilitó→rehabilitó la detección de dorsales del
evento Marathon (disparó `backfillEventBibDetection` por el camino real, ya synceado).

## Resultado (verificado 2026-07-15)
Backfill del Marathon **completo**: evento `bib_detection_status='ready'`, 265/265 fotos procesadas
(0 pending), **238 fotos con dorsales, 1293 números** en `photo_bib_numbers`. La búsqueda por dorsal
en ese evento ahora devuelve resultados. Surf saltado a propósito. Storage huérfano (1 original
suelto) queda para el cron de cleanup ya vivo. Colecciones AWS: el DB no muestra huérfanas; chequeo
de la consola Rekognition queda como verificación manual opcional del usuario. Sin cambios de código
— fue ops puro. Follow-up de UX capturado: **T-139** (mostrar el progreso de dorsales al fotógrafo,
que hoy corre a ciegas — se notó justo en esta reconciliación).

## Requerimiento
T-125 destapó que el app de Inngest de prod estuvo synceado viejo (5/13 funciones) durante un
período largo. Todo lo agregado después nunca corrió en prod. Hay que auditar el impacto real
y reconciliar donde haga falta. Superficies afectadas:

- **`detect-photo-bibs` (T-032):** la detección de dorsales **nunca corrió en prod**. Eventos con
  `bib_detection_enabled=true` no tienen filas en `photo_bib_numbers` → la búsqueda por dorsal no
  devuelve nada. Reconciliar: re-emitir `photo.bib-detect` para las fotos de eventos opt-in.
- **`cleanup-orphaned-storage-files` (cron):** la limpieza de huérfanos nunca corrió → posible
  acumulación de objetos huérfanos en el bucket `photos`. Medir y limpiar.
- **`backfill-event-indexing` / `backfill-event-bib-detection`:** habilitar AI/dorsales en un evento
  existente no fanned-out → fotos viejas de esos eventos sin indexar/sin dorsales.
- **`cleanup-on-event-delete` / `disable-event-indexing`:** borrados/deshabilitaciones que no
  limpiaron colecciones AWS Rekognition → colecciones huérfanas (coste AWS).
- **`generate-photo-thumbnails` / `reconcile-indexing-state`:** ya reconciliado por T-125 (las 299
  legacy horneadas al re-sincronizar). Verificar que no quede ninguna `pending`/`failed` colgada.

## Criterio de aceptación (Definition of Done)
- [ ] Inventario (query MCP contra prod) de cada superficie: cuántas filas/objetos afectados.
- [ ] Reconciliadas las que tengan impacto de usuario o coste: dorsales de eventos opt-in,
      thumbnails colgados, backfills de AI/dorsales pendientes.
- [ ] Storage huérfano medido y limpiado (o disparado el cron ahora que corre).
- [ ] Colecciones AWS Rekognition huérfanas identificadas y borradas (coste).
- [ ] Documentado el alcance real del período de drift (para saber qué features anunciar como
      funcionando).

## Notas
- Origen: T-125.
- Depende operativamente de que el sync esté sano (T-137) para que la reconciliación no se vuelva
  a perder. Se puede empezar la auditoría (SELECTs) en paralelo.
- Todos los jobs de reconciliación via re-emisión de eventos Inngest (el camino de eventos ya
  funciona en prod) — no inventar mutaciones nuevas.
