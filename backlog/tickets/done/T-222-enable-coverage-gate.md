# T-222 · Activar el gate de cobertura

- **Prioridad:** P2
- **Estado:** done
- **Riesgo:** normal
- **Blockers:** ninguno
- **Rama:** `chore/enable-coverage-thresholds`  (tipo = chore)
- **OpenSpec change:** —
- **PR:** #331

## Requerimiento

`vitest.config.ts:56-59` documenta un objetivo del 60 % y deja el bloque `thresholds` comentado *"hasta
que tengamos tests suficientes para superar 60 %"*. El informe versionado en el repo (18 jul) da
**43,0 % líneas / 37,8 % ramas** sobre los archivos instrumentados, y está seis semanas obsoleto.

Lo peor de ambos mundos: un objetivo declarado que nadie mide y un informe versionado que miente. Con
1.884 tests el número real casi seguro ha subido; nadie lo sabe.

## Criterio de aceptación (Definition of Done)

- [x] `pnpm test:coverage` corrido de nuevo y cifra real anotada en el PR
- [x] `thresholds` activado en el suelo real menos ~2 puntos (ratchet), **no** en 60 % de golpe
- [x] `coverage/` añadido a `.gitignore` — un informe versionado se vuelve obsoleto por construcción
- [x] El gate corre en el workflow `test` (rápido, sin Docker)
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Subir de golpe a 60 % bloquearía todos los PR. El patrón que funciona es fijar el suelo actual y
subirlo con cada PR que añada tests.

Nota para el CV / documentación externa: mientras esto no se resuelva, la métrica honesta a citar es
"1.884 casos de test, ratio test:src de 0,49, con tests de integración dedicados a RLS contra Postgres
real" — no un porcentaje de cobertura.
