# T-224 · Unit tests en serie: 4,8 s de test dentro de una corrida de 39,5 s

- **Prioridad:** P3
- **Estado:** todo
- **Riesgo:** normal
- **Blockers:** ninguno
- **Rama:** `chore/parallel-unit-tests`  (tipo = chore)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

`vitest.config.ts:27-28` fija `pool: 'forks'` + `fileParallelism: false` **globalmente**. El motivo es
correcto pero aplica solo a integración: esos tests comparten una instancia local de Supabase y se
pisarían entre ellos.

Medido: **178 archivos, 1.180 tests, 39,46 s totales — de los cuales `tests` son 4,82 s**. El resto es
`import` (14,62 s) y `environment` (6,04 s) pagados en serie. El comentario afirma que "las corridas
solo-unit no se ralentizan de forma apreciable"; la medición dice que **el 88 % del tiempo no es
ejecución de test**.

## Criterio de aceptación (Definition of Done)

- [ ] `fileParallelism: false` movido a una configuración específica de integración (workspace/proyecto
      de Vitest), dejando unit en paralelo
- [ ] Tiempo antes/después anotado en el PR
- [ ] La suite completa (`pnpm test`) sigue en verde — es el escenario donde el aislamiento importa
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

Impacto real: ~30 s por corrida en el bucle interno del desarrollador, ejecutado muchas veces al día,
más el mismo ahorro en cada PR de CI. Bajo riesgo, retorno diario.
