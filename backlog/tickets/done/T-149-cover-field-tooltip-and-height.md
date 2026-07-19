# T-149 · Portada del wizard (paso 3): descripción → tooltip + altura del cuadro (full-height desktop / compacto mobile)

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/cover-field-tooltip-height` (tipo = feat)
- **OpenSpec change:** — (UI aislada en un componente; no toca pagos/BD/auth)
- **PR:** #214

## Requerimiento
En `/dashboard/photographer/events/new?step=3` (paso "detalles"), sobre el campo **"Imagen de portada (opcional)"**:
1. **Mover la descripción a un tooltip informativo.** Hoy el texto "Se muestra como la imagen del evento en la lista. Si la omites, se usa la primera foto." va como `<p>` debajo del label. Moverlo a un **tooltip** que se abre desde un **icono de info** a la **derecha del título** del campo (`coverLabel`).
2. **Altura del cuadro selector de portada:**
   - **Desktop:** que el cuadro ocupe **todo el height** de la columna derecha (la que contiene el resto de los campos del evento), en vez de su `aspect-video` fijo actual.
   - **Mobile:** como ahí las columnas se apilan (portada arriba, campos abajo), **reducir bastante** la altura del cuadro para que no se coma la pantalla.

## Contexto (verificado en el código)
- Componente: `src/app/[lang]/dashboard/photographer/events/new/steps/step-3-details.tsx`.
- Layout actual (línea ~53): `div` grid `md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]` con `items-start`. **Izquierda** = columna de portada (`grid gap-2`, línea ~56): `Label` `coverLabel` (57) + `<p>` con `t('coverDesc')` (58) + el cuadro selector/preview con `aspect-video w-full` (líneas ~65 y ~80). **Derecha** = `grid gap-4` (100) con todos los campos.
- String de la descripción: `coverDesc` (sección `newEvent`, `en.json`/`es.json` línea 911): EN "Shown as the event's card image. If you skip this, the first photo is used." / ES "Se muestra como la imagen del evento en la lista. Si la omites, se usa la primera foto." — **reusar ese string** como contenido del tooltip (no reescribir el copy).
- Primitivo `Tooltip` de shadcn ya existe (`src/components/ui/tooltip.tsx`, usado por `PhotoActionIcon`); icono `Info` de `lucide-react`. Sin libs nuevas.
- `aspect-video` fija el ratio → hoy el cuadro no sigue la altura de la columna de campos (desktop) y en mobile queda alto.

## Criterio de aceptación (Definition of Done)
- [ ] La descripción `coverDesc` **ya no** se muestra como `<p>` bajo el label; aparece en un **tooltip** que se abre desde un **icono de info** a la derecha del título `coverLabel`.
- [ ] El tooltip usa el primitivo shadcn `Tooltip` + icono `Info` (lucide); el trigger es accesible por teclado (focusable) y con `aria-label`.
- [ ] **Desktop (md+):** el cuadro selector de portada (tanto el estado vacío "elegir" como el preview) ocupa **todo el alto** de la columna derecha de campos (p. ej. `md:items-stretch` en el grid + `md:h-full` en el cuadro, quitando el `aspect-video` en desktop). No deja hueco vertical desalineado.
- [ ] **Mobile:** el cuadro tiene una altura **compacta** (p. ej. `h-32`/`h-40`, no `aspect-video` alto) para no ocupar tanta pantalla al estar apilado arriba.
- [ ] Sin cambios funcionales: subir/cambiar/quitar portada, preview y el flujo del wizard siguen igual. Resto del paso 3 intacto.
- [ ] strings nuevos (solo el `aria-label` del trigger de info, p.ej. `coverInfoAria`) en `en.json` **y** `es.json`; `coverDesc` se conserva (ahora como contenido del tooltip).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Toca `step-3-details.tsx` — mismo archivo que la familia del wizard (T-105/106/107 ya **done**; T-108 "autofill EXIF/portada" sigue **blocked** por decisión de diseño → sin conflicto ahora, pero si T-108 se ejecuta antes, coordinar el merge del label/layout de portada).
- UI aislada, sin migración, sin pagos/auth → sin `/code-review` obligatorio; revisión visual humana en el merge del draft (recomendado screenshot desktop+mobile).
- Ojo con el estado vacío y el estado con preview: ambos deben respetar el full-height desktop / compacto mobile (hoy los dos usan `aspect-video`).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `feat/cover-field-tooltip-height`.
2. Implementar directo (tooltip + alturas responsive) + test de regresión (el markup ya no renderiza el `<p>` de `coverDesc`; el trigger de tooltip existe; clases de altura desktop/mobile correctas).
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
