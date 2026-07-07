# T-071 · Bug: los jobs de Inngest fallan con "Object not found" al indexar fotos creadas en local

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/inngest-object-not-found-local-uploads`  (tipo = fix)
- **OpenSpec change:** — (no aplicó — diagnóstico + hardening menor + docs, sin cambio arquitectónico)
- **PR:** #131

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
- [x] Diagnóstico reportado: confirmar si es (a) mismatch de entorno local-dev (subida a storage local + worker de Inngest Cloud corriendo contra prod) o (b) un bug real que también afecta prod (race de consistencia / path mal guardado)
- [x] Confirmado explícitamente si **producción está afectada** o no
- [x] Si es mismatch de entorno: documentado el flujo correcto de dev (correr el Inngest Dev Server local, `npx inngest-cli dev`, contra el worker local → storage local) en el README/docs de testing
- [x] Si hay un bug real de prod (race o path): arreglado con test de regresión que falla antes y pasa después — **N/A**, confirmado mismatch de entorno de dev, no bug de prod
- [x] El worker maneja "Object not found" de forma no destructiva (no retry-storm inútil; marca el estado de la foto de forma sensata) — hardening menor
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

### Diagnóstico confirmado

**Es un mismatch de entorno de desarrollo local — NO afecta producción.**

Evidencia recabada (no solo teoría — verificada directamente en este repo):
1. El stack trace del ticket muestra `/var/task/…` — eso es una **Lambda de Vercel desplegada**, nunca la máquina del desarrollador. El propio stack trace ya prueba que el job corrió en un entorno remoto.
2. `.env.local` (el que usa `pnpm dev`) apunta `NEXT_PUBLIC_SUPABASE_URL` al proyecto Supabase **staging** (`rozglsxdolgouslaojtm`, ver memoria `supabase-project-refs`) — no a un Supabase local (Docker). Es decir, "crear un evento en local" en realidad sube la foto y crea la fila `photos` en **staging**, no en un entorno verdaderamente local.
3. `docs/deployment.md` documenta que `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` son **un único par compartido**, atado al despliegue de **producción** ("Use the production Inngest app's key"). No hay un segundo app de Inngest para staging ni "branch environments" configurados (`src/app/api/inngest/route.ts` no pasa ningún `env`/branch a `serve()`).
4. Por tanto: `pnpm dev` local envía el evento `photo.uploaded` a **Inngest Cloud**, que lo enruta al **despliegue de producción** registrado — el cual descarga `storagePath` con **sus propias env vars de producción**. Pero el archivo solo existe en **staging** (donde lo subió el proceso local) → `storage.download()` en el proyecto equivocado → "Object not found".

**Por qué prod NO está afectado:** en producción, el mismo despliegue sube el archivo Y procesa el evento con las mismas env vars de producción → todo consistente. Solo development local está desalineado.

**Ángulo secundario descartado:** el evento `photo.uploaded` se envía después de insertar las filas de `photos` (`upload-urls/actions.ts:514-521`), así que no hay race de consistencia eventual real contra el mismo proyecto — el fallo es 100% de proyecto equivocado, no de timing.

### Fix aplicado
- **Documentación:** nueva sección "5. (Optional) Testing AI background jobs locally" en `README.md` (con referencia cruzada desde `test/README.md`) explicando cómo correr el Inngest Dev Server local (`npx inngest-cli dev` + `INNGEST_DEV=1`) para que los eventos se procesen en la propia máquina en vez de en el despliegue remoto.
- **Hardening (aplica a los 3 workers — face indexing, thumbnails, bib detection):** nuevo helper puro `isStorageObjectNotFound` (`src/lib/storage-object-not-found.ts`, verificado contra el shape real del emulador local de Storage: `{message: "Object not found", status: 400, statusCode: "404"}`). Cuando la descarga falla con este error definitivo, el worker lanza `NonRetriableError` (SDK de Inngest) en vez de un `Error` genérico — así no reintenta 3 veces un objeto que nunca va a aparecer, y pasa directo a `onFailure` (que ya marca el estado terminal de forma sensata).

**Puntos de código:** descarga en `src/lib/inngest/functions/index-photo-faces.ts`, `detect-photo-bibs.ts`, `generate-photo-thumbnails.ts`; envío del evento en `.../upload-urls/actions.ts:514`.

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
