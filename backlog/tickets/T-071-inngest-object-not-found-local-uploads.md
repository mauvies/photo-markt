# T-071 · Bug: los jobs de Inngest fallan con "Object not found" al indexar fotos creadas en local

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/inngest-object-not-found-local-uploads`  (tipo = fix)
- **OpenSpec change:** —  (se decide al ejecutar; probablemente doc/config + hardening menor, no cambio grande)
- **PR:** —

## Requerimiento
Al crear un evento **en local**, los trabajos de Inngest que indexan las fotos (face indexing / thumbnails / bib) fallan con:

```
Error: Failed to download photo 07cf6833-…/eec41c58-…/fb339be8-….jpg: Object not found
    at /var/task/.next/server/chunks/node_modules__pnpm_0bs3y7w._.js:7:34409
    ...
    at async p_.tryExecuteStep (...)
    at async steps-found (...)
    at async p_.runCoreLoop (...)
```

El indexado debe procesar correctamente las fotos subidas en el entorno de desarrollo local (o, si eso no es posible por diseño, debe estar documentado y el worker no debe fallar ruidosamente por un objeto que no existe en su entorno).

## Criterio de aceptación (Definition of Done)
- [ ] Diagnóstico reportado: confirmar si es (a) mismatch de entorno local-dev (subida a storage local + worker de Inngest Cloud corriendo contra prod) o (b) un bug real que también afecta prod (race de consistencia / path mal guardado)
- [ ] Confirmado explícitamente si **producción está afectada** o no
- [ ] Si es mismatch de entorno: documentado el flujo correcto de dev (correr el Inngest Dev Server local, `npx inngest-cli dev`, contra el worker local → storage local) en el README/docs de testing
- [ ] Si hay un bug real de prod (race o path): arreglado con test de regresión que falla antes y pasa después
- [ ] El worker maneja "Object not found" de forma no destructiva (no retry-storm inútil; marca el estado de la foto de forma sensata) — hardening menor
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Causa raíz más probable (investigada, capture-only):** el stack corre en `/var/task/…` — un worker **serverless desplegado (Vercel)**, no el proceso local. El worker descarga `storagePath` vía `supabaseAdmin.storage.from('photos').download(...)` (`index-photo-faces.ts:340-344`) usando las **env vars de prod**. Pero la foto se subió al **Supabase local**. → el objeto existe solo en storage local; el worker de Inngest Cloud lo busca en storage de prod → "Object not found". Es un **desalineamiento de entornos en desarrollo local**: Inngest Cloud está registrado contra el despliegue (prod/preview), así que los eventos creados en local los procesa prod, que no ve los objetos locales.
- **Por qué prod probablemente NO está afectado:** en prod, el fotógrafo sube a storage de prod y el mismo worker de prod descarga de storage de prod → coincide. Aun así, **el primer paso es confirmarlo**, no asumirlo.
- **Ángulo secundario a descartar en el diagnóstico:** un race de consistencia eventual — `photo.uploaded` se envía en batch justo tras insertar las filas (`upload-urls/actions.ts:514-521`); si el objeto no está durablemente legible cuando corre el worker, daría "Object not found" también en prod. Verificar si puede pasar y, si sí, añadir un pequeño retry/backoff antes de marcar `failed` (los workers ya tienen `retries: 3`, pero conviene distinguir not-found transitorio de definitivo).
- **Puntos de código:** descarga en `src/lib/inngest/functions/index-photo-faces.ts:340`; misma descarga en `detect-photo-bibs.ts:101-108` y en `generate-photo-thumbnails.ts`; envío del evento en `.../upload-urls/actions.ts:514`. La ruta guardada (`photos.original_url` / `path`) es la que se pasa como `storagePath`.
- **Prioridad P2:** la evidencia (`/var/task/` + "en local") apunta a un problema de **entorno de desarrollo**, no a un bug que afecte a usuarios en prod; bloquea probar el pipeline de IA en local pero no rompe prod. **Si el diagnóstico confirma impacto en prod (race/path), subir a P1.**

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/inngest-object-not-found-local-uploads`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
