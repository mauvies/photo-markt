# T-030 · Auditoría de congruencia: features de los planes ↔ lógica de negocio

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `chore/pricing-features-consistency-audit`
- **OpenSpec change:** **sí, probable** — toca **pagos** (comisión por plan). Usar `/opsx:propose` y `/code-review` al ejecutar.
- **PR:** —

## Requerimiento
Asegurar que **todas las características anunciadas en los pricing packages** (Free / Starter / Pro) son
**congruentes con la lógica de negocio aplicada** a lo largo de todo el código. Hoy las features se **declaran**
en varios sitios y se **aplican** en otros, sin una fuente única que los ate — riesgo de que la copy anuncie algo
que el código no cumple (o al revés).

## Estado actual (verificado) — fuentes de verdad dispersas
- **Declaración estructurada:** `src/lib/plans.ts` → `PLANS[]` (`storageGB`, `maxEvents`, `salesFeePercent`,
  `allowCustomBundles`, `pricing`) **y** `PLATFORM_FEE_RATES` (free 0.12 / starter 0.08 / pro 0.05).
  ⚠️ **El fee está declarado dos veces** (`salesFeePercent` 12/8/5 **y** `PLATFORM_FEE_RATES` 0.12/0.08/0.05),
  sin derivar uno del otro → pueden divergir.
- **Cuotas de IA:** `src/lib/ai/rate-limits.ts` → `AI_SEARCH_RATE_LIMITS` (free 3 / starter 20 / pro ilimitado),
  fuente separada de `plans.ts`.
- **Copy anunciada (i18n):** `src/lib/plan-features.ts` mapea features desde el diccionario `pricingSection`
  (`freeFeature1..6`, `starterFeature1..7`, `proFeature1..7`) — **texto libre** en `en.json`/`es.json`, NO ligado a
  los valores estructurados. `proFeature6` lleva badge "coming soon" (patrón de outfits, aún no construido).
- **Mapeo Stripe:** `src/lib/stripe/plans-stripe.ts` → `STRIPE_PRICE_TO_PLAN` (price IDs → plan).
- **Aplicación (enforcement):**
  - Comisión → `src/app/api/stripe/webhook/route.ts` (vía `getPhotographerNetCents`/`getPlatformFeeRate`).
  - Eventos/almacenamiento → `src/lib/plan-limits.ts` (`assertCanCreateEvent`/`assertCanUploadPhoto`, leen `plans.ts`).
  - Cuota IA → flujo de face-search (`src/app/[lang]/events/[shareCode]/face-search-shared.ts`).
- **Relación con T-018 (done):** T-018 unificó la *visualización* de features en `pricingSection` (fuente i18n
  compartida entre landing y billing). Este ticket es la **auditoría de congruencia** entre esa copy y la lógica
  aplicada — complementario, no duplicado.

## Criterio de aceptación (Definition of Done)
- [ ] **Auditar y dejar congruente cada dimensión** por plan (free/starter/pro), copy es+en ↔ valor estructurado ↔ enforcement real:
  - [ ] **Comisión / sales fee**: `salesFeePercent` == `PLATFORM_FEE_RATES` == fee aplicado en el webhook == "% comisión" anunciado en copy
  - [ ] **Cuota de búsquedas IA**: `AI_SEARCH_RATE_LIMITS` == enforcement en face-search == "N búsquedas/mes" anunciado
  - [ ] **Tope de eventos**: `maxEvents` == `assertCanCreateEvent` == "N eventos / ilimitado" anunciado
  - [ ] **Almacenamiento**: `storageGB` == `assertCanUploadPhoto` == "N GB" anunciado
  - [ ] **Bundles personalizados**: `allowCustomBundles` == gating real donde se ofrecen bundles == anunciado
  - [ ] **Precios** mensual/anual: `plans.ts pricing` == price IDs de Stripe == precios anunciados
- [ ] **Eliminar/atar fuentes duplicadas** donde sea razonable: derivar `PLATFORM_FEE_RATES` de `salesFeePercent`
      (o viceversa) para que haya **una sola fuente** del fee; evaluar exponer las cuotas IA / features como datos
      derivables en vez de texto libre suelto
- [ ] **Features "coming soon"** (p. ej. `proFeature6` outfit pattern; ojo también al "BIB number recognition"
      mencionado en planes): que estén claramente badge-adas como futuras **en ambos idiomas** y que **no** se
      apliquen/insinúen como activas
- [ ] **Paridad es/en**: ambos diccionarios anuncian los **mismos números** (no "8%" en en y otro valor en es)
- [ ] **Test de guardia** que fije la copy a la config estructurada para que no vuelvan a divergir: aserta que las
      strings de `pricingSection` (en+es) contienen el fee %, GB, nº de eventos y cuota IA reales de
      `plans.ts`/`ai/rate-limits.ts`. Debe fallar si alguien cambia un número en un sitio y no en el otro
- [ ] Documentar cualquier inconsistencia encontrada en el cuerpo del PR (qué decía la copy vs. qué hacía el código)
- [ ] Si se mueve/renombra una fuente de verdad documentada, actualizar `CLAUDE.md`/`ARCHITECTURE.md`
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Toca pagos** (comisión): al ejecutar, seguir el camino de riesgo — `/opsx:propose` para capturar el diseño de
  la fuente única, y `/code-review` (o `ultra`) sobre el diff antes de commitear.
- Objetivo doble: (1) **arreglar** cualquier divergencia actual; (2) **prevenir** divergencias futuras con el test
  de guardia + reducir fuentes duplicadas. No es solo "leer y confirmar".
- Empezar por **inventariar** la verdad de negocio (tabla plan × feature) y contrastar contra cada capa; el PR
  debe dejar esa tabla como referencia.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `chore/pricing-features-consistency-audit`.
2. **Toca pagos** → `/opsx:propose` (capturar fuente única del fee/cuotas) → `/opsx:apply`.
3. Auditar capa por capa, arreglar divergencias, añadir test de guardia copy↔config.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. `/code-review` sobre el diff (pagos) y arreglar findings reales.
6. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
7. `git push -u origin chore/pricing-features-consistency-audit`.
8. `gh pr create --draft` a `main`. Título y cuerpo en inglés.
9. Marcar ticket `done`, mover a Archivo en `BACKLOG.md` con el nº de PR. Si hubo OpenSpec, `/opsx:archive`.
