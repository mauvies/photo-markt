# T-061 · Bug: el logo lleva al fotógrafo al dashboard de talento (y esa página revienta) en vez de al overview de fotógrafo

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/logo-home-redirect-by-role`
- **OpenSpec change:** — (bug fix de routing/rol; implementar directo)
- **PR:** #117

## Requerimiento
Estando en el rol de **fotógrafo**, en `/dashboard/photographer/events/[id]`, al hacer clic en el **logo de
Photo Markt** (que debería llevar al home del dashboard según el rol), en vez de ir al **overview del fotógrafo**
(`/dashboard/photographer`) lleva al **dashboard de talento**, y esa página **da un error / no se renderiza
correctamente**. Esperado: el logo lleva al fotógrafo a su propio dashboard (overview), sin error.

## Contexto / diagnóstico (código actual)
- El logo (en `src/components/app-sidebar.tsx:87` y `src/components/nav.tsx:47`) enlaza a `lp('/')` (home).
- Para usuarios autenticados, el middleware `src/proxy.ts` (~L94-107) intercepta el home e invoca
  `homeRedirectPath(true, profile.active_role)` (`src/lib/auth/home-redirect.ts`), leyendo `profiles.active_role`
  vía `getProfileFields`.
- `homeRedirectPath` en sí es correcto: `role === ROLES.PHOTOGRAPHER ? '/dashboard/photographer' : '/dashboard/talent'`.
  `ROLES.PHOTOGRAPHER === 'PHOTOGRAPHER'`. Por tanto, que un fotógrafo acabe en talento implica que el
  `active_role` leído en el redirect **no es `'PHOTOGRAPHER'`** en ese momento.
- **Dos facetas a investigar:**
  1. **Rol/redirect:** ¿`profiles.active_role` está desincronizado/obsoleto o no es `'PHOTOGRAPHER'` aunque el
     usuario esté navegando el dashboard de fotógrafo? (posible inconsistencia de estado de rol — existe historia
     de `role-state-consistency`). ¿El dashboard de fotógrafo es accesible sin que `active_role` coincida, creando
     el desajuste entre "dónde estoy" y "a dónde me manda el logo"?
  2. **Crash de talento:** el dashboard de talento **revienta** para este usuario — una página no debería crashear
     aunque se llegue por el rol equivocado. Investigar el error de render en `/dashboard/talent`.

## Criterio de aceptación (Definition of Done)
- [ ] Con rol activo de **fotógrafo**, el logo lleva a `/dashboard/photographer` (overview), no a talento.
- [ ] La decisión de destino del logo/redirect refleja el rol correcto del usuario (resolver la
      inconsistencia de `active_role`, o basar el destino en el contexto/rol vigente de forma robusta).
- [ ] El dashboard de **talento no crashea**: aunque un fotógrafo aterrice ahí, la página renderiza (o redirige)
      sin error. Reproducir y corregir el error de render.
- [ ] Verificar el caso simétrico: rol talento → el logo lleva a `/dashboard/talent` correctamente.
- [ ] test que falla antes y pasa después (p. ej. `homeRedirectPath`/resolución de destino por rol; y regresión
      del render de la página de talento que fallaba).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Archivos: `src/proxy.ts` (redirect del home), `src/lib/auth/home-redirect.ts`, `src/lib/roles.ts`,
  lectura de `profiles.active_role` (`getProfileFields`), y la página que crashea `src/app/[lang]/dashboard/talent/**`.
- Pistas a confirmar en repro: ¿cuál es el `active_role` real de la cuenta afectada? ¿el crash de talento es por
  falta de datos (perfil talento incompleto) o un bug de la página? Traer el mensaje de error si es posible.
- Reportado sobre `/dashboard/photographer/events/b5b4a5ee-ed3a-430c-a62e-293cf7970410`.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
