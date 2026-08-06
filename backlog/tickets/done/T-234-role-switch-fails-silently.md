# T-234 · Cambiar a rol fotógrafo no hace nada y el error se traga en silencio

- **Prioridad:** P1
- **Estado:** done
- **Riesgo:** alto  (auth/roles + estado de sesión; además la causa raíz no está identificada)
- **Blockers:** ninguno
- **Rama:** `fix/role-switch-silent-failure`  (tipo = fix)
- **OpenSpec change:** —
- **PR:** #286

## Requerimiento

Estando en `https://www.photomarkt.com/en/dashboard/talent/events`, al intentar cambiar al rol de
fotógrafo **no sucede nada**. En los logs de producción:

```
2026-08-06 09:21:24.746 [error] Error: Role is not enabled for this user.
    at u (.next/server/chunks/ssr/_0fkgk_o._.js:2:8882)
    ... Module.N [as handler] (…app-page…)
  digest: '2359914048'
```

## Diagnóstico (consultado contra prod, no supuesto)

**El usuario SÍ tiene el rol.** Consultado el proyecto de producción (`yzdlueeeizdqwuicydbr`):

| | |
|---|---|
| `user_role_memberships` de `mauricio.viera6@gmail.com` | `{PHOTOGRAPHER, TALENT}` |
| `enabled_at` de la membresía PHOTOGRAPHER | **2026-07-01 08:31:08Z** — más de un mes antes del error |
| `profiles.active_role` del mismo usuario | **`PHOTOGRAPHER`** (¡mientras navegaba `/dashboard/talent/…`!) |
| RLS de `user_role_memberships` | una política, `user_role_memberships_self_all`, `ALL USING (user_id = auth.uid())` — correcta |

⚠️ **Ojo con la tabla:** el código lee **`user_role_memberships`**, no `user_roles` (esta última
existe y está **vacía** — 0 filas — y es una pista falsa fácil de seguir).

O sea: la fila existe, es vieja, y la política RLS permite leerla. Así que el `throw` de
`switchRole` (`src/app/[lang]/actions/roles.ts:195`) solo puede venir de que
`getUserRoles(supabase, user.id)` devolviera **`[]`** en ese momento — una lectura vacía, no un
error (PostgREST devuelve `[]` sin error cuando RLS filtra todas las filas). Hipótesis principal a
confirmar: la sesión con la que se ejecuta la acción no resuelve `auth.uid()` al usuario (cookie
desincronizada / token caducado a mitad de sesión), así que la política no casa y la lectura sale
vacía. **No confirmado** — hay que reproducirlo.

Pista adicional sin explicar: `active_role` ya era `PHOTOGRAPHER` en la BD mientras el usuario
estaba en el dashboard de talento, o sea que la UI y la BD ya discrepaban **antes** de pulsar.

### Segundo defecto, independiente de la causa raíz y que hay que arreglar igual

El fallo es **invisible**. Ambos conmutadores de rol atrapan la excepción y no hacen nada más que
revertir el estado optimista:

- `src/components/dashboard-user-menu.tsx:96` → `catch { addOptimisticRole(activeRole); }`
- `src/components/bottom-nav-account.tsx:~110` → mismo patrón

Sin toast, sin mensaje, sin reintento. Eso es literalmente el "no sucede nada" que se reporta: la
acción falla en el servidor y el usuario no tiene forma de saberlo ni de saber qué hacer.

### Tercer punto: la asimetría hace el fallo unidireccional

`resolveRoleSwitch` (`src/lib/roles.ts:40`) **auto-habilita TALENT** si no lo tienes, pero
PHOTOGRAPHER no. Consecuencia: con una lectura de roles vacía, cambiar **a talento siempre
funciona** (se auto-habilita) y cambiar **a fotógrafo siempre falla**. Encaja exactamente con el
síntoma reportado, y explica por qué el usuario puede quedar atrapado en el lado de talento.

## Criterio de aceptación (Definition of Done)

- [ ] **Reproducida la causa raíz** de la lectura vacía de roles y documentada en el PR (si es la
      sesión, qué la desincroniza; si es otra cosa, cuál)
- [ ] Cambiar a fotógrafo funciona para un usuario que tiene la membresía
- [ ] **Un cambio de rol que falla se lo dice al usuario** (toast localizado con motivo), nunca
      queda en silencio — ni en el menú de escritorio ni en la bottom nav
- [ ] El error viaja como **código tipado** a través del límite RSC, no como mensaje lanzado
      (Next redacta los mensajes de Server Action en producción — el hallazgo de T-189; ver
      `AvatarActionResult` en `actions/avatar.ts` como patrón ya establecido en el repo)
- [ ] Decidido y documentado qué hacer cuando el rol destino **realmente** no está habilitado:
      ofrecer habilitarlo, o explicar por qué no se puede (hoy solo TALENT se auto-habilita, y esa
      asimetría no está justificada en ningún sitio)
- [ ] Revisada la divergencia `active_role` vs. dashboard visitado — o se corrige, o se documenta
      por qué es legítima
- [ ] Strings nuevos en `en.json` y `es.json`
- [ ] Test de regresión que falla antes y pasa después (mínimo: la acción rechaza → la UI muestra el
      error en vez de revertir en silencio)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

- **Riesgo `alto`** por tocar auth/roles: `/work-next` entra en plan mode y espera aprobación, y
  corre `/code-review` antes de commitear.
- **P1, no P0:** hay salida — `active_role` ya es `PHOTOGRAPHER` en la BD, así que navegar directo a
  `/dashboard/photographer` probablemente funciona (**verificar**, no está comprobado). Va alto
  porque deja al usuario encerrado en el dashboard equivocado sin ninguna pista de por qué.
- Superficies implicadas: `src/app/[lang]/actions/roles.ts` (`switchRole`, `getUserRoles`),
  `src/lib/roles.ts` (`resolveRoleSwitch`), `src/database/queries/user-roles.ts`,
  `src/components/dashboard-user-menu.tsx`, `src/components/bottom-nav-account.tsx`, y
  `src/app/auth/role/route.ts` (tercer llamador de `switchRole`, por GET — revisar que no herede el
  mismo silencio).
- Contexto relacionado: **T-189** (los mensajes lanzados desde Server Actions se redactan en prod —
  por eso el criterio del código tipado), **T-198** (guardas de auth en los layouts del dashboard),
  **T-182** (`AvatarActionResult`, el patrón de unión discriminada para errores que cruzan RSC).

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
