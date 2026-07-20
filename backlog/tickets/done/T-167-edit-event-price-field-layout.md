# T-167 · El campo "Price per Photo" del formulario de edición se ve mal (el `$` queda desalineado del número)

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/edit-event-price-field-layout`  (tipo = fix)
- **OpenSpec change:** —  (bug de layout/CSS puro)
- **PR:** #229

## Requerimiento (reporte del usuario)
> Al editar un evento desde el dashboard de fotógrafos, el campo de **precio por foto se muestra super
> raro** (adjuntó captura: el número `5` aparece arriba y el signo `$` **abajo a la izquierda**, en vez
> de estar alineado con el número dentro del input).

## Causa — dos candidatos verificados en código (confirmar cuál domina al ejecutar/ver el form)
Archivo: `src/app/[lang]/dashboard/photographer/events/[id]/edit/components/event-form-fields.tsx`.
El prefijo `$` (línea ~253) es `absolute left-3 top-1/2 -translate-y-1/2` dentro de un
`<div className="relative">` que envuelve el `<Input>` (`className="pl-7"`, línea ~284).

**Candidato A — stretch del grid de Row 3 (explica mejor el gran offset de la captura).**
- **Row 3** (línea ~152) es `grid gap-4 md:grid-cols-2` **sin `items-start`** → default
  `align-items: stretch`. La columna izquierda apila **Date + "Session time"** (dos campos) → más alta;
  si la celda/wrapper del precio se estira para igualarla, el `top-1/2` centra el `$` respecto a un
  contenedor **mucho más alto** que el input y el número queda arriba → el `$` "flota" una línea abajo
  (justo lo de la captura, que muestra el `$` claramente **debajo**, no un desfase de 1-2 px).

**Candidato B — falta `text-sm` en el input del edit (hallazgo del análisis, paridad rota con el create).**
- El markup `$`+input del edit es **idéntico byte-a-byte** al del wizard de creación
  (`events/new/steps/step-3-details.tsx:400-435`, y el gemelo de organizer-fee ~336-371), que **renderiza
  bien**. La **única** diferencia de clase: el create usa `className="pl-7 text-sm"`; el **edit usa solo
  `pl-7`**. El `Input` compartido (`src/components/ui/input.tsx:11`) es `h-9 text-base md:text-sm` → en
  el edit el input queda `text-base` (16px) bajo `md`, mientras el `<span>` del `$` no tiene tamaño de
  fuente → mismatch de line-height entre el `$` de 16px y el box `h-9` que puede desalinear el prefijo.

Nota: un mismatch de fuente (B) suele dar un desfase pequeño; el offset grande de la captura apunta más
a A (contenedor estirado). Probable que el fix limpio sea **A (que la celda no se estire) + B (agregar
`text-sm` por paridad)**. No afecta el valor — es puramente visual.

## Criterio de aceptación (Definition of Done)
- [ ] El `$` queda **alineado verticalmente con el número** dentro del input en el form de edición,
      tanto en desktop (2 columnas) como en mobile (apilado), con o sin "Session time" presente.
- [ ] Fix acotado a layout/paridad, atacando ambos candidatos: **(A)** `items-start` en el grid de Row 3
      (o anclar el campo de precio al top de su celda / asegurar que el `.relative` tenga altura de una
      sola línea) para que la celda de Price no se estire; **(B)** agregar `text-sm` al `<Input>` del edit
      (línea ~284) para igualar el `pl-7 text-sm` del create. Sin cambiar el comportamiento del input
      (valor, `$`, `pl-7`, validación, el clear a null).
- [ ] El wizard de creación (`step-3-details.tsx`, que **ya renderiza bien** con `pl-7 text-sm`) queda
      como referencia de paridad — no introducir regresión ahí; si se toca el patrón `$`, alinear ambos.
- [ ] Sin regresión del layout de Row 3 (Date + Session time a la izquierda, Price a la derecha).
- [ ] test de regresión source-level (patrón de los tests de UI del repo, p. ej. `route-loading-
      skeletons`/`cover-field-tooltip-height`): asserta la corrección de alineación (p. ej. `items-start`
      presente en el grid de Row 3, o que el `$`/input ya no dependan de un contenedor estirado) — falla
      antes / pasa después.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **P3** — visual/pulido; el valor del precio funciona, solo se ve desalineado.
- **Cluster con T-166** (mismo archivo `event-form-fields.tsx`, mismo edit form): coordinar merge o
  ejecutar contiguos. Este es el fix chico (CSS); T-166 es la feature de portada.
- Sin strings nuevos (solo layout). Sin `/code-review`, sin OpenSpec.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/edit-event-price-field-layout`.
2. Implementar directo (alineación del `$`/input en Row 3) + test de regresión source-level.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
