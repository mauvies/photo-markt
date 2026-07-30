# T-213 · Bundles · Plumbing de errores y UX del editor de precios

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ~~**T-212**~~ (PR #267, mergeado — mismos formularios). ⚠️ El punto 1 (códigos `all_photos_*` sin mapear) **ya lo arregló T-212**, que editaba ese mismo allow-list; queda pinchado su test de exhaustividad.
- **Rama:** `fix/bundle-error-plumbing`
- **OpenSpec change:** —
- **PR:** #268

## Requerimiento

Segundo grupo de hallazgos de `/code-review ultra` sobre **PR #265 (T-203)**. Ninguno cobra mal ni
pierde datos — son errores que el fotógrafo no puede entender y fricción de UX — pero todos dejan al
usuario sin saber qué pasó justo en la pantalla donde configura dinero.

1. **`src/lib/bundle-schedule-error.ts:37`** — `KNOWN_ERRORS` omite los **tres códigos nuevos del
   techo** (`all_photos_below_floor`, `all_photos_not_above_unit`, `all_photos_below_a_pack`), así que
   `parseBundleScheduleError` devuelve `null` para toda rechazo de "todas las fotos" y **las tres
   cadenas localizadas que SÍ existen** en `en.json`/`es.json` son inalcanzables. El fotógrafo ve el
   sentinel crudo `BUNDLE_TIERS:all_photos_not_above_unit` en dev, y el error genérico redactado de
   Next en prod.
2. **`edit/edit-event-form.tsx:255`** — el formulario `/edit` completo decodifica `PlanLimitError` y el
   sentinel `MIN_PHOTO_PRICE:`, pero **nunca el nuevo `BUNDLE_TIERS:`**, así que un rechazo de escalera
   desde esa ruta sale como el string crudo (dev) o un error opaco (prod) — a diferencia del formulario
   con alcance `?section=pricing`, que sí recibió el mapeo. **El wizard de creación tiene el mismo
   hueco** (`events/new/wizard.tsx:531`).
3. **`edit/scoped-event-edit-form.tsx:92`** — el redirect post-guardado está hardcodeado a
   `?tab=details`, escrito cuando `info` y `settings` eran las únicas secciones. Quien edita sus packs
   vía `?section=pricing` y guarda **aterriza en el tab Details**, que no muestra precio alguno: el
   guardado no da confirmación visible de que la escalera cambió.
4. **`edit/components/event-price-field.tsx:16`** — el campo de precio extraído añade un prop `label`
   opcional que **ningún call site pasa**, dejando la etiqueta visible hardcodeada en inglés
   ("Price per Photo (Optional)") en un componente compartido nuevo. Un fotógrafo en español ve inglés
   junto a copy `bundlePricing` completamente traducido. Viola `CLAUDE.md` ("Never hardcode visible
   strings").
5. **`events/[id]/event-pricing-tab.tsx:10`** — el tab importa `buttonVariants` del módulo
   `'use client'` `ui/button` y se empujó **el tab entero al cliente** para compensar, cuando
   `@/components/ui/button-variants` existe precisamente para que un Server Component pueda llamarlo
   (`photographer-public-profile.tsx:11` ya lo hace). Cambiar el import arregla el crash sin frontera
   de cliente; tal como está, una tabla de solo lectura sin interactividad viaja al bundle del
   navegador, y hay un test a nivel de fuente fijando el workaround.

## Criterio de aceptación (Definition of Done)

- [x] ~~Los tres rechazos del techo muestran su copy localizada~~ — **hecho en T-212** (PR #267), junto con un test de exhaustividad sobre toda la unión `BundleScheduleError`
- [x] Un rechazo de escalera desde el `/edit` completo **y desde el wizard** muestra copy legible
- [x] Guardar desde `?section=pricing` aterriza en el tab **Pricing**
- [x] La etiqueta del campo de precio se traduce (prop muerto eliminado; lee `newEvent.priceLabel`)
- [x] `EventPricingTab` vuelve a ser Server Component vía `@/components/ui/button-variants`; el test de
      frontera `pricing-tab-client-boundary.test.ts` se ajusta a la regla correcta en vez de fijar el
      workaround
- [x] strings nuevos en `en.json` y `es.json` — **ninguno**: la etiqueta reusa `newEvent.priceLabel`, que
      ya existía traducida en ambos diccionarios (el bug era precisamente no leerla)
- [x] test que falla antes y pasa después
- [x] `pnpm typecheck && pnpm lint && pnpm test:unit` en verde ⚠️ salvo **2 fallos preexistentes en
      `main`**, ajenos a este ticket (`event-card-skeleton` y `route-loading-skeletons`: el skeleton
      quedó desalineado del card real — `px-3` vs `px-4`, falta `border-t`). Verificado con `git stash`
      sobre el árbol limpio. Merecen su propio ticket

## Notas

- Depende de **T-212**: ambos tocan `bundle-schedule-error.ts` y los mismos formularios de edición.
  Mergear T-212 antes de empezar este. ✅ #267 mergeado antes de arrancar.
- **Hallazgo al ejecutar (punto 2):** tras T-212 el `/edit` completo y las secciones `info`/`settings`
  mandan `absent` en las dos columnas de bundle, así que la acción **ya no puede** rechazar una escalera
  desde ahí — el hueco real que quedaba era el **wizard**, la única superficie que sí renderiza el editor
  y sí manda los campos. El decode se añadió igual en `/edit` (el sentinel es propiedad de la *acción*,
  compartida por todos sus llamadores, y olvidarlo falla en silencio), documentado como tal en el código.
- El redirect post-guardado se extrajo a `eventTabForScopedSection` en `event-tab.ts` (módulo sin
  directiva, ya pensado para ser llamable desde el server) para que sea una función pura testeable en vez
  de un ternario dentro del `onSubmit`.
- El punto 5 tiene un matiz que el revisor señala bien: el test `pricing-tab-client-boundary.test.ts`
  se escribió para fijar el `'use client'` como si fuera la regla, cuando la regla real es "usa el
  módulo sin directiva". Al arreglarlo hay que **reescribir el test**, no borrarlo.
- Familia: T-200 (diseño) → T-203 (A) → T-204 (B) → T-212 (correctness) → **T-213**.
