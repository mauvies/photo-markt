# T-268 · `profiles`: cualquier usuario logueado lee los datos sensibles de cualquier fotógrafo, y puede reescribir los suyos

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** alto  (seguridad · BD/migraciones)
- **Blockers:** ninguno  (Dep T-227, ya mergeado)
- **Rama:** `fix/profiles-private-columns`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

La mitad que **T-227 dejó abierta a propósito**. Aquel ticket cerró la exposición a `anon` con GRANTs
por columna (migración `20260906000000`), pero `authenticated` conserva SELECT de tabla completa, y la
política `photographer_profiles_public_select` (`using (active_role = 'PHOTOGRAPHER')`) admite la fila
de **cualquier** fotógrafo. Así que basta con crear una cuenta —Google, segundos— para leer de
cualquier fotógrafo:

- `full_name` (nombre legal)
- `address_line1`, `address_line2`, `postal_code`, `state_or_region` (dirección postal)
- `stripe_customer_id`, `stripe_connect_account_id`
- `payout_method`, `payout_details_json`

Está pinneado hoy como brecha conocida en `test/integration/security/profiles-rls.test.ts`
(«KNOWN GAP: a signed-in user can still read another photographer stripe id and address»), que
**fallará cuando esto se arregle** — es la señal de que hay que actualizarlo, no un test roto.

## La mitad de ESCRITURA (hallada por `/code-review high` sobre el PR de T-227)

El allow-list por columna de T-227 es **solo de SELECT**. `anon` y `authenticated` conservan
INSERT/UPDATE de tabla completa, y `profiles_self_update` restringe la **fila** (`id = auth.uid()`)
pero **no las columnas**. Así que un fotógrafo puede, con un `PATCH /rest/v1/profiles?id=eq.<él
mismo>`, reescribir sus propios `stripe_connect_account_id`, `stripe_connect_status`,
`payout_details_json` o `is_payout_profile_complete` — columnas que la app trata como gestionadas por
el sistema — saltándose la Server Action entera.

**Acotado, por eso no se arregló allí:** todas las rutas de dinero re-derivan el estado desde Stripe
con `reconcileAndPersistConnectStatus` antes de transferir, y apuntar la **propia** cuenta de cobro a
otro sitio es autolesión, no robo. Pero es escritura de usuario sobre una columna de dinero, y hoy
solo está fijada por un test, no impedida.

⚠️ Cerrarlo exige mover antes a `supabaseAdmin` la llamada de
`settings/payout-profile/actions.ts:110` → `updateProfileStripeConnect`, que hoy usa el cliente del
usuario; después ya se puede conceder UPDATE por columna. Pinneado en `profiles-rls.test.ts`
(«KNOWN GAP: a user can rewrite their OWN stripe connect columns…»), que **fallará** al arreglarse.

## Por qué no se arregló en T-227

Un GRANT por columna es **por rol**, no por fila: no distingue «mi fila» de «la de otro». Restringir
`authenticated` por columna rompería que un fotógrafo lea su propia dirección en ajustes
(`getProfile` hace `select('*')` sobre la fila propia desde el dashboard). Cerrarlo exige un cambio de
esquema, no un grant — por eso es un ticket con su propio plan mode.

## Criterio de aceptación (Definition of Done)

- [ ] Un usuario autenticado **no** puede leer `full_name`, dirección, `stripe_*` ni `payout_*` de otro
- [ ] Un usuario **no** puede escribir `stripe_*`, `payout_*` ni `is_payout_profile_complete`, ni
      siquiera en su propia fila (mover antes `updateProfileStripeConnect` a `supabaseAdmin`)
- [ ] Un fotógrafo **sí** sigue leyendo y editando los suyos (ajustes, perfil de pagos)
- [ ] El perfil público (`/photographer/[slug]`) y el buscador de fotógrafos siguen funcionando para
      `anon` y para `authenticated`
- [ ] Actualizados **los dos** tests de brecha conocida de `profiles-rls.test.ts` (lectura ajena y
      escritura propia) para afirmar las propiedades nuevas
- [ ] `supabase/seed.sql` coherente con la migración (misma trampa que T-227: su grant en bloque corre
      después de las migraciones)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Dos formas plausibles, a decidir en plan mode:

1. **Mover las columnas sensibles a una tabla aparte** (`profile_private` o similar) con RLS
   `user_id = auth.uid()` y sin política pública. Es la forma limpia: la propiedad pasa a ser
   estructural en vez de depender de una lista de grants. Cuesta migración de datos + repuntar
   `getProfile`, la página de ajustes y el flujo de payout-profile.
2. **Estrechar la política pública** a los perfiles que de verdad deban ser públicos y servir el resto
   por vista. Ojo: una vista sin `security_invoker` se salta la RLS de la tabla base, así que hay que
   ser explícito.

⚠️ Al desplegar, confirmar con `pnpm ops:drift` que la migración llegó a producción — ya hubo un caso
de migración que nunca se aplicó por quedarse sin minutos de Actions.

Contexto: hallado al medir la cobertura RLS en **T-227** (PR de `chore/rls-coverage-sweep`), que
documenta el incidente completo en `backlog/DECISIONS.md` §10.
