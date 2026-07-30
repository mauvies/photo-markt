# T-209 · [DIAGNÓSTICO] "0 de 0 fotos indexadas" tras subir una foto con Inngest local

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/indexing-progress-zero-of-zero`
- **OpenSpec change:** —  (empieza por diagnóstico)
- **PR:** —

## Requerimiento
"Añadí una foto después de crear el evento y tengo la instancia de Inngest corriendo en local,
¿por qué dice 0 de 0 fotos indexadas?"

## Por qué "0 de 0" y no "0 de 1" (mecánica confirmada en el código)
`getEventAiIndexingProgress` (`src/database/queries/rekognition.ts:311`) cuenta así:

```ts
const status = row.face_index_status as FaceIndexStatus | null;
if (!status || status === 'not_applicable') continue;   // ← no suma a totalApplicable
totalApplicable += 1;
```

Es decir, **`totalApplicable = 0` significa que ninguna foto del evento tiene un
`face_index_status` distinto de `NULL` o `not_applicable`.** El denominador en 0 no dice "el worker
falló": dice "no hay ninguna foto que le corresponda indexar". Dos causas posibles, y hay que
distinguirlas con datos antes de tocar código:

**H1 — `face_index_status = NULL`: el worker nunca tocó la fila.** El `photo.uploaded` no llegó, o
llegó y el run no arrancó. Con Inngest en local esto es lo esperado si el dev server de Inngest no
ha descubierto `/api/inngest` (mismo patrón que la deriva de sync de prod en T-125). Comprobación:
`select id, upload_status, face_index_status from photos where event_id = '<id>'` — si
`face_index_status` es NULL **y** `upload_status = 'pending'`, es esto.

**H2 — `face_index_status = 'not_applicable'`: el worker SÍ corrió y decidió que no aplica.**
`index-photo-faces.ts:594` marca `not_applicable` cuando el outcome es `'no-ai'`, es decir cuando
el evento **no tenía `ai_matching_enabled` en el momento de procesar la foto**. Si el evento se creó
sin marcar AI matching (o la foto se subió antes de activarlo), la foto queda `not_applicable` para
siempre hasta que un backfill la vuelva a mandar. Comprobación: `not_applicable` con
`upload_status = 'approved'` y `events.ai_matching_enabled = true` → es esto, y falta el backfill.

## Criterio de aceptación (Definition of Done)
- [ ] Diagnóstico escrito con evidencia (query de `photos.face_index_status` + `upload_status` +
      `events.ai_matching_enabled` del evento reportado), no supuesto
- [ ] Si es **H2**: activar AI matching después de subir fotos debe disparar
      `backfillEventIndexing` y re-indexar las `not_applicable`. Verificar que ese camino existe y
      funciona; si no re-encola las ya marcadas, ese es el bug a arreglar
- [ ] **La UI no debe decir "0 de 0" cuando la respuesta honesta es otra.** Distinguir en el
      `AiStatusCard`: "no hay fotos que indexar" ≠ "hay N fotos pero ninguna aplica porque AI se
      activó después" ≠ "esperando al worker". Hoy los tres casos se ven idénticos, y eso es lo que
      hizo la pregunta necesaria
- [ ] Si es **H1** y es solo entorno local, documentarlo en `test/README.md` o el README de dev
      (cómo apuntar el dev server de Inngest a `/api/inngest`) en vez de cambiar código
- [ ] strings nuevos en `en.json` y `es.json` (si se añade copy a la card)
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Reportado durante la revisión de **T-203** (PR #265); **ajeno** a bundles — no toco indexado ahí.
- Familia: **T-183** (fotos del dueño atascadas en `pending`, mismo síntoma "dice N, muestra M"),
  **T-099** (reconciliador horario que auto-cura los wedges de indexado), **T-125** (deriva de
  sync de Inngest en prod). Mirar si el reconciliador de T-099 debería cubrir también el caso
  `not_applicable` con AI ya activado — hoy solo re-drive eventos en `ai_matching_status='indexing'`.
- Empezar en modo diagnóstico (patrón T-172/T-174/T-192): confirmar con MCP contra la BD antes de
  escribir código.
