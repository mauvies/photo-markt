# T-212 · Bundles · El camino de ESCRITURA borra en silencio la escalera de precios (+ monotonicidad + input de dinero)

- **Prioridad:** P1
- **Estado:** done
- **Blockers:** ninguno (T-203 y T-204 ya en `main`)
- **Rama:** `fix/bundle-write-path`
- **OpenSpec change:** — (toca >1 archivo pero el "qué" está cerrado; el diseño vive en `photo-bundles`, que sigue **activo**)
- **PR:** #267

## Requerimiento

Nueve defectos confirmados por `/code-review ultra` sobre **PR #265 (T-203)**, ya mergeado y vivo.
Seis comparten una sola raíz: **el camino de escritura trata "no pude parsear" y "el fotógrafo lo
borró" como el mismo valor `null`**, así que un campo vaciado, un `1` mal tecleado o el propio kill
switch **borran la escalera guardada y reportan éxito** — pérdida de datos silenciosa en una columna
de dinero. Irónicamente es la clase de bug que T-203 dijo haber arreglado con la separación
lectura/escritura de parsers: la arregló en un sitio y la dejó viva en varios otros.

**Ventana:** en prod hay **cero eventos** con escalera o cap configurado, así que ningún comprador
está expuesto todavía. El día que un fotógrafo configure el primer paquete, esto pasa de teórico a
dinero mal cobrado y datos perdidos.

### Los defectos

1. **`src/lib/bundle-pricing.ts:428`** — `parseBundleTiersInput` (parser de **ESCRITURA**) devuelve
   `null` en vez de un error por peldaño cuando `minQuantity < 2` o `totalPriceCents <= 0` — valores
   que el editor produce al vaciar un campo o teclear `1`. La acción lo lee como "sin escalera", se
   salta `validateBundleSchedule` y escribe `null`: **la escalera guardada se borra reportando
   éxito**. Corolario: el mensaje `quantity_too_low` es inalcanzable.
2. **`events/[id]/edit/actions.ts:369`** — poner `BUNDLE_PRICING_ENABLED` en `false` (el rollback
   documentado) hace que `eventSupportsBundles` devuelva `false`, el edit normaliza escalera y cap a
   `null`, y el gate de migración dispara igual → **el siguiente guardado de cualquier tipo borra la
   escalera para siempre**. Es exactamente lo contrario de lo que `CLAUDE.md` y el propio kernel
   prometen ("stored ladders survive it unread, so rollback needs no migration").
3. **`src/lib/bundle-pricing.ts:321`** — `validateBundleSchedule` nunca compara el total de un peldaño
   contra `(minQuantity − 1) × unitario`, solo contra `minQuantity × unitario`. Una escalera **válida**
   puede cobrar **más por menos fotos**: €5/foto con pack "3 → €9" hace que 2 fotos cuesten €10 y 3
   cuesten €9 → **quitar una foto SUBE el total**. Rompe la propiedad "precio no decreciente en la
   cantidad" que `CLAUDE.md` documenta como garantizada. El test unitario que la afirma solo pasa
   porque prueba **una única escalera elegida a mano**.
4. **`components/bundle-tiers-field.tsx:128`** (y `:190`) — los inputs de dinero se re-derivan con
   `(cents/100).toFixed(2)` en cada tecla; React reescribe el valor del DOM, el cursor salta al final
   y el siguiente dígito se pierde. **Teclear "20" guarda €2** → un Foto-Flat de €2 para el evento
   entero. `EventPriceField` deliberadamente **no** reformatea: es una divergencia nueva respecto del
   input que sí funciona.
5. **`events/[id]/edit/actions.ts:163`** — la normalización-en-vez-de-rechazo solo cubre el precio
   puesto a gratis; **bajar** un precio no nulo sigue validando contra la escalera echoed y lanza
   `total_not_a_discount`, bloqueando el guardado desde formularios sin editor de escalera
   (`?section=info`). El fotógrafo no puede arreglarlo desde esa página, y en prod solo ve un error
   genérico. Misma clase que el bug que T-203 arregló para el caso "precio a gratis".
6. **`events/new/wizard.tsx:615`** — vaciar el precio en el wizard deja packs **huérfanos**:
   `BundleTiersField` hace early-return con el aviso "necesita precio", así que los packs dejan de
   verse **y de poder borrarse**, pero siguen en el estado del form, el paso de revisión los lista, el
   fotógrafo los confirma, y `createEvent` los normaliza a `null` reportando éxito.
7. **`wizard-storage.ts:151`** — el restore del borrador pasa la escalera en progreso por
   `parseBundleTiers`, el parser de **LECTURA** que falla cerrado, así que un borrador capturado a
   medio teclear pierde todos los packs al recargar mientras el resto del borrador sí vuelve. Aplica
   la regla de lectura a algo que el fotógrafo **tecleó** — justo lo que el doc del módulo dice que
   nunca debe hacerse en una escritura.
8. **`edit/scoped-event-edit-form.tsx:77`** (*PLAUSIBLE*) — ambos formularios siembran `bundle_tiers`
   desde el parser de **LECTURA** y la acción trata el campo vacío como "borrar", así que cualquier
   escalera que `parseBundleTiers` rechace se borra al primer guardado **no relacionado** —
   contradiciendo la promesa de la migración de que "un evento configurado bajo una regla antigua
   sigue vendiendo hasta que su escalera se reescriba".
9. **`src/lib/bundle-pricing.ts:196`** — `getBundleDiscountCents` llama a `getBundlePriceCents` **sin
   reenviar `allPhotosCents`**, así que el descuento que reporta ignora el techo y es 0 cuando el
   Foto-Flat es lo que aplica. Hoy no lo llama ningún camino de `src/` (solo el test), o sea que es
   una **trampa para el siguiente llamador**, en la dirección mostrado-vs-cobrado que la regla del
   punto único de cálculo existe para impedir.

## Criterio de aceptación (Definition of Done)

- [x] Un campo de peldaño vaciado o con `1` **no** borra la escalera guardada: se rechaza con el error
      concreto (`quantity_too_low` / total inválido) y el fotógrafo lo ve
- [x] `BUNDLE_PRICING_ENABLED = false` **conserva** las escaleras guardadas a través de guardados no
      relacionados (la propiedad que `CLAUDE.md` ya promete)
- [x] ~~Ninguna escalera que pase la validación puede cobrar más por menos fotos~~ — **corregido al
      ejecutar: este criterio estaba mal.** Imponerlo prohíbe el Foto-Flat ("40 fotos por €19.90" baja de
      €195 a €19.90). Lo que sí se afirma, sobre varias formas de escalera y todas las cantidades, es la
      propiedad real: **ninguna configuración cobra más que comprar de a una**. Ver Notas
- [x] Teclear "20" en cualquier input de dinero del editor guarda **€20**
- [x] Bajar el precio desde `?section=info` guarda, sin quedar bloqueado por una escalera que ese
      formulario no puede editar
- [x] Vaciar el precio en el wizard no deja packs invisibles-pero-vivos: o se pueden borrar, o el paso
      de revisión no los promete
- [x] Recargar un borrador del wizard a medio teclear conserva los packs
- [x] Una escalera almacenada que el parser de lectura rechace **no** se borra por un guardado ajeno
- [x] `getBundleDiscountCents` refleja el techo
- [x] strings nuevos en `en.json` y `es.json` (si hay UI)
- [x] test que falla antes y pasa después **por cada defecto**
- [x] `pnpm typecheck && pnpm lint && pnpm test` **y `pnpm build`** en verde

## Notas

- **Arreglo de fondo sugerido:** distinguir los **tres estados** que hoy colapsan en `null` —
  *ausente* (el form no manda el campo), *borrado explícitamente* (el fotógrafo lo vació), *inválido*
  (no parsea) — en vez de tratarlos igual. Casi todos los defectos 1/2/5/6/7/8 caen solos con eso.
- El defecto **3** invalida una afirmación de `CLAUDE.md`; actualizar la doc en el mismo PR.
- **No** entra aquí, y ya está resuelto: el hallazgo "la escalera se anuncia como aplicable mientras
  el checkout la ignora" era cierto en la ventana entre #265 y #266 — con #266 mergeado, el checkout
  ya la lee.
- Bloquea el **gate de rollout 4.1** del OpenSpec change `photo-bundles` (una compra real con bundle
  verificada de punta a punta). Hasta cerrarlo, **no ofrecer bundles a los fotógrafos**.
- Grupo 2 de los mismos hallazgos (plumbing de errores y UX) → **T-213**.
- Familia: T-200 (diseño) → T-203 (A) → T-204 (B) → **T-212** / T-205 (C).
