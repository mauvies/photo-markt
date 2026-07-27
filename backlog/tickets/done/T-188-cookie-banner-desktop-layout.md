# T-188 · Arreglar el layout desktop del banner de cookies

- **Prioridad:** P3
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/cookie-banner-desktop-layout`  (tipo = fix)
- **OpenSpec change:** —  (UI/CSS de un componente; innecesario)
- **PR:** #250

## Requerimiento
"Pensaba que habíamos mejorado el layout UI del banner de cookies, pero en **desktop** aún se ve muy raro." (T-169 ya arregló el apilado y la posición en mobile; el problema restante es la fila de desktop.)

En el screenshot de desktop: el texto envuelve estrecho a la izquierda (~4 líneas), deja un **hueco grande y vacío** en el centro, y los tres botones (Personalizar / Rechazar todo / Aceptar todo) flotan pegados a la derecha — la composición se ve desbalanceada y "rara". El banner es demasiado ancho para tan poco contenido, así que el `flex-1` del texto no llena el espacio y el gap entre columnas queda enorme.

## Criterio de aceptación (Definition of Done)
- [ ] En **desktop** el banner de cookies se ve equilibrado: el texto y los botones ocupan el ancho de forma proporcionada, sin un hueco vacío desproporcionado entre el bloque de texto y la fila de botones.
- [ ] El texto no envuelve de forma innecesariamente estrecha dejando espacio muerto a su derecha (ajustar `max-w`, el reparto `flex-1`/`shrink-0`, el gap, o la alineación de la fila según convenga).
- [ ] Los tres botones (Personalizar / Rechazar todo / Aceptar todo) siguen igual de alcanzables y con la misma jerarquía visual (ghost / outline / primary) — solo cambia la disposición, no las acciones.
- [ ] **No romper mobile ni la posición (T-169):** el apilado full-width en mobile (`flex-col`, botones `w-full`), la posición route-aware (`hasBottomNav` → offset del bottom-nav en dashboard vs ~1rem en público) y `env(safe-area-inset-bottom)` quedan intactos.
- [ ] Verificado visualmente en desktop **y** mobile (light + dark).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.
- [ ] Sin `any`; Biome; sin otros cambios.

## Notas
- **Archivo único:** `src/components/cookie-consent-banner.tsx` (presentacional; el estado/persistencia vive en `cookie-consent.tsx` y no se toca). Contenedor actual:
  `fixed inset-x-0 z-[70] mx-auto max-w-3xl px-4 …` con la caja interior `rounded-xl border … p-4 sm:flex sm:items-center sm:gap-4`, texto en `flex-1` y botones en `shrink-0`.
- **Diagnóstico probable:** `max-w-3xl` (768px) es demasiado ancho para la cantidad de texto → el bloque `flex-1` fuerza el ancho pero el texto envuelve corto y el resto queda como hueco antes de los botones. Posibles enfoques (elegir al ejecutar): reducir el `max-w`, poner los botones debajo del texto también en desktop (banner tipo "card" más estrecho), o dar al texto un `max-w` propio y alinear los botones con `justify-between`/`ml-auto` sin dejar el gap enorme. No es una decisión de producto — es puro ajuste de layout.
- **Sin strings nuevos** (reusa el dict `cookieConsent`).
- **Historia:** sigue a T-169 (PR #233, apilado + posición route-aware) y T-170 (PR #227, persistencia del cierre del panel — no toca el markup del banner). Este cierra el hueco de desktop que T-169 no cubrió del todo.
- **Test de regresión:** al ser CSS/layout, un guard source-level (patrón `edit-event-price-field-layout` / `route-loading-skeletons`) sobre las clases del contenedor de desktop, si aporta señal; si no, revisión visual (dejar draft para eso).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cookie-banner-desktop-layout`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo (no aplica: UI/CSS de 1 archivo).
3. Implementar + test de regresión (source-level de clases, si aporta).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main` — draft para revisión visual del layout.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
