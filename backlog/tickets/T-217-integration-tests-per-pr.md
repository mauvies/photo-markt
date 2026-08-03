# T-217 · Los tests de integración no corren por PR — una regresión puede mergear

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** normal
- **Blockers:** ninguno
- **Rama:** `chore/integration-tests-on-risky-paths`  (tipo = chore)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

`test-integration.yml` solo corre **nocturno (04:17 UTC) y bajo demanda**. La justificación escrita es
que el flujo `/work-next` corre la suite completa localmente antes de cada push, así que CI es "red
secundaria, no el gate".

Eso hace que la red dependa de la disciplina humana: **cualquier PR mergeado sin haber pasado la suite
local rompe `main` y no se descubre hasta la mañana siguiente.**

Los 82 archivos de integración cubren exactamente lo que no se puede permitir romper: webhook de
Stripe, RLS, workers de Inngest, checkout con bundles, gate de revelado, y —desde el PR #279— el
inventario de funciones `SECURITY DEFINER`.

## Criterio de aceptación (Definition of Done)

- [ ] La suite de integración corre **o bien** en PR con `paths` acotado a rutas de riesgo
      (`supabase/migrations/**`, `src/database/**`, `src/app/api/**`, `src/lib/inngest/**`,
      `src/lib/stripe/**`), **o bien** en `push: [main]`
- [ ] La decisión y su motivo quedan en el comentario del propio workflow
- [ ] Consumo estimado de minutos/mes anotado en el workflow
- [ ] Se mantiene la corrida nocturna como red de flakes
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

El comentario actual del workflow rechaza explícitamente el path-allowlist por "carga de mantenimiento
y su modo de fallo silencioso". Es un argumento legítimo. La alternativa que lo evita es correr en el
**merge a `main`** en vez de en el PR: no necesita allowlist y detecta la rotura en minutos en vez de
en horas. Elegir una de las dos — lo que no es defendible es la ventana actual de hasta 24 h.

Contexto del presupuesto: el plan gratuito de Actions se agotó en julio de 2026 y por eso se partió el
CI (PR #256). Cualquier opción aquí debe cuantificar su coste antes de mergear.
