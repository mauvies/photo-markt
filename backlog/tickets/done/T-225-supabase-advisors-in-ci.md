# T-225 · Correr `get_advisors` de Supabase en CI

- **Prioridad:** P1
- **Estado:** done
- **Riesgo:** normal
- **Blockers:** ninguno
- **Rama:** `ci/supabase-security-advisors`  (tipo = ci → usar `chore`)
- **OpenSpec change:** —
- **PR:** #282

## Requerimiento

El linter de seguridad de Supabase encontró la fuga de emails del PR #279 **en una sola llamada**, y
no está en ningún workflow. Es la herramienta con mejor relación coste/hallazgo del stack y hoy solo
se ejecuta si alguien se acuerda de mirarla a mano — que es exactamente lo que no pasó durante
dieciocho meses.

Detecta la clase de fallo que ni RLS, ni los tests, ni la revisión de migraciones cubren:
`SECURITY DEFINER` expuestas, RLS sin políticas, funciones con `search_path` mutable, extensiones en
`public`.

## Criterio de aceptación (Definition of Done)

- [x] Un job corre los advisors de seguridad contra **staging** (no prod: el token de CI no debe poder
      leer producción) en cada PR que toque `supabase/migrations/**`
- [x] El job **falla** ante hallazgos de nivel `ERROR` o `WARN` que no estén en una baseline declarada
- [x] Baseline versionada y comentada, con una línea por hallazgo aceptado explicando por qué
      (los siete `rls_enabled_no_policy` actuales son correctos — RLS activo sin políticas es
      denegación total, el patrón documentado de `admin_users` / `rate_limit_buckets`)
- [x] Los avisos `function_search_path_mutable` (**12**, no 10 — derivó desde que se escribió el ticket) se declaran en la baseline
- [x] Coste en minutos de Actions anotado en el workflow (ver T-217 — el presupuesto ya se agotó una vez)

## Notas

Vía de implementación a decidir: la API de management de Supabase (`/v1/projects/{ref}/advisors`) con
un token en secrets, o el MCP si hay forma no interactiva. La CLI no expone los advisors hoy —
verificar en la versión actual antes de asumir.

**Añadir el linter no sustituye al test de inventario de `SECURITY DEFINER`** que entró con el PR #279:
ese corre contra el esquema local y falla ante una función nueva sin declarar; este corre contra un
entorno real y detecta deriva que las migraciones no reflejan. Los dos hacen falta — el incidente
demostró que el esquema de prod y el que reconstruyes localmente no son el mismo.

## Resolución (PR #282)

Implementado con la **API de management** (`GET /v1/projects/{ref}/advisors/security`, PAT en
`secrets.SUPABASE_ACCESS_TOKEN`, que ya existía en el repo). El MCP no sirve — es interactivo — y la
CLI sigue sin exponer los advisors en 2.108.0.

- `.github/workflows/supabase-advisors.yml` — `pull_request` con paths `supabase/migrations/**` +
  los propios archivos del gate, más `workflow_dispatch`.
- `scripts/supabase-advisors.ts` — kernel puro (clave, nivel bloqueante, diff contra baseline,
  informe), testeado sin red en `test/unit/scripts/supabase-advisors.test.ts`.
- `scripts/check-supabase-advisors.ts` — cáscara de I/O, `pnpm advisors:check`, exit 1 si hay
  hallazgos sin declarar.
- `scripts/advisors-baseline.ts` — la baseline, con la razón por hallazgo.

Decisiones que conviene no revertir sin pensarlo:

- **La identidad de un hallazgo es `<lint>:<schema>.<name>(<args>)`, no el `cache_key` de la API.**
  Ese termina en un hash de la definición de la función: editar el cuerpo de un trigger retiraría la
  entrada de la baseline y rompería CI con una clave que nadie puede leer.
- **`INFO` no bloquea.** Los siete `rls_enabled_no_policy` son la configuración correcta; se declaran
  igual para dejar escrito el porqué y para que el gate no se ponga rojo si Supabase sube el nivel.
- **Los `function_search_path_mutable` se aceptan, no se arreglan.** Solo escalan privilegios si la
  función corre con permisos que el llamante no tiene, y todas son triggers SECURITY INVOKER salvo
  `order_has_photographer_items`. Fijarlos exige calificar por esquema cada cuerpo → migración DDL a
  aplicar a prod a mano (`migrate.yml` rojo por billing).
- ⚠️ **"El token de CI no debe poder leer producción" no lo puede cumplir la credencial**: un PAT de
  Supabase es de cuenta, no existe token por proyecto. El control es el `projectRef` de staging
  fijado en la baseline versionada, que aparece en el diff si cambia. Queda dicho en las cabeceras.

Verificación: se replicó el payload real de staging (27 hallazgos) contra el gate → 20 bloqueantes,
0 sin declarar, 0 obsoletos; el primer run en CI salió verde en 24 s. Verde typecheck + lint +
1908/1908 tests.

Coste de Actions: un job sin Docker ni `pnpm install` (solo `tsx` + una llamada HTTP), ~30–40 s, solo
en PRs de esquema. Anotado en el workflow.
