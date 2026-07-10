# T-105 · Reestructurar wizard de crear evento: separar tipo/config en 2 pasos + rediseñar paso Detalles (portada 2 columnas) + limpiar hover del indicador

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `feat/event-wizard-restructure`  (tipo = feat)
- **OpenSpec change:** — (UI con requerimiento claro → implementar directo)
- **PR:** #151

## Requerimiento
El flujo de crear evento hoy son 3 pasos visibles, y el **paso 1 mezcla dos cosas** —elección del **tipo
de evento** y la **configuración** (switches: AI matching, dorsal, watermark, visibilidad, minors, subida de
invitados…)—. Cambios pedidos:

1. **Separar el paso 1 en dos pasos:**
   - **Paso 1 — Tipo de evento:** solo la selección del tipo (`solo` / `collaborative` / `organizer`).
   - **Paso 2 — Configuración:** en base al tipo elegido, mostrar **solo** los switches/opciones que
     correspondan a ese tipo.
2. **Paso 3 — Detalles: rediseñar a 2 columnas.** La **portada (cover)** se **queda en Detalles** (NO se mueve
   a Fotos — decisión revisada por el usuario), pero se coloca **primero / a la izquierda** de la pantalla,
   mientras el resto de los datos (nombre, actividad, ubicación, fecha, precio) van **a la derecha**. En mobile
   se apilan (portada arriba). Diseño limpio y bien distribuido.
3. **Paso 4 — Fotos:** el dropzone de subida (sin cambios; ya no recibe la portada).
4. **Limpiar el hover del indicador de pasos** (`WizardSteps`): al pasar el mouse por encima de cada paso
   (Config/Detalles/Fotos) el efecto de hover actual no gusta. Hacerlo **más limpio y acorde al diseño** del
   componente (sutil, consistente con el resto del wizard) — sin cambiar el comportamiento de navegación
   (back a pasos ya alcanzados).

## Criterio de aceptación (Definition of Done)
- [ ] El indicador (`WizardSteps`) muestra **4 pasos numerados**: Tipo → Config → Detalles → Fotos. El paso
      Review (hoy oculto, no numerado) sigue como continuación natural del último paso.
- [ ] **Paso 1** contiene solo la selección de tipo (los 3 `EventTypeCard`); la cascada `selectType` sigue igual.
- [ ] **Paso 2** muestra solo los switches relevantes al tipo elegido, respetando las reglas actuales (minors
      fuerza AI+dorsal off y los deshabilita; organizer oculta visibilidad; collaborative muestra guest-upload; etc.).
- [ ] **Paso 3 (Detalles)** en layout de **2 columnas**: portada a la izquierda (preview grande + cambiar/quitar),
      resto de campos a la derecha; apilado en mobile (portada arriba). La portada sigue subiéndose best-effort
      tras crear el evento (`uploadEventCoverAction`, no descarta el evento si falla — respeta T-054/T-055).
- [ ] **Paso 4 (Fotos)** contiene solo el dropzone (sin portada).
- [ ] El **hover del indicador de pasos** se rediseña a algo limpio/consistente; la navegación (volver a pasos
      alcanzados, gating `reached`) no cambia.
- [ ] El total de pasos deja de estar hardcodeado a `'3'` (`wizard.tsx:602`) y refleja el nuevo conteo.
- [ ] `goToStep`/`validateAndAdvance`, `STEP_FIELDS`, y `reviewSections` (editStep de cada sección) re-mapeados
      a los nuevos números de paso.
- [ ] La **persistencia de borrador** (`wizard-storage.ts`: `reachedStep`/`returnToStep`, hoy validados 1–4) se
      amplía al nuevo rango sin romper `isResumableDraft` ni la restauración (T-052/T-059).
- [ ] strings nuevos/actualizados en `en.json` y `es.json` (títulos de paso, `wizardStepLabel`) — sin claves huérfanas.
- [ ] test de regresión/feature que falla antes y pasa después (composición de pasos + Detalles en 2 columnas
      con la portada en su columna).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
Mapa del wizard (todo bajo `src/app/[lang]/dashboard/photographer/events/new/`):
- `wizard.tsx` (807 líneas) — switch de render `Step1..Step4` (~608-635); total hardcodeado `'3'` (602);
  `STEP_FIELDS` (39-44); `goToStep` (257-271); `validateAndAdvance` (305-337); `reviewSections` (501-587);
  barra de acciones (640-694, `currentStep < 4` → Next). La portada es `File` en estado del shell
  (`coverFile`/`coverPreviewUrl`, 79-82) — **no** se serializa en el borrador; mantener ese plumbing.
- `components/wizard-steps.tsx` — `type StepNumber = 1|2|3|4` (10), array del indicador solo 1–3 (22–28), y el
  **estilo de hover** de los pasos vive aquí (a limpiar).
- `steps/step-1-config.tsx` — hoy tipo (22–54) + switches (`AiMatchingSwitches` 190–277). **Se parte en 2 steps.**
- `steps/step-2-details.tsx` — detalles + portada (cover 347–390, T-055). **Se rediseña a 2 columnas; la portada
  se queda aquí, a la izquierda.**
- `steps/step-3-photos.tsx` — dropzone (60–71), sin cambios.
- `wizard-storage.ts` — `StoredWizardState.reachedStep/returnToStep`; `readStoredState` valida rango 1–4 (71–176).

**Cuidado (lo más delicado):** todo navega por números de paso. Insertar un paso corre TODOS los índices +1
(`STEP_FIELDS`, `reviewSections.editStep`, cap de `validateAndAdvance`, rango 1–4 de storage, `currentStep < 4`
de la barra). Considerar extraer una constante `TOTAL_STEPS` / enum de pasos para no dejar números mágicos dispersos.

**Relacionados (cluster wizard, ejecutar después de mergear T-105):** T-107 (ubicación city+state+country en el
paso Detalles), T-106 (campo de hora de sesión manual en Detalles), T-108 (autofill desde portada/EXIF — diseño).
