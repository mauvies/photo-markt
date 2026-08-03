# T-226 · Acotar `search_users_by_text`: cualquier usuario autenticado puede volcar el padrón

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** alto  (seguridad · BD/migraciones)
- **Blockers:** ninguno
- **Rama:** `fix/cap-user-search-rpc`  (tipo = fix)
- **OpenSpec change:** —  (una función, regla acotada; el "por qué" cabe en la migración)
- **PR:** —

## Requerimiento

El PR #279 cerró la fuga **anónima** de emails, que era la sangría. Pero dejó intacto que
**cualquier usuario autenticado** siga pudiendo volcar el padrón completo de usuarios.

`search_users_by_text` es `SECURITY DEFINER` sobre `auth.users` y sigue teniendo dos defectos que
no son de permisos:

1. **`search_text` se interpola sin escapar en un patrón `LIKE`.** `"@"` casa con todos los
   emails; `""` casa con todo. No hay longitud mínima.
2. **`result_limit` lo controla quien llama, sin techo en servidor.** `result_limit: 1000000`
   devuelve el millón.

Y el RPC es **directamente invocable vía PostgREST** con un JWT de usuario — no pasa por el Server
Action que lo envuelve, así que ninguna comprobación de propiedad del evento lo protege.

Registrarse es Google OAuth, gratis e instantáneo. La barrera real para volcar el email y el
nombre de todos los usuarios es de unos diez segundos.

## Criterio de aceptación (Definition of Done)

- [ ] `result_limit` acotado en servidor: `least(coalesce(result_limit, 10), 50)` dentro de la función
- [ ] `search_text` escapado para `LIKE` (`replace` de `%`, `_` y `\`) antes de construir el patrón
- [ ] Búsquedas de menos de 3 caracteres (tras `trim`) devuelven cero filas en vez de todo
- [ ] `search_user_by_email` hereda el arreglo (delega en `search_users_by_text`)
- [ ] La invitación de colaboradores sigue funcionando — test de integración con búsqueda legítima
- [ ] Test de regresión: `search_text='@'` con `result_limit` alto devuelve ≤ 50 filas y no el padrón
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Considerar si la función debe devolver `email` en absoluto. Su único consumidor de UI es el buscador
de colaboradores (`events/[id]/actions.ts:227`), que podría funcionar con `username` + `display_name`
y resolver el email solo del lado servidor al enviar la invitación. Eso convertiría una fuga de PII en
un no-problema en vez de acotarla. Evaluar al implementar; si se hace, `get_user_emails_batch`
(`profiles.ts:204`, `sales.ts:360`) se queda como único punto que expone emails y ya está limitado a
ids conocidos.

Contexto completo del hallazgo original: cabecera de
`supabase/migrations/20260803000000_revoke_anon_execute_on_user_lookup_rpcs.sql` y PR #279.
