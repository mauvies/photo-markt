# T-219 · Podar el esquema muerto

- **Prioridad:** P2
- **Estado:** done
- **Riesgo:** alto  (BD/migraciones)
- **Blockers:** ninguno
- **Rama:** `refactor/prune-dead-schema`  (tipo = refactor)
- **OpenSpec change:** **sí** — varias tablas y columnas; conviene registrar qué se borra y por qué
- **PR:** #313

## Requerimiento

Capa arqueológica documentada como muerta pero nunca eliminada. Verificado contra producción y contra
`src/`:

| Artefacto | Estado verificado |
|---|---|
| `src/database/queries/payment-accounts.ts` | **226 LOC**, exportado desde `index.ts`, cero consumidores en `src/app` o `src/components` |
| `payouts.ts:85-92` | Sigue aceptando `paymentAccountId` y escribiendo `payment_account_id` |
| Tabla `ai_search_profiles` | Cero referencias en `src/` |
| Tabla `ai_search_usage` | Cero referencias (endurecida por RLS en `20260518000001`, pero muerta) |
| Tabla `time_sync_tokens` | Cero referencias |
| `events.start_date`, `end_date`, `time_offset`, `time_sync_enabled` | Columnas fantasma — nada las lee ni escribe |
| `profiles.is_admin` | Creada en `20260512000000`, **superseded** por `admin_users`; `CLAUDE.md` afirma que no existe |
| `events.organizer_fee_per_photo_cents` | Se **escribe** pero no lo lee ninguna ruta de dinero |

**El caso peligroso es `profiles.is_admin`:** existe una columna llamada `is_admin` que **no gatea
nada** — la autorización real va por `admin_users`. Un futuro colaborador puede razonablemente añadir
un check contra `is_admin` creyendo que es el mecanismo, y crear un bypass. Que la documentación ya
afirme que la columna no existe confirma que la deriva está en marcha.

## Criterio de aceptación (Definition of Done)

- [x] Migración que elimina tablas y columnas muertas, con comentario que enlace este ticket
- [x] `payment-accounts.ts` borrado y sacado de `index.ts`; `createPayout` deja de aceptar `paymentAccountId`
- [x] `profiles.is_admin` eliminada, o —si se conserva— documentada y con un test que impida usarla para autorizar
- [x] Decisión explícita sobre `organizer_fee_per_photo_cents`: implementar el reparto o dejar de escribir la columna
- [x] `CLAUDE.md` y `ARCHITECTURE.md` actualizados en el mismo PR
- [x] Test estilo `dead-billing-routes-removed.test.ts` que impida reintroducir los módulos
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Ejecutar **antes** de T-227 (cobertura de tests RLS) o coordinarlo: no vale la pena escribir tests RLS
para tablas que van a desaparecer.

La migración debe guardar cada `drop` con `if exists`, por la misma deriva prod/local que rompió la
migración del PR #279: el conjunto de migraciones no describe completamente producción.
