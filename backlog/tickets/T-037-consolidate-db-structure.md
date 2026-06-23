# T-037 · Centralizar todo lo de base de datos en un solo lugar

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno duro (ver constraint de Supabase CLI en Notas — puede acabar siendo solo doc/decisión)
- **Rama:** `refactor/consolidate-db-structure`
- **OpenSpec change:** —  (se crea al ejecutar; toca >1 archivo y tiene una decisión de por medio)
- **PR:** —

## Requerimiento
Igual que se hizo con backlog/tickets (T-035), centralizar lo relacionado con la base de datos.
Hoy está repartido: el dir `supabase/` cuelga de la raíz (config.toml, migrations, seed.sql, `.branches`,
`.temp`) mientras que el código de DB de la app vive en `src/database/` (clientes + `queries/`). El usuario
quiere tenerlo todo junto/centralizado si es posible.

## Criterio de aceptación (Definition of Done)
- [ ] Decisión documentada de QUÉ se puede centralizar y qué no (ver constraint CLI), en `backlog`/`ARCHITECTURE.md` o README de DB
- [ ] La parte que sí se mueva queda en un único lugar coherente, con imports/paths actualizados
- [ ] `pnpm db:start && pnpm db:reset && pnpm db:seed` siguen funcionando (migrations + seed)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde
- [ ] Si se mueve `supabase/seed.sql`, actualizar el script `db:seed` en `package.json`

## Notas
**Tensión clave:** son dos capas distintas, no una sola cosa mal puesta:
- `supabase/` (raíz) = infra gestionada por el **Supabase CLI**. El CLI espera `supabase/` en la raíz del
  proyecto (config.toml, migrations, seed). Moverlo rompe `pnpm db:start/reset/seed` y el flujo de migraciones;
  `--workdir` existe pero es incómodo y se sale de la convención. → probablemente **no se debe mover**.
- `src/database/` = código de la app (clientes server/client/admin + `queries/`). Vive en `src/` por la
  convención de T-019 (PR #76: "todo el código fuente en `src/`"). Sacarlo de `src/` rompería esa convención.

Por eso "centralizar todo en un dir físico" choca con dos convenciones (CLI + T-019). Opciones realistas a
evaluar al ejecutar:
1. **Documentar el split** (recomendado de partida): dejar claro en `ARCHITECTURE.md`/README que DB tiene dos
   capas a propósito — infra (`supabase/`, CLI-bound) vs código app (`src/database/`) — y cerrar el ticket como
   doc. Cero riesgo, responde al "no encuentro las cosas".
2. **Reordenar dentro de cada capa** sin cruzar fronteras (p.ej. agrupar mejor dentro de `src/database/`,
   o un `src/database/README.md` que apunte a `supabase/`).
3. Centralización física real solo si se acepta pelear con el CLI — desaconsejado.

Empezar investigando si el CLI admite ubicación alternativa de forma limpia; si no, ir por opción 1/2.
Relacionado: T-019 (mover a `src/`, hecho), T-035 (consolidar backlog, hecho).
