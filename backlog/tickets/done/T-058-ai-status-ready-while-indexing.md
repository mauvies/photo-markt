# T-058 · Bug: el estado de IA del evento dice "ready" mientras las fotos aún se están indexando

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/ai-status-ready-while-indexing`
- **OpenSpec change:** — (bug fix, implementar directo)
- **PR:** #121

## Requerimiento
En el **detalle del evento**, la card de estado de IA muestra el conteo "N indexadas de M" (que sí debe ir
cambiando conforme se indexan — correcto), pero el **estado** dice **"ready"** aunque todavía se estén indexando
fotos. Debería decir **"indexing" / "en progreso"** mientras `pending > 0`, y pasar a **"ready"** solo cuando
todas las aplicables estén indexadas.

## Causa raíz (confirmada en código)
- El estado que se muestra viene de `events.ai_matching_status` (`'idle' | 'indexing' | 'ready' | 'failed'`,
  `getEventRekognitionState`), que aparentemente se pone en `'ready'` antes de que terminen de indexarse todas
  las fotos (p. ej. al crear la colección / al encolar el backfill), no al completar la indexación real.
- `ai-status-card.tsx` (`isProcessing`, ~L81-85) considera terminado cuando `status === 'ready'` y **no** trata
  `status === 'ready' && pending > 0` como "aún procesando". Solo trata como processing `status === 'indexing'`
  o `status === 'idle' && pending > 0`. Por eso, si el estado del evento es `'ready'` pero `pending > 0`, la card
  muestra "ready" (y deja de reflejar el progreso real).

## Criterio de aceptación (Definition of Done)
- [ ] Mientras haya fotos aplicables sin indexar (`pending > 0` / `indexed < totalApplicable`), la card muestra
      **"indexing"/en progreso** (y sigue haciendo poll), no "ready".
- [ ] "ready" solo cuando **todas** las fotos aplicables llegaron a estado terminal (`indexed`/`no_faces`).
- [ ] Corregir en la fuente correcta: o bien no marcar `events.ai_matching_status='ready'` hasta que termine la
      indexación (worker), o bien derivar el estado mostrado del progreso real (`indexed`/`pending`) en lugar de
      confiar en el label `ai_matching_status`. Elegir y documentar (idealmente que el label refleje la verdad).
- [ ] No romper el flash "All photos indexed" al completar (`indexing → ready`) ni el caso `failed`.
- [ ] strings ya existen (`statusIndexing`/`statusReady`); añadir/ajustar copy solo si hace falta (en `en.json` y
      `es.json`).
- [ ] test que falla antes y pasa después (helper puro de decisión de estado mostrado dado `status` + `indexed` +
      `pending`, o del cálculo de `isProcessing`).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Archivos: `src/app/[lang]/dashboard/photographer/events/[id]/ai-status-card.tsx` (lógica de estado/`isProcessing`),
  `src/database/queries/rekognition.ts` (`getEventRekognitionState`, `getEventAiIndexingProgress`,
  `updateEventRekognitionState`), y el worker que setea `ai_matching_status` (buscar dónde se pone `'ready'`).
- Relacionado con T-057 (conteo de la tarjeta durante el procesamiento) — mismo síntoma general "los números
  durante la indexación no reflejan la realidad", pero distinto código; se capturan por separado.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
