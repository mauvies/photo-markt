# T-052 · Bug: configuración del paso 1 del wizard (AI matching / BIB) se pierde al refrescar

- **Prioridad:** P1
- **Estado:** doing
- **Blockers:** ninguno
- **Rama:** `fix/wizard-step1-state-persistence`
- **OpenSpec change:** — (bug fix, implementar directo)
- **PR:** —

## Requerimiento

Al crear un evento, si el usuario activa en el **paso 1** el reconocimiento facial (`ai_matching_enabled`) y/o por
dorsal (`bib_detection_enabled`) y **refresca la página**, esas opciones se **pierden** (los switches vuelven a
off). Deben mantenerse para el evento que se está creando.

## Repro CONFIRMADO (verificado en navegador, 2026-07-02)

**Reproduce con un refresh normal, sin necesidad de error de subida:** estar en el paso 1, activar los switches
de AI/BIB, refrescar la pestaña → los switches vuelven a off. Esto **descarta** que dependa del error/unmount de
T-051 y apunta a un fallo directo en la persistencia/restauración del draft. (El síntoma original —descubrirlo al
llegar al paso 4 tras un error de subida— es el mismo bug visto más tarde en el flujo.)

Nota: en una revisión estática previa el código de persistencia/restauración *parecía* correcto para un refresh
normal (`readStoredState` restaura `ai/bib=true`, `form.reset(stored.values)`, sin `form.reset()` sin args). Dado
que el navegador demuestra que SÍ se pierde, el fallo está en algo no visible en estático — sospechas: (a)
`form.reset(stored.values)` no propaga a los `form.Field` del paso 1 **ya montados** (los switches quedan con el
default aunque el store tenga el valor restaurado); (b) la escritura del draft pisa el valor con defaults en algún
tick del mount. Reproducir en navegador y confirmar cuál es antes de arreglar.

## Requerimiento original (mismo bug, visto tras error de subida)

Si durante la subida (paso 3) o el envío (paso 4) ocurre un error, el usuario refresca y vuelve a subir, al llegar
al paso 4 (resumen) ha perdido lo del paso 1 — y estuvo a punto de crear el evento con la config incorrecta.

## Causa raíz a investigar

El wizard persiste el estado en `sessionStorage` (key `photo-markt_event_wizard_draft`) vía un `useEffect` que se suscribe al store de TanStack Form. La restauración sucede en otro `useEffect` de mount que llama a `form.reset(stored.values)` y luego activa el flag `hydratedFromStorage`.

En el error de T-051, la acción de servidor (`createPhotoUploadUrls`) lanzó una excepción que Next.js interpretó como "Server Components render error", renderizando el error boundary y desmontando el wizard. Cuando el wizard volvió a montar (por refresh o por navegación), la restauración desde `sessionStorage` debería funcionar — pero el usuario reporta que no lo hizo.

Hipótesis probables (en orden de verosimilitud):

1. **El error boundary y el refresh cambiaron la URL** a `/events/new` sin `?step=3`/`?step=4`, lo que causó que el wizard arrancara en paso 1. La restauración desde sessionStorage sí ocurrió, pero el usuario no lo vio porque algo (rejilla de pasos, botón "Next" en paso 3) disparó una navegación que reinicializó el form con los defaults.

2. **Race condition entre efectos**: el efecto de persistencia (`writePayload()`) escribe `form.state.values` inmediatamente al activarse `hydratedFromStorage=true`. Si hay algún tick entre `form.reset(stored.values)` y la activación del flag, se podría escribir en sessionStorage con los defaults antes de que se restauren los valores reales, sobreescribiendo el draft correcto.

3. **El store de TanStack Form llama al suscriptor antes de que `form.reset()` haya propagado**: la suscripción al store se configura en el efecto de persistencia; si el subscriber (writePayload) dispara antes de `form.reset()`, escribe los defaults.

## Criterio de aceptación (Definition of Done)

- [ ] **Repro mínimo (prioritario):** paso 1 → activar AI matching y BIB → **refrescar** → los switches del paso 1 siguen activados (sin pasar por subida ni error).
- [ ] Reproducir el escenario: paso 1 con AI matching y BIB habilitados → paso 3 con fotos → simular error de subida → refrescar → re-subir fotos → paso 4 muestra AI matching y BIB correctamente activados
- [ ] El review (paso 4) siempre refleja fielmente el estado del paso 1, incluso tras un ciclo error → refresh → re-subida
- [ ] El draft en sessionStorage nunca se sobreescribe con valores por defecto mientras la restauración esté en curso
- [ ] Test: verificar que `readStoredState()` restaura correctamente `ai_matching_enabled=true` y `bib_detection_enabled=true` desde un draft serializado
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas

- El wizard usa `sessionStorage` (no `localStorage`) — se borra al cerrar la pestaña, no al refrescar. Un refresh normal no debería perder el draft.
- La restauración se hace en `wizard.tsx` en el `useEffect` con dep `[form]` (mount). El write ocurre en el `useEffect` con dep `[form, hydratedFromStorage, reachedStep, returnToStep]`.
- Los campos afectados: `ai_matching_enabled`, `bib_detection_enabled`, `contains_minors`, y potencialmente todo el paso 1.
- T-051 (ya mergeado) arregla el error de subida que desencadenó el escenario, pero no protege contra futuras pérdidas de estado en otros errores.
- Archivo de wizard: `src/app/[lang]/dashboard/photographer/events/new/wizard.tsx`.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/wizard-step1-state-persistence`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
