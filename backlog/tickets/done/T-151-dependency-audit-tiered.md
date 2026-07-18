# T-151 · Auditar y actualizar dependencias (por tiers de riesgo)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (pero lleva **gate de aprobación**: Parte 1 audita y para; Parte 2 no arranca sin decisión del usuario sobre qué tiers aplicar)
- **Rama:** `chore/dependency-audit-tiered`  (tipo = chore)
- **OpenSpec change:** —  (no aplica: es mantenimiento de deps, sin cambio de comportamiento)
- **PR:** — (varios: Tier 1 solo; Tier 2 solo; cada major su propio PR)

## Requerimiento
Poner las dependencias al día **de forma segura**. NO es un `pnpm update` masivo — en una app de pagos
en producción (Stripe en vivo) un bump en bloque puede romper cosas en silencio. Auditar el estado
actual, agrupar por riesgo, y aplicar en tiers revisados para manejar los breaking changes
deliberadamente. **Ejecutar en modo plan: la Parte 1 audita y PARA; no aplicar nada sin aprobación.**

### Parte 1 — Auditoría (sin cambios)
Producir un reporte antes de tocar nada:
- **Seguridad:** correr `pnpm audit`; listar vulnerabilidades conocidas, severidad, y si están en deps de
  producción vs dev.
- **Desactualizados:** `pnpm outdated`, agrupado en tres tiers:
  - **Tier 1 — patch/minor, mismo major:** bajo riesgo, sin ruptura de API esperada.
  - **Tier 2 — fixes de seguridad (pueden cruzar tiers):** vulnerabilidades a parchear sí o sí.
  - **Tier 3 — majors:** breaking changes probables. Llamar cada uno por separado, en especial los de
    alto blast-radius: **Next.js, React, Stripe SDK, cliente Supabase, Inngest**. Para cada major, notar
    los breaking changes desde su changelog/migration guide.
- Marcar cualquier paquete **sin mantenimiento/deprecado** o con reemplazo conocido.
- Reportar y **PARAR** para decisión sobre qué tiers aplicar.

### Parte 2 — Aplicar, en los tiers aprobados (por separado)
- **Tier 1 (patch/minor)** primero, como su propio cambio revisable → baseline seguro.
- **Tier 2 (seguridad)** después. Si un fix de seguridad exige un major, tratarlo como Tier 3, no como
  salto silencioso.
- **Tier 3 (majors):** **un major por cambio**, no en bloque. Para cada uno: seguir la migration guide,
  ajustar el código a los breaking changes, verificar a fondo. Los majors de alto riesgo (Next, React,
  Stripe SDK, Supabase, Inngest) van **cada uno en su propio ticket/PR dedicado** → **este ticket solo
  cubre la auditoría + Tier 1 + Tier 2**; los majors se recomiendan como tickets follow-up separados
  (filarlos con `/ticket` una vez la auditoría revele cuáles están realmente atrasados).

## Criterio de aceptación (Definition of Done)
- [ ] Se produce el **reporte de auditoría primero**: vulnerabilidades + desactualizados agrupados en los
      tres tiers, con breaking changes notados para cada major.
- [ ] **No se aplica ninguna actualización hasta aprobar** qué tiers aplicar.
- [ ] Los tiers aplicados quedan **separados en cambios revisables** (Tier 1 solo; seguridad solo; cada
      major solo).
- [ ] Tras **cada** tier aplicado: `pnpm build` (build de **producción**, no solo dev), `pnpm typecheck`,
      `pnpm lint` (Biome) y `pnpm test` en verde; y smoke-test manual de los flujos de alto riesgo:
      checkout/pago, webhook de Stripe, auth/sesión, pipeline de imágenes (upload → workers Inngest →
      thumbnails), y búsqueda facial/dorsal.
- [ ] Los majors de alto riesgo (Next/React/Stripe/Supabase/Inngest) quedan **recomendados como tickets
      separados**, no metidos en este, salvo aprobación explícita.
- [ ] **Sin cambios de comportamiento de la app**; **sin nuevos tipos `any`**.

## Notas
- Usar **pnpm** y respetar el lockfile. Verificar contra build de producción, no solo dev.
- **Fuera de alcance** (salvo aprobación explícita): bumps major de Next, React, Stripe SDK, Supabase o
  Inngest → recomendarlos como tickets dedicados. Cambiar funcionalidad de la app (esto es
  mantenimiento, no features): el comportamiento debe quedar idéntico.
- Ojo con lo que ya vive en memoria/CLAUDE.md: hubo un **mismatch de versión del CLI de Supabase**
  (pnpm-pinned 2.107.0 vs Homebrew 2.108.0) que rompió el parse de config/CI — un bump del CLI puede
  re-abrir eso; y `sharp` en el bundle cliente rompió un build antes → correr `pnpm build` (no solo
  typecheck/lint) al tocar deps compartidas.
- El reporte de auditoría puede vivir en el PR o en `docs/` (p. ej. `docs/DEPENDENCY_AUDIT.md`),
  siguiendo el patrón de `docs/CACHING_AUDIT.md` / `docs/PERF_AUDIT.md` que ya generaron follow-ups.
- No se solapa con ningún ticket abierto (no hay ticket de deps en el backlog).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
