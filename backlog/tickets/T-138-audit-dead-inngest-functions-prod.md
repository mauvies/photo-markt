# T-138 · [Ops/Auditoría] Auditar qué funciones Inngest estuvieron muertas en prod y reconciliar datos/storage

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno (independiente de T-137; conviene después de que el sync esté estable)
- **Rama:** `ops/audit-dead-inngest-prod`
- **OpenSpec change:** — (auditoría + posibles jobs one-off de reconciliación)
- **PR:** —

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
