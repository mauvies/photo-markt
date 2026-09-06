# T-227 · Cobertura de tests RLS: 7 de 30 tablas

- **Prioridad:** P2
- **Estado:** doing
- **Riesgo:** alto  (seguridad)
- **Blockers:** ninguno
- **Rama:** `test/rls-coverage-sweep`  (tipo = chore)
- **OpenSpec change:** —  (solo tests, sin cambio de comportamiento… salvo que aparezca un agujero)
- **PR:** —

## Requerimiento

`test/integration/security/` cubre 7 tablas: `orders`, `payouts`, `subscriptions`, `admin_users`,
`talent_claimed_photos`, `talent_saved_events`, y la configuración del bucket de storage.

En producción hay **30 tablas en `public`**, todas con RLS activo y con `GRANT ALL` para `anon` y
`authenticated` (el default de Supabase). Es decir: **RLS es la única barrera**, y el 77 % de esas
barreras nunca se ha probado contra un cliente `anon` ni `authenticated`.

Sin probar hoy, entre otras: `events`, `photos`, `cart_items`, `carts`, `event_photographers`,
`photo_faces`, `photo_bib_numbers`, `talent_photo_tags`, `download_tokens`, `feedback`,
`user_roles`, `user_role_memberships`, `upload_batches`, `upload_objects`, `roadmap_votes`,
`time_sync_tokens`, `payment_accounts`, `ai_search_profiles`.

## Criterio de aceptación (Definition of Done)

- [ ] Cada tabla con RLS activo tiene un test que verifica, como mínimo, que `anon` no lee lo que no
      debe y que un `authenticated` ajeno no lee ni escribe filas de otro usuario
- [ ] Las tablas con RLS activo y **cero políticas** (denegación total intencional) tienen un test que
      pin ea esa propiedad: `admin_users`, `rate_limit_buckets`, `subscriptions`, `guest_orders`,
      `guest_order_items`, `pending_guest_checkouts`, `photos_orphan_storage_pending_cleanup`
- [ ] Un test de inventario, en la línea del de `SECURITY DEFINER` del PR #279: toda tabla de `public`
      debe estar declarada en una allow-list como "tiene políticas probadas" o "denegación total
      intencional". Una tabla nueva sin declarar falla la suite
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Coordinar con **T-219** (podar esquema muerto): no vale la pena escribir tests para
`payment_accounts`, `ai_search_profiles` o `time_sync_tokens` si se van a eliminar. Ejecutar T-219
primero, o excluirlas explícitamente aquí.

**Hallazgo secundario a decidir en este ticket:** las 30 tablas tienen `GRANT ALL` —incluido
`TRUNCATE`— para `anon` y `authenticated`. Es el default de Supabase, pero significa que no hay
defensa en profundidad en la capa de permisos, y `TRUNCATE` **no está sujeto a RLS** en Postgres. Hoy
no es explotable porque PostgREST no expone ningún verbo TRUNCATE, pero deja el sistema a una función
con SQL dinámico de distancia del desastre. Valorar reducir los grants a lo que cada rol necesita de
verdad — con cuidado, porque `supabase/seed.sql` los restaura en local y habría que actualizarlo en
el mismo PR.

Contexto: el incidente del PR #279 demostró que un control de seguridad sin test es un control que
nadie vuelve a mirar.
