# T-225 · Correr `get_advisors` de Supabase en CI

- **Prioridad:** P1
- **Estado:** todo
- **Riesgo:** normal
- **Blockers:** ninguno
- **Rama:** `ci/supabase-security-advisors`  (tipo = ci → usar `chore`)
- **OpenSpec change:** —
- **PR:** —

## Requerimiento

El linter de seguridad de Supabase encontró la fuga de emails del PR #279 **en una sola llamada**, y
no está en ningún workflow. Es la herramienta con mejor relación coste/hallazgo del stack y hoy solo
se ejecuta si alguien se acuerda de mirarla a mano — que es exactamente lo que no pasó durante
dieciocho meses.

Detecta la clase de fallo que ni RLS, ni los tests, ni la revisión de migraciones cubren:
`SECURITY DEFINER` expuestas, RLS sin políticas, funciones con `search_path` mutable, extensiones en
`public`.

## Criterio de aceptación (Definition of Done)

- [ ] Un job corre los advisors de seguridad contra **staging** (no prod: el token de CI no debe poder
      leer producción) en cada PR que toque `supabase/migrations/**`
- [ ] El job **falla** ante hallazgos de nivel `ERROR` o `WARN` que no estén en una baseline declarada
- [ ] Baseline versionada y comentada, con una línea por hallazgo aceptado explicando por qué
      (los siete `rls_enabled_no_policy` actuales son correctos — RLS activo sin políticas es
      denegación total, el patrón documentado de `admin_users` / `rate_limit_buckets`)
- [ ] Los avisos `function_search_path_mutable` (10 funciones) se arreglan o se declaran en la baseline
- [ ] Coste en minutos de Actions anotado en el workflow (ver T-217 — el presupuesto ya se agotó una vez)

## Notas

Vía de implementación a decidir: la API de management de Supabase (`/v1/projects/{ref}/advisors`) con
un token en secrets, o el MCP si hay forma no interactiva. La CLI no expone los advisors hoy —
verificar en la versión actual antes de asumir.

**Añadir el linter no sustituye al test de inventario de `SECURITY DEFINER`** que entró con el PR #279:
ese corre contra el esquema local y falla ante una función nueva sin declarar; este corre contra un
entorno real y detecta deriva que las migraciones no reflejan. Los dos hacen falta — el incidente
demostró que el esquema de prod y el que reconstruyes localmente no son el mismo.
