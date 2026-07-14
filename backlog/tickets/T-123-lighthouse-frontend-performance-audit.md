# T-123 · Auditoría de rendimiento frontend (Lighthouse / Core Web Vitals) + fixes de alto impacto

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `perf/lighthouse-frontend-audit`
- **OpenSpec change:** —  (auditoría + fixes acotados; el reporte es el punto de revisión)
- **PR:** —

## Requerimiento
El usuario corrió Lighthouse y hay cosas por mejorar. Quiere **optimizar al máximo el rendimiento de
renderizado en el navegador** y las métricas que suelen medirse en este tipo de tests (Core Web Vitals +
categoría Performance de Lighthouse). Este ticket **audita** el frontend, **reporta** los hallazgos
priorizados por impacto, y **aplica los wins de alto impacto y bajo riesgo** en este PR; los cambios más
grandes/arriesgados se **capturan como tickets follow-up** (modelo de la auditoría de caching T-083).

**Distinción importante:** la auditoría T-083 (`docs/CACHING_AUDIT.md`) y sus follow-ups (T-084–T-101) ya
cubrieron **backend/caching/egress**. Este ticket es el eje **frontend/render**: LCP, CLS, INP/TBT, JS/CSS
bundle, fuentes, render-blocking, trabajo de main thread, imágenes above-the-fold. **No** re-hacer el
trabajo de caching.

## Alcance (medir + optimizar)
- **Rutas clave a medir** (mobile-first, throttling estándar de Lighthouse): landing `/`, listado de eventos
  `/events`, detalle de evento con galería `/events/[shareCode]`, y una vista de dashboard de talento. Correr
  Lighthouse (o `unlighthouse`/PSI) **antes y después**; documentar scores y CWV por ruta en el PR (o un
  `docs/PERF_AUDIT.md`).
- **Métricas objetivo:** LCP, CLS, INP/TBT, FCP, Speed Index; y las "Opportunities"/"Diagnostics" de
  Lighthouse Performance.
- **Áreas candidatas a revisar** (confirmar con datos, no asumir):
  - **Fuentes:** hoy se cargan **4 familias Google** (`Inter`, `Geist_Mono`, `Inter_Tight`, `Syne`) vía
    `next/font` (`src/app/layout.tsx`). Evaluar reducir familias/pesos, `display:swap`, `preload` selectivo,
    subsetting — payload y FOUT/CLS de fuentes.
  - **Imágenes above-the-fold:** `priority`/`fetchPriority`, `sizes`, formatos (`next.config.ts images`),
    dimensiones explícitas para CLS. (Ya hubo trabajo: T-093 `unoptimized` en thumbs, T-110/T-111
    `unoptimized` en originales — no romper eso.)
  - **CLS:** layout shifts por imágenes/fuentes/contenido async (ya se arregló el del ícono del carrito en
    T-114; buscar otros: hero, cards, skeletons).
  - **JS bundle / main-thread:** unused JS/CSS, `optimizePackageImports` en `next.config`, code-splitting de
    componentes pesados (lightbox, modales, mapas/places), diferir lo no crítico.
  - **Render-blocking / third-party:** analytics (`src/components/analytics.tsx`), scripts de Google Places
    (solo en forms), estrategia `next/script`.
  - **Render:** server components donde aplique, evitar hidratación innecesaria, `Suspense`/streaming en las
    rutas hot.
- **Fixes en este PR:** los de **alto impacto y bajo riesgo** (config de imágenes/fuentes, `priority`/`sizes`
  faltantes, `optimizePackageImports`, quitar render-blocking, dimensiones para CLS, lazy de componentes
  pesados). Los grandes/riesgosos → **tickets follow-up** capturados con `/ticket`.

## Criterio de aceptación (Definition of Done)
- [ ] Reporte en el PR (o `docs/PERF_AUDIT.md`) con Lighthouse **antes/después** por ruta (LCP, CLS,
      INP/TBT, score de Performance) y la lista priorizada de hallazgos.
- [ ] Mejora **medible** en las rutas objetivo (documentada) tras aplicar los fixes de alto impacto/bajo
      riesgo — sin objetivo numérico rígido, pero con mejora clara en las métricas peor puntuadas.
- [ ] Los hallazgos grandes/arriesgados que no entran quedan **capturados como tickets follow-up**.
- [ ] **Sin regresión funcional** (los tests existentes en verde; verificación manual de las rutas
      afectadas — imágenes cargan, layout estable, nada roto).
- [ ] Si algún cambio tiene lógica testeable (helper de resolución de imagen, predicado de priority, etc.),
      añadir test de regresión.
- [ ] Strings nuevos en `en.json` y `es.json` (si algún cambio añade texto visible — probablemente ninguno).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Coordinación con rediseños en cola:** T-118 (rediseño landing) y T-119 (rediseño EventCard) cambiarán el
  elemento LCP de `/` y el markup de las cards → los hallazgos **específicos del landing/cards** conviene
  re-medirlos después de esos merges (o coordinar). Los wins **sistémicos** (fuentes, `next.config`, bundle,
  analytics, CLS estructural) son estables y se pueden hacer ya. Documentar qué se hizo ahora vs qué
  re-auditar post-rediseño.
- **No duplicar** el trabajo de caching (T-083 y follow-ups) ni los CLS/perf ya resueltos (T-114 carrito,
  T-093/T-110/T-111 imágenes, T-101 router.refresh). Referenciarlos en el reporte para no re-abrir.
- **Herramienta:** Lighthouse (Chrome/CI), PageSpeed Insights o `unlighthouse` para barrer varias rutas.
  Medir en **prod/preview** (no dev, que no representa el bundle real). Sin nuevas deps de runtime salvo que
  un helper de medición justifique una devDependency.
- Sin `any`. Biome. **Sin otros cambios** fuera del scope de performance.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `perf/lighthouse-frontend-audit`.
2. Auditar (Lighthouse antes) → aplicar fixes de alto impacto/bajo riesgo → medir (después).
3. Implementar + test de regresión donde haya lógica testeable (CLNe.md lo exige para lógica).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main` (con el reporte antes/después en el cuerpo).
8. Capturar follow-ups con `/ticket` para los hallazgos grandes.
9. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
