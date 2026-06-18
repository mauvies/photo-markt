---
description: Toma el siguiente ticket sin blockers del backlog y lo ejecuta de punta a punta
---

Ejecuta UN ticket siguiendo siempre el mismo flujo. Si `$ARGUMENTS` trae un ID (`T-002`), usa ese;
si no, toma la fila de **más arriba en `BACKLOG.md` con estado `todo` y sin blockers**.

Antes de empezar:
- Confirma que estás en un árbol limpio (`git status`). Si hay cambios sin commitear, para y avisa.
- Si no hay ningún ticket ejecutable (todos done/blocked), dilo y termina — no inventes trabajo.

Flujo (no te saltes pasos):
1. Marca el ticket `doing` en `BACKLOG.md` y en `tickets/T-XXX-*.md`.
2. `git checkout main && git pull --ff-only`, luego crea la rama `<tipo>/<slug>` del ticket.
3. **OpenSpec solo cuando lo amerita:** usa `/opsx:propose` → `/opsx:apply` si el ticket toca **base de datos/migraciones, auth/seguridad, pagos, o es genuinamente ambiguo** (hay diseño/spec que capturar antes). Para **UI, i18n y bug-fixes** con requerimiento claro, implementa directo aunque toque varios archivos — el ticket ya captura el "qué" y el PR draft es el punto de revisión. Mira el campo "OpenSpec change" del ticket.
4. Añade un test que falle antes y pase después (regla de CLAUDE.md). Strings nuevos → `en.json` y `es.json`.
5. `pnpm typecheck && pnpm lint && pnpm test`. Si algo falla, arréglalo antes de seguir.
6. Commit con Conventional Commits. **NUNCA** añadas el trailer `Co-Authored-By` (rompe el plan Vercel Hobby).
7. `git push -u origin <rama>`.
8. `gh pr create --draft --base main`. **Título y cuerpo del PR SIEMPRE en inglés** (aunque el ticket esté en español):
   título = el commit, cuerpo = requerimiento + criterio de aceptación traducidos.
   (Draft a propósito: el usuario revisa y mergea; el repo es Free+private, sin branch protection por API.)
9. Marca el ticket `done`, muévelo a la sección Archivo de `BACKLOG.md` con el nº de PR.
10. Si hubo OpenSpec change, `/opsx:archive`.
11. Resume: ticket, rama, PR, y cuál es el siguiente en el backlog.

Si te bloqueas a mitad (test que no pasa, decisión de producto), deja el ticket `doing`, no mergees,
y reporta qué falta. Una rama = un ticket = un PR.
