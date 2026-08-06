# T-235 · `getEvent` filtra un PostgrestError crudo (PGRST116) en vez de "evento no encontrado"

- **Prioridad:** P1
- **Estado:** doing
- **Riesgo:** normal  (capa de queries + manejo de errores; no toca pagos ni escribe nada)
- **Blockers:** ninguno
- **Rama:** `fix/get-event-null-instead-of-pgrst116`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

Al re-indexar el evento `8192a562-9c82-4a3b-859e-c46dd2ae1f25` en producción:

```
2026-08-06 09:22:28.385 [error] Error [PostgrestError]: Cannot coerce the result to a single JSON object
    at G.processResponse (…@supabase_supabase-js…)
    at async P (…dashboard_photographer_events_[id]_actions_ts…)
    at async V (…dashboard_photographer_events_[id]_actions_ts…)
  details: 'The result contains 0 rows',
  code: 'PGRST116',
  digest: '4135694387'
}
```

## Diagnóstico

**El defecto de código es certero y está en una línea.** `getEvent`
(`src/database/queries/events.ts:156`) declara devolver `Promise<Event | null>`, pero encadena
`.single().throwOnError()`:

```ts
const { data, error } = await supabase
  .from('events').select('*')
  .eq('id', eventId).eq('user_id', userId).is('deleted_at', null)
  .single()
  .throwOnError();          // ← lanza el PostgrestError crudo ANTES del if (error)

if (error) { throw new Error(`Failed to get event: …`); }   // inalcanzable
return data as Event | null;                                 // nunca devuelve null
```

Con 0 filas, PostgREST responde `PGRST116` y `.throwOnError()` lo lanza tal cual. Consecuencias:

1. **La firma miente.** `| null` es inalcanzable: la función o devuelve un evento o revienta.
2. **El guardia de los llamadores es código muerto.** `requireEventOwner`
   (`events/[id]/actions.ts:598`) hace `const event = await getEvent(...); if (!event) throw new
   Error('Event not found.')` — ese `if` **no se ejecuta jamás**. Mismo patrón en los otros
   llamadores.
3. **El usuario ve la fontanería.** "Cannot coerce the result to a single JSON object" en vez de
   "evento no encontrado o sin permiso". Y como Next redacta los mensajes de Server Action en
   producción (T-189), lo que llega al navegador es aún menos útil.

`getEvent` tiene **8 llamadores** en 5 archivos (acciones de listado, detalle, edición y las dos
páginas), así que el arreglo es de un sitio y el beneficio es de todos. Comprobado: es la **única**
query del repo que combina `.single()` con `.throwOnError()` — el resto ya usa `maybeSingle()`.

## Por qué había 0 filas — dos hipótesis, ninguna confirmada

Consultado prod (`yzdlueeeizdqwuicydbr`), el evento **existe y está sano**:

| | |
|---|---|
| `Cross-Road Huelva` | `deleted_at` NULL, `ai_matching_enabled` **true**, `ai_matching_status` `idle` |
| Propietario | `30d1f8da-…` = **photo.markt.team@gmail.com** |

1. **Sesión equivocada:** si quien pulsó era `mauricio.viera6@gmail.com`, no es el propietario, el
   `.eq('user_id', userId)` no casa y salen 0 filas. Sería el comportamiento correcto mal
   comunicado. (Pendiente: entender cómo llegó a ver el botón de re-indexar, que solo se pinta en la
   vista de propietario.)
2. ⚠️ **Puede ser el mismo fallo que T-234.** El error de roles es de **09:21:24** y este de
   **09:22:28** — 64 segundos después, misma sesión, y **ambos son lecturas con RLS que devuelven
   vacío**: allí `getUserRoles` → `[]`, aquí `getEvent` → 0 filas. Si `auth.uid()` no resuelve en el
   cliente Supabase de las Server Actions, los dos síntomas salen solos. **Investigar T-234 primero
   y comprobar si esto cae con él.**

Sea cual sea la causa, el arreglo de forma del error va igual: una lectura vacía nunca debe llegar al
usuario como un error del driver.

## Criterio de aceptación (Definition of Done)

- [ ] `getEvent` devuelve **`null`** cuando no hay fila (cambiar a `maybeSingle()` y quitar el
      `.throwOnError()`), y sigue lanzando ante un error real de BD
- [ ] Los guardias `if (!event) throw new Error('Event not found.')` de los llamadores dejan de ser
      código muerto — verificado, no supuesto
- [ ] Re-indexar un evento que no existe / no es tuyo da un error **con sentido**, no
      "Cannot coerce the result to a single JSON object"
- [ ] El motivo cruza el límite RSC como **código tipado**, no como mensaje lanzado (Next los redacta
      en prod — T-189; patrón ya establecido en `AvatarActionResult`)
- [ ] Revisados los 8 llamadores de `getEvent`: ninguno depende de que lance (un `try/catch` que hoy
      atrape el PGRST116 dejaría de dispararse al devolver `null`)
- [ ] Strings nuevos en `en.json` y `es.json` (si la copia de error se localiza)
- [ ] Test de regresión que falla antes y pasa después: `getEvent` con un id inexistente → `null`,
      y `reindexEvent` sobre un evento ajeno → error tipado, no `PGRST116`
- [ ] **`getUserRole` (`queries/user-roles.ts`) — misma familia, hallado al ejecutar T-234:** usa
      `.maybeSingle()` sobre `user_role_memberships`, tabla que legítimamente tiene **2 filas** para
      un usuario con ambos roles → PGRST116 («more than one row») en la puerta del **onboarding**
      (`/onboarding/role` lo llama para decidir si el usuario ya tiene rol). El arreglo es del mismo
      tipo: devolver la lista, o `.limit(1)` si de verdad solo importa «¿tiene alguno?»
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

- **P1** porque rompe una acción real del fotógrafo en producción con un mensaje que no le dice nada,
  y el guardia de propiedad que debería haber contestado está muerto. No es P0: no hay pérdida de
  datos ni de dinero, y no toca el gate de propiedad en sí — quien no es dueño sigue sin poder
  re-indexar, solo que se entera mal.
- **Riesgo `normal`**: cambiar `.single()` por `.maybeSingle()` no relaja ningún filtro de seguridad;
  `.eq('user_id', userId)` y el RLS siguen intactos. Lo único que cambia es cómo se comunica el
  vacío. Aun así, revisar los 8 llamadores es parte del DoD, porque pasar de "lanza" a "devuelve
  null" **sí** cambia el flujo de control de quien lo envuelva en `try/catch`.
- Contexto relacionado: **T-234** (posible causa raíz compartida — sesión que no resuelve
  `auth.uid()`), **T-231** (mismo evento `Cross-Road Huelva`, otro fallo), **T-189** (mensajes de
  Server Action redactados en prod).
- Dato aparte que conviene mirar de paso: el evento tiene `ai_matching_enabled = true` pero
  `ai_matching_status = 'idle'` con una sola foto ya `approved` + `indexed`/`not_applicable`. Si el
  re-indexado nunca llegó a correr, esa incoherencia de estado puede ser secuela de T-231 (el worker
  apuntando al proyecto equivocado). No forma parte de este ticket; anotarlo si reaparece.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
