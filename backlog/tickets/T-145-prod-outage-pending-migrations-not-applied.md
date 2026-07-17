# T-145 · [INCIDENTE] Prod caído: migraciones sin aplicar → "Failed to count photos" 500

- **Prioridad:** P1 (era P0 — **prod ya restaurado**; queda la causa raíz del pipeline)
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/migrate-yml-not-applying` (tipo = fix; infra CI)
- **OpenSpec change:** — (incidente ops + fix de pipeline CI, no diseño de producto)
- **PR:** —

## ✅ Remediación inmediata APLICADA (2026-07-17, con aprobación del usuario)
Prod restaurado aplicando las 3 migraciones pendientes vía Supabase MCP (`apply_migration`), en orden: `20260716000000` (índice `original_url`), `20260716000001` (RPC `increment_rate_limit_bucket_by`), `20260717000000` (`photos.deleted_at` + índice parcial de galería). Se alineó `supabase_migrations.schema_migrations` al formato del repo (version = basename completo, name null) para que un futuro `db push` no las vea como remote-only. **Verificado en prod:** existe `photos.deleted_at`, ambos índices y el RPC; las queries que fallaban (`getPhotosUploadedCount` con join a events, galería pública approved+deleted_at) ejecutan sin error (300 fotos vivas). El 500 "Failed to count photos" está resuelto.

**Queda pendiente (el motivo real de este ticket):** arreglar `migrate.yml` para que las migraciones se apliquen solas en el merge a main — si no, el próximo PR con migración vuelve a tumbar prod.

## Requerimiento
**Incidente de producción activo.** Vercel loguea `⨯ Error: Failed to count photos: ...` (digest `694588297`) y responde **500** en el render de Server Components; en consola `Failed to load resource: 500`. El mensaje sale de `getPhotosUploadedCount` (`src/database/queries/photos.ts`).

## Causa raíz (verificada contra prod vía MCP)
- **PR #203 (T-142) se mergeó** (2026-07-17 10:43 UTC) y se desplegó a prod. Su código filtra `.is('deleted_at', null)` en las lecturas calientes de fotos (dashboard del fotógrafo, galerías pública/talent, carrito, checkout, portadas, cuotas).
- **Pero la columna `photos.deleted_at` NO existe en prod.** La última migración aplicada en prod es **`20260715000000`**. Faltan por aplicar: `20260716000000_add_photos_original_url_index` (T-136/PR #196), `20260716000001_add_increment_rate_limit_bucket_by` (T-034/PR #198) y `20260717000000_add_deleted_at_to_photos` (T-142/PR #203).
- Sin la columna, PostgREST rechaza cada query con `.is('deleted_at', null)` → 500 en toda superficie de fotos. **`migrate.yml` lleva sin aplicar migraciones desde ~`20260715000000`** (debería correr en cada merge a main). Las de T-136/T-034 eran additivas/de path angosto (índice + RPC) y no tumbaron nada visible; la de T-142 añade una columna sobre la que el código **filtra** en el hot path → outage completo.

Es exactamente el gap "el preview de Vercel falla hasta aplicar la migración a prod" documentado en cada PR con migración — salvo que aquí `migrate.yml` **tampoco** la aplicó al mergear, así que rompió **prod**, no solo el preview.

## Criterio de aceptación (Definition of Done)
- [x] **Remediación inmediata:** aplicadas a prod las migraciones pendientes; `photos.deleted_at`/índices/RPC verificados; queries que fallaban ejecutan OK. (Hecho 2026-07-17 vía MCP — ver arriba.)
- [ ] **Causa raíz del pipeline:** investigar por qué `migrate.yml` dejó de aplicar migraciones tras `20260715000000` (¿falla silenciosa del workflow? ¿credenciales? ¿no dispara en merge?). Arreglarlo para que futuras migraciones se apliquen solas en el merge a main. Documentar el hallazgo (paralelo al drift de Inngest de T-137).
- [ ] **Guardarraíl (opcional, evaluar):** que un merge con migración no pueda desplegar código que la requiera antes de que se aplique (p. ej. gate de deploy, o smoke check post-deploy que alerte). No re-litigar el diseño additivo; el objetivo es que "merge de PR con migración" ⇒ "migración aplicada" sea atómico/verificado.
- [ ] Verificación end-to-end en prod tras el fix: cargar `/es` (grids), una página pública de evento, el dashboard del fotógrafo y el carrito sin 500.
- [ ] Sin cambios de esquema nuevos (las migraciones ya existen); si el fix del pipeline toca `migrate.yml`/GH Actions, incluirlo.

## Notas
- **Aplicar la migración es la restauración inmediata** — es mayormente ops (no código de app). Coordinar con el usuario antes de mutar prod.
- Relacionado: T-137/T-138 (drift de Inngest en prod, mismo patrón de "pipeline de deploy no corrió en prod"). Revisar si `migrate.yml` comparte causa (integración/secretos de deploy).
- Memoria del proyecto: "Vercel preview usa prod DB; los PRs con migración fallan el preview hasta aplicar la migración a prod (migrate.yml solo corre en merge a main)". Este incidente muestra que **migrate.yml no corrió/falló en el merge**, así que la premisa "se aplica en el merge" no se cumplió.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/apply-pending-prod-migrations`.
2. **Remediar prod primero** (aplicar migraciones pendientes, confirmando con el usuario) para bajar el P0.
3. Investigar + arreglar `migrate.yml` (causa raíz del pipeline).
4. `pnpm typecheck && pnpm lint && pnpm test` si se toca código.
5. Commit (Conventional Commits, **sin** `Co-Authored-By`).
6. `git push -u origin <rama>`; `gh pr create --draft`.
7. Marcar ticket `done`, mover a Archivo con el nº de PR, mover el archivo a `backlog/tickets/done/`.
