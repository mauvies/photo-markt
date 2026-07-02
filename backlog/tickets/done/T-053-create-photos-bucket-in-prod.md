# T-053 · Fix: crear el bucket `photos` (faltaba en producción — rompía TODA subida de fotos)

- **Prioridad:** P0 (funcionalidad core rota en prod)
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/create-photos-bucket`
- **OpenSpec change:** — (fix de infra/migración, single-file, implementación directa)
- **PR:** #<pendiente>

## Requerimiento
Al crear un evento y subir fotos (especialmente lotes grandes), la subida fallaba con
`Failed to create signed upload URL: The related resource does not exist` (digest en prod, log en Vercel).
Reincidente: T-051 intentó arreglarlo capando la concurrencia y **no** era la causa.

## Causa raíz (diagnóstico)
- El error de storage-api "The related resource does not exist" = `RelatedResourceNotFound`, que se produce
  **solo** ante un `23503` de Postgres (violación de FK). En `storage.objects` la **única** FK es
  `objects_bucketId_fkey (bucket_id -> storage.buckets)`.
- Al mintear un signed upload URL sin upsert, storage-api hace `db.createObject` insertando en
  `storage.objects` con `bucket_id = 'photos'`.
- **El bucket `photos` no existía en producción** (`storage.buckets` solo tenía `feedback`). Confirmado:
  `storage.objects` en prod estaba **vacío** → la subida de fotos **nunca** funcionó en prod. Staging sí lo tenía.
- Ningún migration/seed creaba el bucket: se creaban a mano en Supabase Studio (ver comentario en
  `test/helpers/supabase-test-client.ts`), y ese paso se saltó en prod. T-051 (capar concurrencia a 10) apuntó
  al síntoma equivocado.

## Solución
1. **Inmediato:** creado el bucket `photos` en prod (privado, sin límites — igual que staging/test) vía API,
   restaurando la subida al instante.
2. **Permanente:** migración `supabase/migrations/20260702000000_create_photos_bucket.sql` (idempotente,
   `ON CONFLICT DO NOTHING`) para que todo entorno (prod/staging/local/CI) lo provisione igual y no vuelva a
   pasar. La CI `migrate.yml` la aplica a prod al mergear a `main`.

## Criterio de aceptación (Definition of Done)
- [x] Existe una migración que crea el bucket `photos` en `storage.buckets`.
- [x] Test de regresión (`test/unit/photos-bucket-migration.test.ts`) que falla antes y pasa después: exige que
      una migración inserte el bucket `photos` (guarda contra volver a “gestión manual en Studio”).
- [x] Comentarios engañosos corregidos: `storage-concurrency.test.ts` (la concurrencia NO era la causa) y el
      comentario de `ensurePhotosBucket` (ahora la migración provisiona el bucket).
- [x] `pnpm typecheck && pnpm lint && pnpm test:unit` en verde (337 unit tests).
- [x] Bucket `photos` creado en producción.

## Notas
- Validación de subida sigue app-side (`src/lib/photo-upload.ts`: magic bytes, 50 MB) + worker Inngest; por eso
  el bucket va sin `file_size_limit`/`allowed_mime_types` (paridad con staging y el helper de tests).
- T-052 (wizard pierde config del paso 1 tras error de subida) es un síntoma aguas-abajo de este mismo fallo;
  sigue siendo válido por otros errores transitorios, pero su disparador principal desaparece con este fix.
