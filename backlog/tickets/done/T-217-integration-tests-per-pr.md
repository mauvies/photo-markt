# T-217 · Los tests de integración no corren por PR — una regresión puede mergear

- **Prioridad:** P1
- **Estado:** done
- **Riesgo:** normal
- **Blockers:** ninguno
- **Rama:** `chore/integration-tests-on-risky-paths`  (tipo = chore)
- **OpenSpec change:** —
- **PR:** #283

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

- [x] La suite de integración corre en **`push: [main]`** (la segunda opción; el allowlist se descartó
      con motivo — ver Resolución)
- [x] La decisión y su motivo quedan en el comentario del propio workflow
- [x] Consumo estimado de minutos/mes anotado en el workflow
- [x] Se mantiene la corrida nocturna como red de flakes
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

El comentario actual del workflow rechaza explícitamente el path-allowlist por "carga de mantenimiento
y su modo de fallo silencioso". Es un argumento legítimo. La alternativa que lo evita es correr en el
**merge a `main`** en vez de en el PR: no necesita allowlist y detecta la rotura en minutos en vez de
en horas. Elegir una de las dos — lo que no es defendible es la ventana actual de hasta 24 h.

Contexto del presupuesto: el plan gratuito de Actions se agotó en julio de 2026 y por eso se partió el
CI (PR #256). Cualquier opción aquí debe cuantificar su coste antes de mergear.

## Resolución (PR #283)

**Elegida `push: [main]`.** El motivo decisivo es que el allowlist propuesto en este mismo DoD ya
tenía un hueco: `supabase/migrations/**` + `src/database/**` + `src/app/api/**` +
`src/lib/{inngest,stripe}/**` **salta `test/integration/actions/` entero**, porque los Server Actions
viven bajo `src/app/[lang]/**`. Es exactamente el modo de fallo silencioso que el comentario del
workflow ya le achacaba al allowlist, ahora con un caso concreto. Merge-a-main no necesita lista y por
eso no tiene hueco.

Los otros dos motivos:

- **Coste acotado por merges, no por pushes:** ~8,5 min × ~19 PRs mergeados/30 días ≈ **160 min/mes**
  (8 % del cupo Free), encima de los ~255 min/mes del nocturno. La opción por-PR re-corre en cada push.
- **El repo no tiene branch protection** (Free + private), así que un check por PR tampoco habría
  bloqueado el merge. Ambas son consultivas; solo esta es exhaustiva.

Latencia de detección: de hasta 24 h a **~9 min**. El nocturno se queda como **red de flakes** (misma
suite contra un `main` sin cambios ⇒ un fallo sin merge de por medio es flake o deriva externa).

Fijado por `test/unit/ci/integration-suite-trigger.test.ts`: borrar el trigger `push` para ahorrar
minutos es una edición futura plausible que restauraría la ventana de 24 h en silencio, y debería
tener que discutir primero con un test rojo. Verificado **rojo antes** (1 fallo / 3 pasan) y verde
después.

⚠️ **Contradice a propósito la nota "no re-añadir `push:[main]`" del PR #256.** Aquella se justificaba
en que "el run del PR ya validó" — premisa que caducó el día que integración salió de los PRs.

Dato de contexto encontrado de paso: **el bloqueo de billing de Actions está resuelto**. Los nocturnos
morían en ~3 s hasta el 2026-07-31 y pasan desde el 2026-08-01.
