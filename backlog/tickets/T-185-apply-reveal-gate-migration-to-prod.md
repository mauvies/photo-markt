# T-185 · Aplicar la migración del reveal gate (T-177) a producción — drift de schema

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** —  (op de infra; probablemente sin rama de código — aplicar la migración pendiente)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento (hallazgo proactivo durante el diagnóstico de T-183/T-184)
La columna **`events.reveal_gate_enabled`** (introducida por **T-177**, migración `supabase/migrations/20260724000000_add_reveal_gate_to_events.sql`, PR #237) **existe en staging pero NO en producción** — verificado vía MCP:
- **Prod** (`yzdlueeeizdqwuicydbr`): `information_schema.columns` **no** devuelve `reveal_gate_enabled` (la query `select … reveal_gate_enabled …` falla con `42703: column does not exist`).
- **Staging** (`rozglsxdolgouslaojtm`): la columna **sí** existe.

T-177 ya está mergeado a `main` (PR #237) → el código en prod lee `event.reveal_gate_enabled` (`isEventRevealGated`), pero la migración **no se aplicó**. Es exactamente el modo de fallo documentado en memoria: las migraciones se aplican vía **GitHub Action (`migrate.yml`) en merge a main**, y si los minutos de Actions están agotados / el job falla, la migración **no corre** y el schema de prod queda atrás (le pasó a T-142).

## Impacto
- El reveal gate está **silenciosamente inerte en prod**: `getEvent` usa `select('*')`, así que la clave ausente se lee como `undefined` → `isEventRevealGated` da falsy → el gate nunca actúa. La feature de T-177 **no funciona en prod**.
- **Riesgo latente:** cualquier query que referencie explícitamente la columna (o un futuro cambio que lo haga) **lanza `42703`** en prod. La app corre con código que asume una columna que no existe.

## Criterio de aceptación (Definition of Done)
- [ ] `events.reveal_gate_enabled` **existe en prod** con la misma definición que la migración `20260724000000` (default, nullability, cualquier constraint asociado del reveal gate).
- [ ] Verificar que **no hay otras migraciones pendientes** en prod además de esta (revisar el estado de `migrate.yml` y `list_migrations` en prod vs los archivos en `supabase/migrations/`).
- [ ] Confirmar el porqué del fallo del job (`migrate.yml` rojo / minutos de Actions) y dejar constancia — para no repetir el patrón (documentado en memoria).
- [ ] Post-aplicación: `isEventRevealGated` opera en prod; un smoke check confirma que leer la columna ya no falla.

## Notas
- **Cómo aplicar (según memoria del proyecto):** cuando `migrate.yml` está rojo, aplicar a mano vía MCP (`apply_migration` contra prod `yzdlueeeizdqwuicydbr`) con el contenido de `20260724000000_add_reveal_gate_to_events.sql`. **Confirmar antes de mutar prod** (los SELECT de diagnóstico son read-only; un `apply_migration` **sí** muta — requiere OK explícito del usuario).
- **Coordinar con T-184:** el dead-end del reveal gate (T-184) hoy solo se reproduce en staging porque el gate está inerte en prod; una vez aplicada esta migración, el gate queda activable en prod → conviene tener T-184 resuelto antes/junto para no exponer el dead-end a usuarios reales.
- **Memoria relacionada:** "Migrations run via GitHub Action, not Vercel" — `migrate.yml` aplica en merge a main; minutos agotados → job falla en setup y la migración no corre.
- **Este ticket es principalmente una op de infra**, no cambio de código. Si se decide además endurecer el proceso (alerta cuando `migrate.yml` falla), sería un ticket aparte.

---

## Flujo de ejecución (adaptado — op de infra, no feature)
1. Confirmar el drift: `list_migrations` en prod + `information_schema.columns` para `reveal_gate_enabled`.
2. Revisar `migrate.yml` (¿por qué no aplicó?) y si hay más migraciones pendientes.
3. **Con OK del usuario**, aplicar la migración pendiente a prod vía MCP `apply_migration`.
4. Verificar la columna y un read de `isEventRevealGated` en prod.
5. Marcar ticket `done`, mover a Archivo, y mover el archivo a `backlog/tickets/done/`. (Sin PR de código si no hubo cambio de repo; anotar la acción de infra.)
