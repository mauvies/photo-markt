# T-069 · Diagnosticar y arreglar la búsqueda por dorsal en el dashboard de talento

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/bib-search-talent-dashboard`  (tipo = fix)
- **OpenSpec change:** —  (probablemente directo; se crea al ejecutar si el arreglo + empty-state + diagnóstico tocan >1 archivo de forma no trivial)
- **PR:** #120

## Requerimiento
El reconocimiento de dorsal está implementado en todas las capas (UI, server actions, queries, esquema DB, OCR AWS Rekognition `DetectText`, workers de Inngest), pero introducir un dorsal claramente visible **no devuelve match**. Una auditoría de estado (investigación previa) identificó **un bug de código confirmado** + **dos posibles condiciones de datos**. Este ticket corre primero queries de diagnóstico para determinar cuál aplica, luego aplica el arreglo confirmado y cualquier otro que revele el diagnóstico.

**Bug confirmado (raíz principal):** en `/dashboard/talent/events/[id]` el bar de búsqueda por dorsal se renderiza y la acción `searchPhotosByBibInEvent` corre bien, pero **el grid nunca filtra**. `event-photo-viewer.tsx` importa solo `useFaceSearch` (no `useBibSearch`) y su `visiblePhotos` (~líneas 382-385) solo maneja el filtro `'mine'`, ignorando `matchedPhotoIds` de dorsal. El visor público `public-event-photo-viewer.tsx` (~líneas 398-409) sí consume `useBibSearch` y filtra correctamente.

**Paso 1 — Diagnóstico (queries contra Supabase, el terminal tiene acceso):**
Correr las queries sobre el evento que probó el usuario (o listar eventos recientes con `bib_detection_enabled=true` si no se conoce el `EVENT_ID`):
- Q1: `bib_detection_enabled`/`bib_detection_status` del evento.
- Q2: `COUNT(*)` en `photo_bib_numbers` join `photos` para ese evento.
- Q3: distribución de `bib_text` detectados (¿está el buscado?).
- Q4: distribución de `photos.bib_detection_status` del evento.

**Interpretación:**
- Q1 `enabled=false` → **Condición A** (nunca se hizo opt-in). Arreglo: habilitarlo + asegurar que el backfill corre; no es bug de código.
- Q1 enabled pero Q2=0 → **Condición A variante** (habilitado pero la detección/backfill nunca corrió/falló). Investigar `backfill-event-bib-detection` y `detect-photo-bibs` (¿disparan?, ¿el gate `if (!state || !state.enabled || state.containsMinors) return skipped` los saca mal?, ¿se llama `DetectText`?, ¿`persistPhotoBibs` escribe?). Arreglar si hay bug de wiring.
- Q2>0 pero el dorsal buscado ausente en Q3 → **Condición B** (OCR no leyó ese dorsal — problema de precisión, ver Paso 3, NO implementar hardening aquí).
- Q3 contiene el dorsal buscado y el usuario probó desde el dashboard de talento → **el bug de código confirmado** (Paso 2).

**Paso 2 — Arreglar el bug confirmado (grid del dashboard de talento no filtra):** hacer que `event-photo-viewer.tsx` consuma `useBibSearch()` y filtre `visiblePhotos` por `matchedPhotoIds`, reusando el patrón del visor público (`public-event-photo-viewer.tsx:402-409`). El dorsal debe componer bien con el filtro `'mine'` y con la búsqueda facial existente. Test de regresión que verifique que el visor de talento filtra `visiblePhotos` a los IDs matcheados en una búsqueda por dorsal.

**Paso 3 — Según el diagnóstico:** documentar la condición A/B; arreglar solo si es un bug de wiring trivial. NO implementar hardening de precisión OCR (confidence floor, match fuzzy/Levenshtein, relajar `BIB_PATTERN`, crops de torso) — eso es un ticket futuro aparte.

**Paso 4 — Mejora de empty-state (incluir):** distinguir dos mensajes en la búsqueda por dorsal —
- Evento con detección habilitada pero `photo_bib_numbers` vacío para sus fotos (aún procesando o no encontró nada) → "La detección de dorsal aún se está procesando o no encontró números".
- Detección completa y genuinamente sin match para el dorsal introducido → mensaje normal "no hay fotos para ese dorsal".
Strings en `en.json` y `es.json`.

**Cleanups menores flaggeados por la auditoría (opcionales, no rompen):** el registro tipado de eventos Inngest (`src/lib/inngest/events.ts`) no lista `photo.bib-detect` / `event.bib-detection-enabled` y tiene un comentario stale; el fallback de fallo de envío en el upload marca solo el estado de cara, no el de dorsal.

## Criterio de aceptación (Definition of Done)
- [ ] Queries de diagnóstico corridas y sus resultados + interpretación reportados (qué condición: A, B o el bug de código)
- [ ] El bar de dorsal del dashboard de talento filtra el grid correctamente (bug confirmado arreglado); test de regresión pasa
- [ ] El dorsal compone bien con el filtro `'mine'` y la búsqueda facial en el dashboard de talento
- [ ] La búsqueda por dorsal de la galería pública queda sin cambios
- [ ] Lo que revele el diagnóstico (condición A/B o bug de wiring) queda documentado, y cualquier bug de wiring confirmado se arregla
- [ ] Empty-state distingue "detección pendiente/vacía" de "genuinamente sin match", traducido en ambos idiomas
- [ ] strings nuevos en `en.json` y `es.json`
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Constraints:** reusar el hook `useBibSearch` y el patrón de filtrado del visor público (sin duplicar lógica); queries en `src/database/queries/`; mutaciones vía Server Actions; componentes Shadcn existentes; sin `any`; Biome. No implementar hardening OCR salvo que el diagnóstico muestre un fix de wiring trivial. Ningún otro cambio.
- **Contexto:** es el gap que dejó **T-064** (PR #118), que arregló que el bar *apareciera* en la vista de talento pero no cableó el filtrado del grid en `event-photo-viewer.tsx`. Ver también T-062 (resolución de evento por slug/UUID/share_code, ya intacta) y la sección "BIB number recognition (T-032)" de CLAUDE.md.
- **Prioridad P1:** bug funcional confirmado en una feature ya anunciada/enviada que el usuario está tocando ahora — por encima del pulido P2. Sin blockers.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/bib-search-talent-dashboard`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
