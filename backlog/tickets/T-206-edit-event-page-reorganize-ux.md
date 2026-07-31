# T-206 · Reorganizar la página `/dashboard/photographer/events/[id]/edit` (está desordenada)

- **Prioridad:** P2
- **Estado:** doing
- **Blockers:** ninguno para empezar — **coordinar con T-204/T-205** (misma familia de bundles) y **no
  empezar antes de que mergee PR #265** (T-203), que ya toca este mismo form
- **Rama:** `refactor/edit-event-page-ux`
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** —

## Requerimiento
"page `/en/dashboard/photographer/events/<id>/edit` is very messy and price packages are not added yet,
please reorganize it and improve UX please"

**Se parte en dos, y solo la primera mitad es este ticket:**
- **Reorganizar + mejorar la UX de la página de edición** → este ticket.
- **"price packages are not added yet"** → **NO es un ticket nuevo**: ya está construido en **T-203**
  (`feat/bundle-pricing-config`, **PR #265 en draft, sin mergear**), que incluye el editor de escalera de
  precios en el form de edición y la sección con alcance `?section=pricing`. No se ve en producción
  **porque el PR no está mergeado/desplegado**, no porque falte trabajo. Ver "Solape" abajo.

## Qué está desordenado, concretamente (verificado en el código, no impresiones)
`edit-event-form.tsx` (388 líneas) apila **todo en una sola columna plana**, sin secciones:
portada → (campos del evento | dropzone) → ajustes de IA → grid de fotos → barra fija de acciones.

Problemas puntuales encontrados:
1. **Strings hardcodeados en inglés** en una app i18n — viola la regla de `CLAUDE.md`:
   `<Label>Add Photos</Label>` (`edit-event-form.tsx:316`), `Cancel` (:352), `Save Changes` / `Saving...`
   (:355). **En `/es` se ven en inglés**: es un bug real, no solo estética.
2. **Dos modelos de guardado en la misma pantalla, sin señalizar:** la portada se guarda **sola** al
   instante (T-166, acciones propias) mientras el resto **espera al botón Save**. El usuario no tiene
   forma de saber qué ya quedó guardado y qué no.
3. **JSX comentado muerto** (:317-319, :333) — restos de iteraciones anteriores.
4. **Casts de diccionario** `t('noPreview' as keyof Dictionary['newEvent'])` (:340, y ~10 más en el
   diálogo de subida): el form de edición consume el namespace `newEvent` a la fuerza. Si falta una
   clave, el cast la oculta en vez de que falle el typecheck.
5. **Barra de acciones `fixed bottom-0 left-0 right-0 z-50`** (:345) — revisar colisión con la bottom-nav
   móvil y con `env(safe-area-inset-bottom)` (patrón ya resuelto en T-169 para el banner de cookies).
6. **El grid de fotos y la subida viven dentro del `<form>` de metadatos**, así que gestionar fotos y
   editar datos del evento son la misma pantalla y el mismo submit.

## Dirección propuesta (decidir en el PR, no cerrada aquí)
**Reusar el patrón que ya existe en el repo en vez de inventar uno.** `scoped-event-edit-form.tsx` ya
implementa edición **con alcance por sección** (`?section=info | settings | pricing`, T-179 + T-203), y
`dashboard/photographer/events/[id]` ya está en tabs top-level Photos / Details / **Pricing** / Share
(T-178 + T-203). Opciones:
- **(a) Preferida:** hacer que `/edit` agrupe en las **mismas** secciones que ya usa el modo scoped
  (Info / Settings / Pricing / Photos) con `Card` por sección, de modo que el usuario vea la misma
  estructura mental venga de donde venga. Sin rutas nuevas.
- **(b)** Empujar todo a las secciones con alcance y dejar `/edit` como índice. Más limpio, pero rompe
  bookmarks al `/edit` completo y es más cambio.
Si se elige (a) o (b), **declararlo en el PR**; T-178 ya dejó escrito que `/edit` sigue siendo la única
superficie de escritura, y esa decisión no se revierte aquí.

## Criterio de aceptación (Definition of Done)
- [ ] La página presenta la edición **agrupada en secciones legibles**, no una columna plana
- [ ] **Cero strings hardcodeados**: `Add Photos`, `Cancel`, `Save Changes`, `Saving...` salen del
      diccionario, con claves nuevas en `en.json` **y** `es.json`; `/es` no muestra inglés
- [ ] Queda explícito en la UI qué se guarda al instante (portada) y qué requiere Save
- [ ] JSX comentado muerto eliminado
- [ ] Los casts `as keyof Dictionary['newEvent']` se reducen o se justifican (idealmente: claves propias
      del form de edición, para que un typo falle en typecheck)
- [ ] La barra de acciones no tapa contenido ni colisiona con la bottom-nav en móvil (verificado en
      móvil real o emulación, light + dark)
- [ ] **Sin regresión funcional**: guardar metadatos, subir fotos, borrar fotos, portada, ajustes de IA y
      la escalera de precios de T-203 siguen funcionando exactamente igual
- [ ] El editor de bundles de T-203 sigue montado y operativo tras la reorganización
- [ ] strings nuevos en `en.json` y `es.json`
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Solape con tickets existentes (leer antes de empezar)
- **T-203** (PR **#265**, draft, sin mergear) **ya toca `edit-event-form.tsx`** para montar el editor de
  escalera. **Este ticket no arranca hasta que #265 mergee**, o habrá conflicto seguro en el mismo
  archivo. Es también la respuesta a "price packages are not added yet".
- **T-204** (carrito/checkouts/webhook) y **T-205** (Ventas/Ganancias) son los hijos que faltan de
  bundles; **no** tocan este form, pero son la misma familia y van antes en la cola.
- **T-178** creó los tabs top-level de la página de evento; **T-179** creó el patrón `?section=`. Ambos
  son el precedente a reusar, no a re-derivar.

## Notas
- El id del enunciado (`5e4f0f63-15a8-49a6-ac0f-c30eda00f43f`) es un evento concreto del usuario; el
  problema es de la **ruta**, no de ese evento.
- Sin OpenSpec y sin `/code-review` **si** queda en reorganización de UI + i18n. Si termina moviendo la
  lógica de submit o el path de subida de fotos, sí pedir review.
- Correr `pnpm build` además de typecheck (memoria `build-catches-client-graph-errors`).
- Ojo con el alcance: es fácil que esto se convierta en "reescribir el form". Mantenerlo en
  **reorganización + i18n + limpieza**; cualquier rediseño de campos es otro ticket.
