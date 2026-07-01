# T-051 · Bug: subida de evento con 258 fotos falla con "The related resource does not exist"

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/signed-url-batch-concurrency`
- **OpenSpec change:** — (bug fix localizado, implementar directo)
- **PR:** #109

## Requerimiento

Al crear un evento con 258 fotos, la app falla con este error en producción (Vercel):

```
Error: Failed to create signed upload URL: The related resource does not exist
```

Y en la UI aparece el overlay de error de Server Components. Con pocos archivos funciona; el fallo ocurre solo a escala.

## Causa raíz

`createSignedUploadUrls` (`src/database/queries/storage.ts:111`) usa `Promise.all` sobre todos los paths del batch:

```ts
return Promise.all(paths.map((p) => createSignedUploadUrl(supabase, bucket, p, options)));
```

`use-photo-upload.ts` pide URLs en chunks de 100 (`CHUNK_SIZE = 100`). Eso dispara 100 llamadas HTTP simultáneas a la Storage API de Supabase. La API satura (rate limit o connection pool) y devuelve "The related resource does not exist" en alguna de las llamadas, lo que hace explotar `Promise.all` y falla toda la petición.

## Criterio de aceptación (Definition of Done)

- [ ] `createSignedUploadUrls` procesa paths en sub-batches de ≤10 concurrentes (no `Promise.all` sobre todos)
- [ ] Crear un evento con 258+ fotos no produce "Failed to create signed upload URL"
- [ ] Test unitario: `createSignedUploadUrls` con >10 paths verifica que no se lanzan más de 10 llamadas simultáneas (usando mock de `createSignedUploadUrl`)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

- La concurrencia máxima recomendada es 10. Supabase Storage no documenta un límite exacto de RPS por ruta, pero los errores observados con 100 concurrentes confirman que hay un tope.
- `createSignedUrls` (download, no upload) usa el método batch nativo de Supabase que manda un solo request — ese no tiene el problema. Solo `createSignedUploadUrls` (upload, que llama `createSignedUploadUrl` una vez por path) tiene la concurrencia descontrolada.
- La implementación sugerida: función auxiliar `runWithConcurrency<T>(items, limit, fn)` que procesa en pools de `limit` paralelos y espera al pool antes de avanzar. Pura, testeable sin DB.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/signed-url-batch-concurrency`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
