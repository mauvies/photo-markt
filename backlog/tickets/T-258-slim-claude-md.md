# T-258 · `CLAUDE.md` pesa ~29k tokens y se carga entero en cada sesión

- **Prioridad:** P2
- **Estado:** todo
- **Riesgo:** normal  (solo documentación)
- **Blockers:** ninguno
- **Rama:** `docs/slim-claude-md`  (tipo = chore)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

`CLAUDE.md` son **1.096 líneas / ~107 KB / ~29.000 tokens**, y se carga íntegro al empezar cada
sesión, antes de que se haga nada. Además crece: **37 de los últimos 300 commits** lo tocan.

Su densidad es justamente por qué la calidad del trabajo aquí es alta — no es hinchazón. Pero mezcla
dos cosas con vida útil muy distinta:

- **Invariantes y prohibiciones** — "gatea por la membresía, nunca por `active_role`", "la fila se abre
  antes de la llamada a Stripe", "`.single()` solo cuando el nº de filas está garantizado". Esto tiene
  que estar cargado siempre: es lo que impide reintroducir el bug.
- **Arqueología** — la narración de *qué* pasó en T-219, T-249, T-252, cuánto costó y en qué orden.
  Es valiosísima, pero se consulta **cuando se toca esa zona**, no en cada sesión.

Quiero mover la segunda categoría fuera, sin perder una sola regla.

## Criterio de aceptación (Definition of Done)

- [ ] `CLAUDE.md` baja de forma sustancial (objetivo: **< 12k tokens**) sin que desaparezca **ninguna**
      regla accionable — cada invariante sigue en `CLAUDE.md`, con un puntero a dónde está su historia
- [ ] La narrativa de incidentes se traslada a `ARCHITECTURE.md` o a un `backlog/DECISIONS.md`,
      referenciada desde la regla correspondiente
- [ ] Ninguna referencia a fichero, función o flag queda apuntando a algo que ya no existe
- [ ] Verificación explícita antes de cerrar: recorrer los ⚠️ del fichero actual uno a uno y confirmar
      que cada uno sobrevive (son las trampas caras — el `user_roles` vacío, el `active_role`, la
      migración editada, el `eventAcceptsBundleConfig` vs `eventSupportsBundles`)

## Notas

⚠️ **El riesgo real de este ticket es perder una regla por el camino**, y el coste de eso es mucho
mayor que los tokens que ahorra. Ante la duda, la regla se queda. Un recorte que deje `CLAUDE.md`
bonito pero pierda un ⚠️ es un fracaso, no un éxito.

Medición de partida (2026-08-27): 1.096 líneas · 107.608 bytes · ~29.083 tokens.
`ARCHITECTURE.md` son 799 líneas · 34.315 bytes y **no** se carga automáticamente — es el destino
natural.

Hacerlo en un momento tranquilo, no entre dos tickets de pagos.
