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
   Si el ticket mueve/renombra rutas documentadas o cambia un patrón de arquitectura, actualiza
   `CLAUDE.md`/`ARCHITECTURE.md` en el mismo PR (si no toca nada documentado, no los toques).
5. `pnpm typecheck && pnpm lint && pnpm test`. Si algo falla, arréglalo antes de seguir.
6. **Revisión IA solo en PRs riesgosos:** si el ticket tocó **pagos/auth/BD-migraciones/seguridad** (mismo criterio que OpenSpec en el paso 3), corre `/code-review` sobre el diff antes de commitear (`/code-review ultra` para pagos) y arregla los findings reales. Para **UI/i18n/bug-fixes**, sáltalo — la revisión humana en el merge del draft alcanza.
7. Commit con Conventional Commits. **NUNCA** añadas el trailer `Co-Authored-By` (rompe el plan Vercel Hobby; un hook `PreToolUse` lo bloquea, pero igual no lo escribas).
8. `git push -u origin <rama>`.
9. `gh pr create --draft --base main`. **Título y cuerpo del PR SIEMPRE en inglés** (aunque el ticket esté en español):
   título = el commit, cuerpo = requerimiento + criterio de aceptación traducidos.
   (Draft a propósito: el usuario revisa y mergea; el repo es Free+private, sin branch protection por API.)
10. Marca el ticket `done`, muévelo a la sección Archivo de `BACKLOG.md` con el nº de PR.
11. Si hubo OpenSpec change, `/opsx:archive`.
12. Resume: ticket, rama, PR, y cuál es el siguiente en el backlog.

Si te bloqueas a mitad (test que no pasa, decisión de producto), deja el ticket `doing`, no mergees,
y reporta qué falta. Una rama = un ticket = un PR.
