# T-052 · Bug: configuración del paso 1 del wizard (AI matching / BIB) se pierde tras error de subida

- **Prioridad:** P1
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/wizard-step1-state-persistence`
- **OpenSpec change:** — (bug fix, implementar directo)
- **PR:** —

## Requerimiento

Al crear un evento, si durante la subida de fotos (paso 3) o el envío final (paso 4) ocurre un error, y el usuario refresca la página y vuelve a subir las fotos, al llegar al paso 4 (resumen) ha perdido lo que eligió en el paso 1: reconocimiento facial (`ai_matching_enabled`) y por dorsal (`bib_detection_enabled`) aparecen desactivados aunque los hubiera activado.

El usuario estuvo a punto de crear el evento con la configuración incorrecta sin darse cuenta.

## Causa raíz a investigar

El wizard persiste el estado en `sessionStorage` (key `photo-markt_event_wizard_draft`) vía un `useEffect` que se suscribe al store de TanStack Form. La restauración sucede en otro `useEffect` de mount que llama a `form.reset(stored.values)` y luego activa el flag `hydratedFromStorage`.

En el error de T-051, la acción de servidor (`createPhotoUploadUrls`) lanzó una excepción que Next.js interpretó como "Server Components render error", renderizando el error boundary y desmontando el wizard. Cuando el wizard volvió a montar (por refresh o por navegación), la restauración desde `sessionStorage` debería funcionar — pero el usuario reporta que no lo hizo.

Hipótesis probables (en orden de verosimilitud):

1. **El error boundary y el refresh cambiaron la URL** a `/events/new` sin `?step=3`/`?step=4`, lo que causó que el wizard arrancara en paso 1. La restauración desde sessionStorage sí ocurrió, pero el usuario no lo vio porque algo (rejilla de pasos, botón "Next" en paso 3) disparó una navegación que reinicializó el form con los defaults.

2. **Race condition entre efectos**: el efecto de persistencia (`writePayload()`) escribe `form.state.values` inmediatamente al activarse `hydratedFromStorage=true`. Si hay algún tick entre `form.reset(stored.values)` y la activación del flag, se podría escribir en sessionStorage con los defaults antes de que se restauren los valores reales, sobreescribiendo el draft correcto.

3. **El store de TanStack Form llama al suscriptor antes de que `form.reset()` haya propagado**: la suscripción al store se configura en el efecto de persistencia; si el subscriber (writePayload) dispara antes de `form.reset()`, escribe los defaults.

## Criterio de aceptación (Definition of Done)

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
