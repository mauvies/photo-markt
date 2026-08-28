---
description: Toma el siguiente ticket sin blockers del backlog y lo ejecuta de punta a punta
---

Ejecuta UN ticket siguiendo siempre el mismo flujo. Si `$ARGUMENTS` trae un ID (`T-002`), usa ese;
si no, toma la fila de **más arriba en `backlog/BACKLOG.md` con estado `todo` y sin blockers**.

Antes de empezar:
- Confirma que estás en un árbol limpio (`git status`). Si hay cambios sin commitear, para y avisa.
- Si no hay ningún ticket ejecutable (todos done/blocked), dilo y termina — no inventes trabajo.
- Lee el campo **`Riesgo:`** del ticket (`alto` = pagos · BD/migraciones · auth · seguridad · genuinamente
  ambiguo; `normal` = el resto). **Decide los pasos 3 y 6 con ese campo, no con tu criterio sobre la
  marcha.** Si el ticket no lo trae, dedúcelo **una sola vez** del contenido, dilo en voz alta, y mantén
  ese valor todo el ticket.
- **Recomienda modelo y esfuerzo antes de empezar** (informativo: tú no puedes cambiarlos).
  `Riesgo: alto` → Opus con esfuerzo alto. `Riesgo: normal` → el modelo de sesión basta.
  Si hace falta cambiarlo, dilo y espera a que el usuario lo haga con `/model`; no sigas asumiendo que sí.

Flujo (no te saltes pasos):
1. Marca el ticket `doing` en `backlog/BACKLOG.md` y en `backlog/tickets/T-XXX-*.md`.
2. `git checkout main && git pull --ff-only`, luego crea la rama `<tipo>/<slug>` del ticket.
3. **Diseño antes de implementar — lo decide el campo `Riesgo:`, no tú:**
   - **`Riesgo: alto`** (pagos · BD/migraciones · auth · seguridad · ambiguo de verdad):
     1. **`EnterPlanMode`** → explora el código, escribe el plan, **`ExitPlanMode`** y **espera la
        aprobación del usuario**. Esta es la **única puerta real** del flujo — OpenSpec no lo es. No la saltes.
     2. Ya aprobado: `/opsx:propose` para **transcribir el plan aprobado** a los artefactos
        (`proposal.md` / `design.md` / `tasks.md`) — **no para volver a diseñar**. Si al escribirlos
        aparece una decisión que el plan aprobado no cubría, **para y pregunta**; no la resuelvas dentro
        del artefacto (así es como el diseño acaba divergiendo de lo que se implementa).
     3. `/opsx:apply` para implementar.
     ⚠️ **El orden es obligatorio:** plan mode bloquea escrituras y `/opsx:propose` escribe archivos, así
     que OpenSpec **no puede correr dentro de plan mode**. Primero se aprueba, después se registra.
   - **`Riesgo: normal`** (UI, i18n, bug-fixes con requerimiento claro): implementa directo aunque toque
     varios archivos — el ticket ya captura el "qué" y el PR draft es el punto de revisión.
   Mira también el campo "OpenSpec change" del ticket.
4. Añade un test que falle antes y pase después (regla de CLAUDE.md). Strings nuevos → `en.json` y `es.json`.
   Si el ticket mueve/renombra rutas documentadas o cambia un patrón de arquitectura, actualiza
   `CLAUDE.md`/`ARCHITECTURE.md` en el mismo PR (si no toca nada documentado, no los toques).
5. `pnpm typecheck && pnpm lint && pnpm test`. Si algo falla, arréglalo antes de seguir.
6. **Revisión IA solo en PRs riesgosos:** si el ticket es **`Riesgo: alto`** (mismo campo del paso 3),
   revisa el diff antes de commitear. ⚠️ **Nunca `/code-review ultra`** — es una revisión multi-agente en
   la nube que se factura aparte; está descartada por coste. Usa lo de abajo, que corre en la sesión.
   - **Por defecto:** `/code-review high` sobre el diff local. Arregla los findings reales.
   - **Si el ticket toca dinero** (webhook de Stripe, `payouts`, checkout, precios), además lanza
     **3 subagentes independientes en paralelo** (Agent tool, una sola tanda), cada uno con una lente
     distinta y con el encargo de **refutar**, no de confirmar:
     1. «¿Por dónde puede completarse este flujo SIN que se pague al fotógrafo?»
     2. «¿Por dónde puede pagarse DOS veces?» — idempotencia, reintentos, redelivery de Stripe,
        orden de eventos no garantizado.
     3. «¿Qué falla en silencio?» — `catch` que no alerta, salidas sin log, filas que ningún
        selector de recuperación recoge.
     Cada uno devuelve `archivo:línea` + escenario de fallo concreto, o «ninguno». **Un finding solo
     cuenta si describe un escenario reproducible** — descarta lo que suene plausible sin mecanismo.
     Estas tres lentes salen de incidentes reales: T-252 (cobrado sin pagar), T-216 (doble pago),
     T-249 (pérdida silenciosa). No las cambies sin motivo.
   Para **UI/i18n/bug-fixes**, sáltalo todo — la revisión humana en el merge del draft alcanza.
7. Commit con Conventional Commits. **NUNCA** añadas el trailer `Co-Authored-By` (rompe el plan Vercel Hobby; un hook `PreToolUse` lo bloquea, pero igual no lo escribas).
8. `git push -u origin <rama>`.
9. `gh pr create --draft --base main`. **Título y cuerpo del PR SIEMPRE en inglés** (aunque el ticket esté en español):
   título = el commit, cuerpo = requerimiento + criterio de aceptación traducidos.
   (Draft a propósito: el usuario revisa y mergea; el repo es Free+private, sin branch protection por API.)
10. Marca el ticket `done`, muévelo a la sección Archivo de `backlog/BACKLOG.md` con el nº de PR, y mueve el archivo del ticket a `backlog/tickets/done/`.
11. Si hubo OpenSpec change, `/opsx:archive`.
12. Resume: ticket, rama, PR, y cuál es el siguiente en el backlog.

Si te bloqueas a mitad (test que no pasa, decisión de producto), deja el ticket `doing`, no mergees,
y reporta qué falta. Una rama = un ticket = un PR.
