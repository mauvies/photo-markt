# T-034 · [DISEÑO] Modelo anti-abuso y control de coste para la búsqueda facial

- **Prioridad:** P2
- **Estado:** blocked  (necesita decisión de producto/diseño — ver abajo)
- **Blockers:** **decisión de producto** — ¿de quién es la cuota y cómo se controla el abuso/coste si quien busca es anónimo?
- **Rama:** `feat/face-search-abuse-model` (cuando se desbloquee)
- **OpenSpec change:** **sí** — diseño + BD. `/opsx:propose` cuando haya decisión.
- **PR:** —

## El problema (descubierto al ejecutar, 2026-06-22)
La idea original era "cuota mensual de búsqueda IA por plan (Free 10 / Starter 20 / Pro ilimitado) + búsquedas
guardadas revisitar-sin-gastar". Al implementarlo aparece un **desajuste de dominio que bloquea el diseño**:

- **Quien busca es talent/invitado, normalmente SIN cuenta.** `searchFacesInEvent` es *anonymous-friendly*,
  limitado hoy solo por `(shareCode, IP)` a 10/hora (`src/lib/rate-limit.ts`).
- **La cuota "N búsquedas/mes" se anuncia en los planes del FOTÓGRAFO** (Free/Starter/Pro = suscripción del
  fotógrafo). El buscador (talent) **no es** el dueño del plan.
- Existía infra a medias: tabla `ai_search_usage` (keyed por `user_id`) + funciones SQL
  `increment_ai_search_usage`/`get_ai_search_usage_count`, **nunca cableadas** (probablemente abandonadas por este
  mismo desajuste). El config TS `AI_SEARCH_RATE_LIMITS` era código muerto. → **Eliminado en T-036.**
- **`ai_search_profiles`** (filtros de búsqueda guardados) también está huérfano (cero refs en app) — relacionado
  con la idea de "búsquedas guardadas"; revisar al rediseñar.

**Preocupación del usuario:** que los talents **abusen** del reconocimiento facial y **agoten/encarezcan** las
búsquedas (cada búsqueda llama a AWS Rekognition = coste).

## Qué hay que decidir (antes de diseñar/implementar)
- [ ] **¿De quién es la cuota?** Opciones evaluadas: (a) por plan del fotógrafo, contada por evento (un Free
      popular se agota y bloquea atletas); (b) por cuenta de talent con login obligatorio (no existe plan talent
      hoy); (c) sin cuota mensual — capability por plan + límite anti-abuso. Falta elegir.
- [ ] **Control de coste/abuso** sin cuenta: ¿endurecer el límite por IP? ¿cache de resultados por
      `(evento, hash-de-selfie)` para no re-llamar a Rekognition en repeticiones? ¿captcha/prueba de humanidad?
- [ ] **"Búsquedas guardadas / revisitar sin gastar"**: con selfie efímera (no se almacena), ¿qué se persiste
      para revisitar? (solo IDs de foto del resultado, keyed por qué). Reconsiderar `ai_search_profiles`.
- [ ] ¿Qué promete la copy de pricing entonces? (T-036 ya quitó el número "/mes" no honrable.)

## Criterio de aceptación (cuando se desbloquee)
- [ ] Diseño capturado en OpenSpec con el modelo elegido (quién, cómo se cuenta, qué se persiste)
- [ ] Mecanismo anti-abuso/coste implementado (cache de resultados y/o límites), con selfie efímera respetada
- [ ] Copy de pricing alineada con lo realmente ofrecido (y su test de guardia)
- [ ] Tests (incl. el "revisitar no re-llama a Rekognition" si se hace cache)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- Desbloquear eligiendo el modelo (decisión de producto) → entonces `/opsx:propose`.
- Mientras: la limpieza de lo a medias se hizo en **T-036**; el límite vivo `(shareCode, IP)`/hora sigue como
  defensa anti-abuso básica.
