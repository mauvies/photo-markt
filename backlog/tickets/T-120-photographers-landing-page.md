# T-120 · Landing dedicada para fotógrafos (sell-side, optimizada a conversión)

- **Prioridad:** P2
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `feat/photographers-landing`
- **OpenSpec change:** —  (página nueva + link de header/footer; UI con requerimiento claro, implementar directo)
- **PR:** —
- **Dep:** T-118 (el rediseño del landing saca el pricing/contenido de fotógrafo del landing principal y deja el `PricingSection` "reservado para esta página", y reestructura el header donde este ticket añade el link centrado — **ejecutar después de T-118 con merge previo**)

## Requerimiento
Crear una **landing nueva enfocada en fotógrafos** (el "sell-side" del marketplace), separada del landing
principal (enfocado en talento). Aloja el contenido orientado a fotógrafos que se quitó del landing
principal (incluido el `PricingSection` conservado para esto en T-118). Estructura según best-practices de
landing de vendedor: value-first hero, secciones escaneables de beneficios, **trust signals reales** (no
social proof fabricado), FAQ corto para objeciones, y CTAs click-through a un signup mínimo. Lean y de bajo
mantenimiento — **sin** ilustraciones custom, **sin** stock, **sin** testimonios/estadísticas inventadas.

### Ruta
Nueva ruta pública `/photographers` (recomendada) — accesible sin auth
(`src/app/[lang]/photographers/page.tsx`).

### Secciones (arriba → abajo)
1. **Hero** (above the fold): headline de venta + transformación (p. ej. "Convierte tu fotografía en
   ingresos" / "Turn your photography into income") + subheadline corto. **CTA primario click-through** a
   `/signup` (no formulario embebido). Fondo sólido/gradiente o foto existente; sin assets nuevos.
2. **Cómo funciona — 3 pasos:** icono + texto corto: (1) Crea un evento, (2) Sube tus fotos, (3) Cobra.
   Iconos Lucide existentes; sin gráficos custom.
3. **Beneficios — 3-4 puntos** (icono + texto, mensajería honesta): reconocimiento facial por IA que
   etiqueta automáticamente (menos trabajo manual); pagos directos vía Stripe Connect; te quedas con la
   **gran mayoría de cada venta** (comisiones Free 12% / Starter 8% / Pro 5% → el fotógrafo conserva
   88-95%, claim **verificado y honesto**); privacidad-first (selfies procesadas para matching, nunca
   almacenadas; menores protegidos).
4. **Trust signals (reales, no fabricados)** — sin testimonios inventados: pagos seguros con **Stripe**
   (marca reconocida que presta credibilidad); **sin costo inicial — empieza gratis**; economía
   transparente (te quedas con la gran mayoría); privacidad y protección de datos. Presentar como
   badges/puntos concisos, **no** como quotes falsos. (Testimonios auténticos = follow-up cuando existan
   fotógrafos reales.)
5. **Pricing:** **re-alojar** el `PricingSection` existente (`src/components/pricing-section.tsx`, conservado
   por T-118) aquí. Reusar tal cual; no reconstruir.
6. **FAQ corto (accordion colapsable):** 4-5 preguntas reales de objeción (cuánto me quedo por venta; cómo
   y cuándo cobro; qué cuesta empezar; cómo se protegen mis fotos del robo — watermarking; ¿tengo que
   etiquetar manualmente? — no, IA). Respuestas cortas y honestas.
   - **⚠️ Hallazgo:** **NO existe** un componente `Accordion` de Shadcn en `src/components/ui/` hoy. Hay
     que **añadir el primitivo Accordion de shadcn** (Radix `@radix-ui/react-accordion`, parte del mismo
     sistema de diseño — **no** es una lib de UI nueva). Documentarlo.
7. **CTA final:** repetir el CTA de "sign up as photographer" antes del footer.
8. **Footer:** reusar el `Footer` existente.

### Signup mínimo (best-practice de conversión)
- **Hallazgo (verificado):** el signup (`src/app/[lang]/signup/page.tsx`) ya es mínimo — email + password
  + Google OAuth. El **rol se asigna en onboarding** (post-signup, `actions/roles.ts`), no en el signup. El
  onboarding pesado del fotógrafo (bio, avatar, Stripe/payout) ya vive **después** del signup, en el
  dashboard. ✅ La preocupación de "signup mínimo" ya se cumple — solo **confirmar** en el PR.
- **Preselección de rol fotógrafo:** el signup **no** preselecciona rol hoy (se elige en onboarding) →
  los CTAs enlazan a `/signup` normal; preseleccionar rol/plan es **enhancement futuro** (el signup ya
  acepta `?plan=` — se podría pasar un hint, evaluar). Flag en el PR.

### Descubribilidad
- **Header (solo no autenticados, requerido):** link **centrado** en el header con icono de cámara
  (Lucide `Camera`) + "Hazte fotógrafo" / "Become a photographer". Se muestra **solo** cuando el visitante
  **no** está logueado; posicionado al centro / a la izquierda del language switcher, **sin reestructurar**
  el header (`src/components/nav.tsx`) — solo añadir el link. **No** mostrarlo a usuarios autenticados.
- **Footer (requerido, todas las páginas):** link "Para fotógrafos" / "For photographers". El `Footer` ya
  tiene una sección de fotógrafos (`becomePhotographer` → `/signup`, pricing → `/#pricing`) → **re-apuntar**
  esos links a `/photographers`.
- **NO** meter un CTA/sección "hazte fotógrafo" en el body del landing de talento (reintroduciría la mezcla
  de audiencias que T-118 quitó a propósito).
- Talento autenticado que quiera vender: usa el **role switcher** del dropdown del avatar ("switch to
  photographer"), **NO** esta landing. Sin cambios al role switcher.

### Explícitamente FUERA (evitar scope creep / deshonestidad)
Sin testimonios/reviews fabricados; sin estadísticas inventadas ("10,000+ fotógrafos"); sin galerías de
ejemplo curadas; sin tablas comparativas con competidores; sin ilustraciones/imágenes custom; sin relleno
de marketing largo. **No** construir aquí ningún cambio al onboarding pesado del fotógrafo.

## Criterio de aceptación (Definition of Done)
- [ ] La ruta pública `/photographers` renderiza: hero + CTA (above the fold), cómo-funciona 3 pasos,
      3-4 beneficios, trust signals reales (sin testimonios falsos), `PricingSection` re-alojado, FAQ
      accordion corto, CTA final, footer.
- [ ] Los CTAs son **click-through a `/signup`** (sin formulario de registro embebido en la landing).
- [ ] La sección de trust usa solo señales genuinas (Stripe, gratis para empezar, economía transparente,
      privacidad) — sin social proof fabricado ni números inventados.
- [ ] El `PricingSection` se **reusa** del codebase, no se reconstruye.
- [ ] El FAQ usa un componente Accordion (Shadcn/Radix; **añadirlo** si no existe) con respuestas cortas y
      honestas.
- [ ] Página **mobile-first** y rápida; verificada en mobile y desktop (tap targets grandes).
- [ ] Descubrible vía: link centrado en el header (cámara + "Hazte fotógrafo"/"Become a photographer") solo
      para no autenticados, al centro/izquierda del language switcher; y link de footer "Para fotógrafos"
      en todas las páginas (apuntando a `/photographers`). **No** en el body del landing de talento ni en el
      header para autenticados.
- [ ] Los CTAs enlazan a un signup que ya recoge solo lo esencial (confirmado); onboarding pesado diferido
      a post-signup. Preselección de rol flaggeada como enhancement si no es trivial.
- [ ] Todos los strings en `en.json` y `es.json`.
- [ ] test de regresión/feature que falla antes y pasa después (p. ej.: `/photographers` renderiza las
      secciones clave + CTAs a `/signup`; el link de header aparece solo para no autenticados; el footer
      apunta a `/photographers`).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Archivos:** nueva `src/app/[lang]/photographers/page.tsx`; `src/components/nav.tsx` (link centrado
  logged-out); `src/components/footer.tsx` (re-apuntar links de fotógrafo a `/photographers`);
  `src/components/pricing-section.tsx` (reusar); nuevo `src/components/ui/accordion.tsx` (shadcn/Radix);
  `src/dictionaries/en.json`/`es.json` (todo el copy nuevo).
- **Coordinación con T-118:** T-118 saca pricing/contenido de fotógrafo del landing principal y reestructura
  el header. Ejecutar **después** de T-118 (Dep) para no chocar. Si por alguna razón va antes, el pricing
  quedaría temporalmente en ambas páginas (no roto) y el header link habría que reconciliarlo con el rework
  de T-118 — preferible el orden T-118 → T-120.
- **Claims honestos:** comisiones reales (CLAUDE.md §Payments: Free 12% / Starter 8% / Pro 5%); reconocimiento
  facial es feature **actual** (AI_MATCHING enabled) — se puede afirmar en presente. Nada de números de
  tracción inventados.
- Añadir el primitivo Accordion de shadcn (`npx shadcn add accordion` o equivalente manual) **cuenta como
  el sistema de diseño existente**, no como una lib nueva.

## Constraints
- Reusar `PricingSection`, `Footer`, estructura del header, iconos Lucide, Accordion (shadcn) y el flujo de
  signup existentes — sin duplicar, sin nuevas libs de UI.
- Mensajería de beneficios honesta y precisa (comisiones reales, privacidad-first, IA como feature actual).
- Shadcn + Tailwind existentes; sin nuevas deps de diseño. Sin `any`. Biome. **Sin contenido fabricado de
  ningún tipo. Sin otros cambios.**

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/photographers-landing`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
