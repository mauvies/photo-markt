# T-034 · Control anti-abuso/coste para la búsqueda facial anónima (tiered caps + circuit breaker)

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno — la decisión de producto/diseño quedó resuelta por el spec del usuario (2026-07-16): caps escalonados + circuit breaker, sin cuota por plan.
- **Rama:** `feat/face-search-abuse-model`
- **OpenSpec change:** **sí** — toca BD (migración de tabla de contadores), seguridad y coste → `/opsx:propose` antes de implementar; `/code-review` antes de commitear (pagos/seguridad/BD).
- **PR:** #198

## Requerimiento
La búsqueda facial anónima llama a **AWS Rekognition**, facturado por llamada y **sin tope de gasto** del lado
de AWS — un atacante determinado contra el endpoint anónimo puede disparar una **factura ilimitada**. Todas las
llamadas a Rekognition pasan por nuestro backend → un único chokepoint para imponer límites. Implementar un
sistema de **caps escalonados** (por IP+evento/hora, por evento/día, global/día) con **contadores atómicos en
Postgres**, un **circuit breaker global configurable**, y **degradación elegante**.

### Parte 1 — 🔴 Investigar: ¿el rate limit actual es real? (respuesta preliminar: SÍ)
- **Hallazgo preliminar (verificado en captura):** el límite `(shareCode, IP)` de 10/hora **está persistido en
  Postgres y es atómico** — `src/lib/rate-limit.ts` usa el RPC `increment_rate_limit_bucket` (upsert+incremento
  en un solo round-trip, `SECURITY DEFINER`), backend `pgBackend`. **NO es in-memory** → sí hay protección por
  IP hoy. Confirmar formalmente la **lógica de ventana bajo concurrencia** (fixed-window alineada a epoch en
  `computeWindow`) y documentarlo.
- **Consecuencia:** la Parte 2 es **endurecer/extender** un control existente, no construir el primero. El
  agujero real es: (a) faltan los tiers **por-evento/día** y **global/día**; (b) se cuenta *búsquedas*, no
  *llamadas AWS*; (c) un atacante que **rota IPs** (proxies residenciales) evade el tier por-IP → sin el global
  breaker la exposición sigue siendo **ilimitada**.

### Parte 2 — Caps escalonados con contadores atómicos
Tres niveles, todos con contadores **atómicos** en Postgres (upsert de una sola sentencia con `RETURNING`, **no**
read-compare-write):
- **Por IP + evento, por hora** — el límite actual, ya persistido/atómico (reusar `rate-limit.ts`).
- **Por evento, por día** — ningún evento legítimo recibe miles de búsquedas; contiene un ataque **al evento
  objetivo** en vez de tumbar toda la plataforma.
- **Global, por día** — el **circuit breaker**: techo duro del gasto diario total.

Requisitos críticos de implementación:
- **Incremento atómico, un round-trip** — upsert con `RETURNING` (patrón `INSERT ... ON CONFLICT (day) DO UPDATE
  SET call_count = ... + N RETURNING call_count`). Read-then-check-then-write es un bug: una ráfaga concurrente
  lee el mismo valor, todos pasan el check, y el contador subcuenta justo cuando importa.
- **Incrementar ANTES de llamar a AWS**, decidir con el valor devuelto. Incrementar después deja pasar una ráfaga
  antes de que ninguno haya incrementado. Si la llamada AWS luego falla, el sobre-conteo es inofensivo (ser
  conservador no cuesta nada).
- **Contar llamadas AWS, no búsquedas.** Una búsqueda facial encadena `DetectFaces` + `SearchFacesByImage` = **2**
  llamadas facturables. Incrementar por el nº real de llamadas AWS de la operación (si no, el techo real es el
  doble del configurado).
- **Alcance:** el path de búsqueda facial **anónima/pública**. Indexado de fotos y detección de dorsales también
  pegan a AWS pero están detrás de un fotógrafo autenticado subiendo fotos reales (superficie mucho más difícil
  de abusar) → el contador que importa es el de búsqueda anónima. (Opcional: trackear indexado solo para
  visibilidad, pero el objetivo de enforcement es la búsqueda anónima.)

### Parte 3 — Caps configurables + alerting
- Los tres caps **configurables** (env vars o fila de config table) — **nunca hardcodeados**. Tráfico legítimo
  actual ≈ 0, así que el cap global arranca bajo (**sugerido ~2.000 llamadas AWS/día ≈ $2/día** de exposición
  máx.). Pero el día que un fotógrafo suba una carrera de 300 corredores, esos 300 atletas buscando **son tráfico
  real** — un cap afinado para hoy rompería el primer evento real.
- **Alerta al 50% del cap global:** email (reusar Resend) para enterarnos de que algo va mal — o de que hay que
  subir el cap — **antes** de que salte.
- **Exponer/loguear el uso actual** para poder consultarlo sin query a la BD.

### Parte 4 — Degradación elegante al saltar un cap
- Al saltar el breaker global, la búsqueda facial devuelve un **mensaje digno**, no un error:
  "Face search is temporarily unavailable" / "La búsqueda facial no está disponible temporalmente".
- **La búsqueda por dorsal (bib) sigue funcionando** — es un path aparte, no debe ser daño colateral.
- El resto de la app (browsing, carrito, checkout, flujos de fotógrafo) **no se ve afectado**.
- Un cap **por-evento** que salta afecta **solo a ese evento**; otros eventos siguen funcionando.

## Criterio de aceptación (Definition of Done)
- [ ] El mecanismo de storage del rate limit actual queda **documentado**; si fuera in-memory se marca "no había
      protección" y se reemplaza (preliminar: es Postgres/atómico → se endurece/extiende).
- [ ] Tres tiers impuestos: por IP+evento/hora, por evento/día, global/día.
- [ ] Contadores **atómicos** (upsert de una sentencia con `RETURNING`), correctos bajo invocaciones serverless
      concurrentes.
- [ ] El incremento ocurre **antes** de la llamada AWS; la decisión usa el conteo devuelto.
- [ ] Los contadores incrementan por **llamadas AWS reales (2 por búsqueda facial)**, no por nº de búsquedas.
- [ ] Todos los caps configurables vía env/config, no hardcodeados.
- [ ] La alerta por email dispara al **50%** del cap global.
- [ ] Al saltar un cap: la búsqueda facial degrada con mensaje claro; **la búsqueda por dorsal y el resto de la
      app no se afectan**; los saltos por-evento no afectan a otros eventos.
- [ ] Los contadores **resetean** correctamente por ventana día/hora.
- [ ] Strings nuevos en `en.json` y `es.json`.
- [ ] Tests: atomicidad/concurrencia del contador (ráfaga concurrente no subcuenta), incremento pre-AWS, conteo
      ×2 por búsqueda, salto de cada tier + degradación, bib intacto, alerta al 50%, reset de ventana. Migración
      idempotente/rollback-safe.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Contexto/historial:** la idea original ("cuota mensual por plan del fotógrafo") se descartó (T-036 borró la
  infra a medias `ai_search_usage` + `AI_SEARCH_RATE_LIMITS`) porque el buscador es anónimo y no es el dueño del
  plan. Este ticket es el **rediseño** con el modelo elegido: caps de coste + breaker, sin cuota por plan.
- **Infra:** contadores en **Postgres** vía Supabase — **sin infra nueva** (no Redis) salvo que la investigación
  dé una razón de peso. Reusar Resend para la alerta — sin libs nuevas. Mutaciones vía Server Actions; queries en
  `/src/database/queries/`. Nueva tabla de contadores con el patrón de `rate_limit_buckets`/`admin_users` (RLS
  on, sin políticas, solo `supabaseAdmin`; RPC `SECURITY DEFINER` con `revoke execute from anon, authenticated`).
- **Punto de enforcement:** `searchFacesInEvent` (`src/app/[lang]/events/[shareCode]/actions.ts`) + `src/lib/aws/`.
  Documentar el cambio de caps en CLAUDE.md (la sección "Rate limits" hoy dice "no per-plan monthly quota").
- **CAPTCHA — diferido a propósito, NO implementar aquí.** El CAPTCHA (p.ej. Cloudflare Turnstile) es el control
  que de verdad rompe la automatización (los límites por IP no, porque las IPs rotan trivialmente), pero con el
  breaker global bajo la exposición máx. es ~$2/día → no justifica la fricción de UX, y no hay usuarios aún.
  **Tripwire capturado en [[T-141]]** para revisitar la decisión cuando se suba el cap global para un evento
  real. **No** pre-construir un CAPTCHA flagueado-off (sería código sin usar).
- Sin `any`. Biome. **Sin otros cambios.**

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/face-search-abuse-model`.
2. `/opsx:propose` (toca BD/seguridad/coste) → `/opsx:apply`.
3. Implementar + tests de regresión/feature (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. `/code-review` sobre el diff (pagos/seguridad/BD) y arreglar findings reales antes de commitear.
6. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
7. `git push -u origin <rama>`.
8. `gh pr create --draft` apuntando a `main`.
9. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
10. `/opsx:archive`.
