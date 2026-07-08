# T-083 · Auditoría completa de caching (estado actual, optimizaciones y readiness de escala)

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `chore/caching-audit`  (tipo = chore — investigación + reporte, **sin cambios de código**)
- **OpenSpec change:** —  (no aplica: no se implementa nada; cada mejora sale como su propio ticket)
- **PR:** #137 — entregable: `docs/CACHING_AUDIT.md`

## Requerimiento
Auditoría exhaustiva de **todas las capas de caching** de la app: qué existe hoy, qué tan bien está
implementado, dónde hay huecos o riesgos, y qué habría que cambiar para soportar un uso
significativamente mayor al actual. **Es una tarea de investigación y planificación** — produce un
reporte en markdown y un plan de mejoras priorizado. **NO se implementa nada aquí:** cada mejora
recomendada se convierte en su propio ticket de follow-up, revisado y aprobado individualmente. Los
bugs de caching (datos stale) suelen ser silenciosos y difíciles de detectar, así que los cambios deben
ser deliberados y revisados de a uno, no aplicados en bloque.

**Constraint dura: no modificar código en esta tarea.** Donde el audit toque trabajo previo (pipeline de
thumbnails/preview, rate limiting existente, persistencia de saved-search), **investigar el estado real
en el código**, no asumir que coincide con planes anteriores — el código puede haber evolucionado.

### Alcance — auditar las 7 capas
1. **Server-side (Next.js):** inventariar todo uso (o ausencia) de `unstable_cache`, ISR (`revalidate`),
   fetch cache y `cache()`. Para cada ruta pública/semi-pública (home, listado de eventos, detalle de
   evento, perfiles públicos de fotógrafo, cualquier otra ruta pública): ¿está cacheada?, ¿ventana de
   revalidación?, ¿apropiada a la volatilidad del dato? Listar toda ruta que pega a la DB en **cada**
   request sin caché y evaluar si debería cachearse. Revisar invalidación: para cada query cacheada,
   ¿hay un `revalidateTag`/`revalidatePath` disparado por las mutaciones que la afectan? Marcar caché que
   pueda quedar stale sin invalidarse (bug real) e invalidaciones demasiado agresivas (bajan hit rate).
2. **Client-side (React Query):** auditar `staleTime`, `cacheTime`/`gcTime`, estructura de query keys,
   refetch behavior. Queries que refetchean de más (requests desperdiciados) o de menos (UI stale).
   Queries duplicadas/solapadas que podrían compartir entrada de caché pero no lo hacen (keys
   inconsistentes). Confirmar que caché cliente y servidor no trabajan una contra la otra.
3. **Image caching (CDN/HTTP):** revisar config de `next/image` y comportamiento del edge CDN de Vercel
   para originales y variantes preview/thumbnail (investigar el estado actual del pipeline de thumbnails,
   independiente de trabajo previo — ver T-067/T-068/T-078). Verificar `Cache-Control` en respuestas de
   imagen desde Supabase Storage y desde la salida de `next/image` (long-lived + immutable donde el
   archivo no cambia). Evaluar si visitas repetidas a la misma galería/evento se sirven realmente del CDN
   o re-piden a Supabase Storage (impacto directo en costo de egress).
4. **Async/background (Inngest) + idempotencia:** revisar los workers (face indexing, bib detection,
   thumbnails) por trabajo redundante — ¿se re-procesan fotos innecesariamente?, ¿hay
   caching/memoización de pasos caros (llamadas AWS) para no repetir en retries? Revisar los resultados
   persistidos de búsqueda facial (saved searches) — ¿funcionan como "caché" que evita repetir llamadas
   AWS?, ¿huecos?
5. **Rate limiting / counters:** inventariar los limiters actuales (face search, bib search, otros) — qué
   los respalda (in-memory, DB, Redis-like). ¿Es apropiado y aguanta carga concurrente entre múltiples
   instancias serverless? (gotcha clásico: los rate limits in-memory no funcionan bien entre instancias).
6. **Auth/session:** cómo se cachea/re-valida la sesión/token de Supabase en cada request. ¿Overhead de
   auth repetido innecesario por request que se pueda optimizar sin debilitar seguridad?
7. **Patrones de query DB:** N+1 o queries redundantes dentro de un mismo request/render que caching
   (incluso memoización request-level con `cache()` de React) podría eliminar. Aggregates caros (counts,
   joins) que corren seguido y se beneficiarían de caché o desnormalización.

### Readiness de escala
Para cada capa: qué se rompe primero bajo mayor carga (rate limiting in-memory entre instancias, límites
de conexión de Supabase, cap de concurrencia de Inngest —hoy 5, Free tier, ver **T-001**—, costo de
egress reapareciendo con más tráfico de galería, riesgo de cache stampede en eventos populares).
Estimar umbrales aproximados (razonamiento arquitectónico, no benchmarks exactos) de cuándo cada riesgo
se vuelve real. Distinguir qué es barato pre-empt ahora vs. qué conviene diferir hasta ver señal real
(evitar optimización prematura).

## Criterio de aceptación (Definition of Done)
- [ ] Reporte en markdown (bajo `docs/` o `backlog/`) que cubre las **7 capas** con hallazgos concretos
      referenciando archivos/queries/componentes reales (no consejos genéricos).
- [ ] **Inventario:** tabla de cada mecanismo de caching por capa, con su config actual y assessment
      (`good` / `needs tuning` / `missing` / `risky`).
- [ ] **Bugs/riesgos:** todo lo que pueda producir datos stale, cache stampedes o invalidación
      incorrecta, marcado claramente como **bug/riesgo**, no como "mejora".
- [ ] Cada hallazgo clasificado explícitamente como **bug/riesgo** u **optimización**.
- [ ] **Lista de mejoras priorizada** (impacto vs. esfuerzo), cada ítem escrito como candidato
      standalone y scopeado para su propio ticket (suficiente detalle para convertirlo directo en ticket
      de implementación).
- [ ] **Readiness de escala:** umbrales/riesgos con razonamiento arquitectónico concreto (dónde se
      pegan los límites), no consejo genérico de escalado.
- [ ] **Fuera de alcance / no urgente:** lo considerado y deliberadamente no recomendado, con su razón,
      para que no se re-litigue después.
- [ ] **Sin cambios de código.** No se implementa ninguna de las mejoras.

## Notas
- **Investigación/reporte solamente.** El entregable es el reporte; las mejoras se capturan luego como
  tickets individuales vía `/ticket` y se aprueban de a uno.
- **Solapes conocidos a referenciar (no duplicar):**
  - **T-001** — subir concurrencia de indexado de caras (10–50) tras Inngest Pro. El cap de concurrencia
    de Inngest es justo un ítem de la sección de readiness de escala; el audit lo referencia y contextualiza,
    no lo reemplaza.
  - **T-034** — [DISEÑO] modelo anti-abuso/coste de búsqueda facial. La sección de rate limiting se solapa;
    el audit debe **remitir** a T-034 para el rediseño de cuotas de búsqueda, sin re-diseñarlo aquí.
  - **T-064** — `revalidateEventPhotoCacheTags` y los tags `event-${id|slug|share_code}` (TTL 55 min) son el
    patrón vivo de invalidación de caché de galería a auditar en la capa 1.
  - **T-067 / T-068 / T-078** — pipeline de preview/thumbnail con watermark + el hueco de inmutabilidad de
    `/api/thumb` (T-078): relevante para la capa 3 (image caching / egress). Investigar su estado real.
- Cada mejora que salga del reporte, al convertirse en ticket, debe traer su propio test de regresión
  (los cambios de caching son silenciosos) — pero eso pertenece a esos tickets, no a este.
