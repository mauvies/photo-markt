# T-056 · Bug: tras reintentar una foto fallida, el wizard deja al usuario atascado en el paso 4 (no navega al evento)

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/wizard-navigate-after-upload-retry`
- **OpenSpec change:** — (bug fix del wizard, implementar directo)
- **PR:** —

## Requerimiento
Al crear un evento, una foto falló al subir (motivo desconocido). El usuario pulsó **Reintentar** y "pareció
funcionar", pero luego **se quedó en la misma página del wizard**, `/dashboard/photographer/events/new?step=4`,
en vez de ser llevado a su evento recién creado. Comportamiento esperado: si el reintento tiene éxito, el wizard
debe **navegar al evento** (como en el camino de éxito normal), sin dejar al usuario atascado ni confundido.

## Causa raíz (confirmada en código)
- `wizard.tsx` (~L787): `onRetryFailed={() => void upload.retryFailed()}` — dispara el reintento pero **ignora
  el resultado** que devuelve `retryFailed()`. Por eso:
  - `attachedCount` **no se actualiza** con las fotos que sí se adjuntaron en el reintento (solo se setea desde
    el `upload.run()` inicial, L518).
  - **No hay navegación** tras un reintento exitoso: el único punto que llama a `goToEvent` es el `run()` inicial
    cuando `failed.length === 0` (L523).
- Resultado: tras el reintento el diálogo llega a `done`, pero el usuario queda en el paso 4. Al cerrar el
  diálogo, `onClose` (L793) solo navega si `attachedCount > 0` (valor del intento inicial); si el intento inicial
  no adjuntó nada (todas fallaron y el reintento las arregló) `attachedCount` sigue 0 → ni descarta (`done` no es
  `error`/`cancelled`) ni navega → se queda en el wizard. Aunque haya adjuntado algo, no hay auto-navegación en
  éxito de reintento, lo que deja una experiencia confusa ("¿se creó o no?").
- **Riesgo colateral:** el usuario, al no ver confirmación, puede **volver a crear el evento** → eventos
  duplicados.

## Criterio de aceptación (Definition of Done)
- [ ] Reproducir: crear evento con fotos, forzar el fallo de ≥1 foto, pulsar Reintentar hasta éxito → el wizard
      **navega al evento creado** (con el conteo real de fotos adjuntadas, incluidas las del reintento).
- [ ] `attachedCount` (o equivalente) refleja también las fotos adjuntadas en `retryFailed()`, no solo las del
      primer `run()`.
- [ ] En éxito total tras reintento (`stage === 'done'`, `failed.length === 0`) el flujo redirige al evento sin
      requerir un segundo clic ambiguo; el camino de cierre/partial sigue coherente con T-054 (no descartar un
      evento que sí tiene fotos).
- [ ] No se rompe: éxito directo (sin fallos), partial-failed que el usuario cierra, y error total (que sí
      descarta el evento huérfano — T-054).
- [ ] strings nuevos en `en.json` y `es.json` si hiciera falta copy.
- [ ] test que falla antes y pasa después (p. ej. helper puro que decide navegar/ξdescartar según stage +
      attached tras reintento; o test del cálculo de attached acumulado).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Mismo código que **T-054** (PR #111, ya mergeado: `onClose`/`shouldDiscardCreatedEvent`/`attachedCount`) y
  **T-052** (paso 1 tras error). Ejecutar coordinado con esa zona del wizard para no chocar.
- Archivos: `src/app/[lang]/dashboard/photographer/events/new/wizard.tsx` (submit / `onRetryFailed` / `onClose`),
  `src/lib/use-photo-upload.ts` (`retryFailed` devuelve `UploadFlowResult | null` — hoy se descarta).
- Posible enfoque: que `onRetryFailed` await-ee el resultado, sume `attached` al acumulado y, si `failed` quedó
  vacío, llame a `goToEvent(totalAttached)`; extraer la decisión a un helper puro testeable.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
