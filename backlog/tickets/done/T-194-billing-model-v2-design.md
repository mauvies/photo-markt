# T-194 · [DISEÑO] Billing model v2 — fee con componente fijo, casi break-even sin pérdidas

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno para el diseño; la implementación depende de T-193 (moneda EUR) y T-190 (ledger)
- **Rama:** `feat/billing-model-v2` (fase implementación; el diseño produce el doc + OpenSpec)
- **OpenSpec change:** sí — obligatorio (pagos, cambia el modelo de ingresos). `/opsx:propose` al ejecutar.
- **PR:** #257  (OpenSpec change `billing-model-v2` activo — NO archivar; gates: medir fees Stripe + aprobar antes de abrir hijos A–C)

## Requerimiento
(en palabras del usuario) Rediseñar el modelo económico de la plataforma. Hoy: suscripción (Free/
Starter/Pro) + comisión 12/8/5% al fotógrafo, y **la plataforma absorbe el fee de Stripe** → **pierde
dinero en ventas < ~€3** por el fee fijo. El usuario quiere **bajar los fees lo máximo posible
(sacrificar ganancia por venta hacia break-even) SIN caer en pérdidas**, quedándose dentro de Stripe.

## Insight central (fija el diseño)
**La estructura del fee debe copiar la estructura del costo.** Stripe cobra **fijo + %**
(EU ≈ €0.25 + 1.5%, más en cross-border/conversión). El único ingreso por venta de hoy (comisión) es
**% puro, sin componente fijo** → no cubre los €0.25 fijos en ventas chicas. v2 mete un **componente
fijo** en el fee. Break-even real ≠ igualar el fee nominal: hay que cubrir el **peor caso** del mix de
Stripe (cross-border/conversión pueden subirlo a ~€0.35–0.45) o las ventas caras vuelven a pérdida.

## Modelo propuesto (detalle completo en `docs/BILLING_MODEL.md`)
- **Moneda → EUR** (prerequisito, T-193; quita el ~2% de conversión).
- **Service fee al comprador** con parte **fija** (cubre el fijo de Stripe) + % chico. Legal en EU
  (fee flat uniforme ≠ surcharge PSD2; confirmado en el research — Vinted/Bookwhen/Eventbrite/surfcloud).
  Provisional: **€0.30 + 1.5%** del subtotal.
- **Comisión al vendedor se queda (12/8/5%)** pero ahora es **margen limpio** (ya no la come Stripe).
- **Precio mínimo por foto** (provisional €1.50) — el fee nunca desproporcionado + empuja a bundles.
- **Peso de la ganancia → suscripciones.** Margen por venta fino a propósito; Free ≈ break-even + buffer
  (loss-leader de adquisición).
- **Palanca opcional: bundles "compra todas mis fotos"** (modelo Sportograf) — sube AOV, amortiza el
  fijo de Stripe, alta prioridad en esta vertical.

Todos los números son **provisionales** hasta medir la distribución real de fees de Stripe (tarea abajo).

## Decisiones de diseño ya tomadas (documentadas en `docs/BILLING_MODEL.md`)
- **Moneda:** cobrar en la moneda de liquidación **EUR a todos**; comprador no-EU se cobra en EUR y su
  banco convierte (FX del comprador, no de la plataforma). **Adaptive Pricing OFF**. Multi-moneda
  condicionada por país = **diferida** (re-introduce el FX o exige multi-settlement). Ver T-193.
- **Comisiones elegidas por el usuario: Free 8% / Starter 4% / Pro 0%** (Pro ya paga suscripción alta →
  gancho "quedate el 100%"). Dos caveats a resolver en el modelado:
  - **Pro 0% saca el colchón de comisión** → el buyer fee es lo ÚNICO que cubre Stripe en ventas Pro; con
    tarjeta cara (no-EEA 3.25%) + el ~0.5% de transfer Connect, una venta Pro puede quedar **levemente
    negativa**. → subir la parte **fija** del buyer fee a ~€0.35–0.40 (o subir el precio mínimo). Pro 0%
    es el caso más ajustado y **dimensiona el buyer fee**.
  - **Starter reprecEado a €9.99 @ 4% (RESUELTO):** a €14.99 quedaba dominado (Free y Pro colapsaban su
    break-even en ~€375/mo → nadie elegía Starter). Bajándolo a **€9.99** (comisión 4% intacta): Free gana
    < €250/mo, Starter €250–500/mo, Pro > €500/mo → cada tier dueño de su banda. Sin tocar las comisiones.
    (Anual €95.88 = 20% off, €7.99/mo equiv.)
  - **Guardrails generales:** mantener spread de upgrade; modelar las **3 perillas juntas** (buyer fee +
    comisión + precio sub), no aisladas. Detalle en `docs/BILLING_MODEL.md`.

## Criterio de aceptación (Definition of Done — fase diseño)
- [ ] `docs/BILLING_MODEL.md` actualizado y aprobado por el usuario (ya creado con v1 vs v2 + política de
      moneda + baja de comisión; refinar números tras la medición).
- [ ] Fijar las **comisiones finales por tier** (bajadas), preservando spread de upgrade; confirmar que
      Free no queda en pérdida ni en ganancia-cero indeseada.
- [ ] **Medir la distribución real de fees de Stripe** del mix de tarjetas/monedas (dashboard de Stripe:
      fee promedio Y peor caso — doméstico EU vs cross-border vs conversión vs Link). Fijar la parte fija
      del service fee al **peor caso realista**, no al barato.
- [ ] OpenSpec change (`/opsx:propose`) con: parámetros finales (service fee fijo+%, precio mínimo,
      comisiones por tier), dónde se calcula (un solo punto — `getPhotographerNetCents` + un nuevo
      `getBuyerServiceFeeCents`), impacto en checkout (line items + fee como línea aparte visible),
      display en carrito/checkout, y el desglose que ve el fotógrafo en ganancias.
- [ ] Decisión sobre **bundles** (incluir en v2 o follow-up) documentada.
- [ ] Descomposición en tickets hijos de implementación en orden ejecutable.
- [ ] OK del usuario sobre el diseño ANTES de abrir tickets de implementación.

## Notas
- **Legal:** el service fee al comprador debe mostrarse **en el precio total up-front** (la sanción a
  Vinted fue por disclosure, no por el fee). Sin sorpresas en el último paso del checkout.
- **Dónde toca la implementación:** `plans.ts` (nuevo `getBuyerServiceFeeCents` + min price), ambos
  checkouts (line item del fee + display), carrito (mostrar el total con fee), ganancias del fotógrafo
  (desglose), i18n. `/code-review ultra` obligatorio en los PRs de implementación (pagos).
- **Familia:** T-190 (ledger — centraliza el cálculo neto, aguanta cualquier modelo), T-193 (moneda EUR,
  prerequisito), T-045 (errores tipados en checkout). Research de competencia y base legal:
  `docs/BILLING_MODEL.md` (sección Competitor reference).
- **Contra-señal anotada:** Airbnb migró comprador→vendedor en 2025 (fricción de conversión a tickets
  altos); no aplica igual acá por la magnitud chica (€1–15), pero tenerlo presente si el fee al
  comprador baja conversión — medir con A/B cuando haya tráfico real.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>` (fase diseño: docs/OpenSpec).
2. `/opsx:propose` (obligatorio).
3. Implementar + test en los tickets hijos.
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar `done`, mover a Archivo, mover el archivo del ticket a `backlog/tickets/done/`.
9. Si hubo OpenSpec change, `/opsx:archive`.
