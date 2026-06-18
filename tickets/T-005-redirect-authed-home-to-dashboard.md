# T-005 · Redirigir la home al dashboard cuando el usuario está autenticado

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `feat/authed-home-redirect`
- **OpenSpec change:** —  (decidir en implementación: toca routing + auth → si crece, `/opsx:propose`)
- **PR:** —

## Requerimiento
Cuando un usuario autenticado visita la home (`/[lang]`), redirigir a su dashboard según `active_role`:
- **TALENT** → tab de explore (explorar eventos).
- **PHOTOGRAPHER** → resumen del dashboard.
Usuarios no autenticados siguen viendo la home pública igual.

## Criterio de aceptación (Definition of Done)
- [ ] Visitar `/[lang]` autenticado redirige a la ruta correcta según `active_role` (server-side, antes de render — sin flash de la home)
- [ ] Talent → explore; Photographer → resumen del dashboard
- [ ] No autenticado → home pública sin cambios
- [ ] Se preserva el `[lang]` (es/en) en el destino
- [ ] Test de regresión: redirect por rol + no-redirect para invitado
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Implementar en el Server Component de la home (o middleware `proxy.ts` ya refresca sesión + locale — evaluar cuál encaja mejor; preferible el RSC para no ensuciar el middleware).
- Confirmar rutas destino exactas: explore de talent y "resumen" de photographer.
- **Decisión a confirmar (no blocker):** redirect duro deja al usuario autenticado sin poder ver la home pública/landing. Alternativa más suave: solo apuntar el link del logo al dashboard cuando está logueado, dejando la URL `/` accesible. Default acordado con el usuario = redirect; revisar si interfiere con SEO/landing.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/authed-home-redirect`.
2. Toca routing/auth → si el cambio se ramifica, `/opsx:propose`; si queda en 1–2 archivos, directo.
3. Implementar + test de regresión.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin feat/authed-home-redirect`.
7. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
8. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR.
