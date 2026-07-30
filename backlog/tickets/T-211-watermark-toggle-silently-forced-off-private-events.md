# T-211 · El toggle de watermark se revierte en silencio en eventos privados

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno para empezar — **coordinar con T-203 (PR #265) y T-206**, que tocan los mismos
  archivos del form de edición
- **Rama:** `fix/watermark-toggle-private-events`
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** —

## Requerimiento
"cuando trato de editar la config de un evento y activo watermarks, después de guardar cambios el
watermark no queda activado."

**No es un fallo de guardado: el servidor lo fuerza a `false` a propósito, y la UI no lo comunica.**

## Diagnóstico (confirmado, no hipótesis)
`edit/actions.ts:312`:

```ts
const watermarkEnabled = isPublic && payload.watermark_enabled;
```

Con un evento privado, `isPublic` es `false` → se persiste `watermark_enabled: false` (:343) sin error
y sin aviso, aunque el usuario haya dejado el switch encendido.

**Reproducido con datos reales** (staging, evento `prueba` / share code `PC4EWXXT`,
`5e4f0f63-15a8-49a6-ac0f-c30eda00f43f`): `type: solo`, `is_public: false`, `is_collaborative: false` →
`watermark_enabled: false` tras guardar con el switch activado.

**La regla en sí es deliberada** — el create la aplica igual (`new/actions.ts:313`): un evento privado
ya está protegido por el share code, así que no se le pone watermark. El bug es que **la UI no
implementa esa misma regla**:
- El switch de watermark se renderiza siempre y se puede activar sin importar `is_public`
  (`components/event-form-fields.tsx:339-363`).
- El switch de `is_public` **sí** arrastra el de watermark, pero **solo en el instante en que se cambia**
  (`:326`, `form.setFieldValue('watermark_enabled', !!checked)`). En un evento que ya nació privado ese
  acoplamiento nunca corre.

Resultado: cliente y servidor discrepan, y el usuario ve una preferencia que no existe.

Origen de la línea: commit `701e11d` (T-177).

## Alcance elegido — **opción (a)**, decidida por el usuario
La regla se **conserva**; se arregla la UI para que diga la verdad. **No** se quita el `isPublic &&`
(eso era la opción (b), descartada: cambiaría cómo se sirven las previews de eventos ya existentes vía
`needsProtectedPreview`, mucha más superficie de la que este síntoma justifica).

## Segundo hallazgo a corregir en el mismo PR: la excepción `organizer` no está en edit
```
new/actions.ts:313    eventType === 'organizer' ? payload.watermark_enabled : isPublic && payload.watermark_enabled
edit/actions.ts:312   isPublic && payload.watermark_enabled                  ← sin la rama organizer
```
Create **exime** a los eventos `organizer` de la regla; edit **no**. Un evento organizer privado creado
**con** watermark lo **pierde** la primera vez que se guarda cualquier edición, aunque no se toque ese
campo. No parece una decisión — parece un olvido al añadir la rama en create. Alinear edit con create.

## Criterio de aceptación (Definition of Done)
- [ ] En un evento **privado** (no organizer) el switch de watermark aparece **deshabilitado**, con copy
      que explique que un evento privado ya está protegido por el share code — no un switch activable
      que el guardado revierte
- [ ] Al pasar un evento de público a privado en el propio form, el estado del switch refleja la regla
      inmediatamente (el acoplamiento de `:326` deja de ser el único camino)
- [ ] Guardar un evento privado **no cambia** `watermark_enabled` respecto de lo que la UI mostraba:
      lo mostrado y lo persistido coinciden
- [ ] Un evento **público** sigue pudiendo activar/desactivar watermark exactamente como hoy
- [ ] `edit/actions.ts` aplica la **misma** excepción `organizer` que `new/actions.ts`: un evento
      organizer privado con watermark **conserva** el watermark al guardar una edición
- [ ] La regla de servidor sigue siendo la autoridad (la UI deshabilitada es UX, no la garantía): un
      POST hecho a mano con `watermark_enabled=true` sobre un evento privado no-organizer sigue
      guardando `false`
- [ ] strings nuevos en `en.json` y `es.json` (la copy del estado deshabilitado; ⚠️ los strings de este
      form están **hardcodeados en inglés** hoy — ver T-206)
- [ ] test de regresión que falla antes y pasa después
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Tests sugeridos** (rojo antes / verde después):
  - integración de `updateEventAction`: evento organizer privado con watermark → sigue `true` tras
    guardar (hoy pasa a `false`); evento solo privado → sigue forzado a `false` (guard de que (a) no se
    convirtió en (b) por accidente).
  - unit/componente: en evento privado el switch de watermark renderiza deshabilitado; en público, no.
- **Conflictos de archivo:** `edit/actions.ts` y `components/event-form-fields.tsx` los toca también
  **T-203** (PR #265, sin mergear) y los reorganiza **T-206**. Mergear #265 primero; y si T-206 va antes,
  rebasar sobre él. Este ticket es pequeño y puede ir antes que T-206 si #265 ya está dentro.
- No requiere migración ni toca pagos/auth → sin OpenSpec, sin `/code-review`.
- Familia: T-177 (introdujo la línea), T-206 (misma pantalla, reorganización + i18n),
  T-131/T-133/T-136 (`needsProtectedPreview` — la razón por la que NO se toca la regla).
