# T-169 · Arreglar el layout del banner de cookies (botones desktop+mobile, posición en mobile)

- **Prioridad:** P3
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/cookie-banner-layout`  (tipo = fix)
- **OpenSpec change:** —  (UI/layout puro, no toca pagos/auth/BD)
- **PR:** —

## Requerimiento (reporte del usuario)
> Arreglar el layout del banner de cookies, **sobre todo los botones** tanto en desktop como en mobile,
> y en **mobile** hacer que el banner se muestre **casi abajo del todo**.

## Contexto (verificado en código)
`src/components/cookie-consent-banner.tsx`:
- Contenedor: `fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[70] mx-auto
  max-w-3xl px-4 md:bottom-4` — en **mobile** flota **4.5rem** por encima del borde inferior (para
  librar el bottom-nav mobile de ~`min-h-16`); en **desktop** `md:bottom-4`. El usuario lo quiere
  **más abajo** en mobile.
- Fila de botones (línea ~47): `mt-3 flex shrink-0 flex-wrap items-center gap-2 sm:mt-0` con tres
  `Button` (`Customize` ghost, `Reject` outline, `Accept` primary). En pantallas angostas los tres
  botones **envuelven** (`flex-wrap`) y quedan apretados/desalineados; en desktop van en fila junto al
  texto (`sm:flex sm:items-center sm:gap-4`).

## Criterio de aceptación (Definition of Done)
- [ ] **Botones desktop:** los tres (Customize / Reject / Accept) quedan alineados y con jerarquía
      visual clara junto al texto, sin verse apretados ni desbordar el card `max-w-3xl`.
- [ ] **Botones mobile:** layout legible y cómodo (p. ej. full-width apilados o en fila que no se
      amontone) — sin el wrap desprolijo actual; los targets táctiles cómodos.
- [ ] **Posición mobile:** el banner se muestra **casi al fondo** de la pantalla (reducir/ajustar el
      offset `bottom-[calc(4.5rem+…)]`), respetando `env(safe-area-inset-bottom)` y **sin quedar tapado
      por el bottom-nav mobile** donde ese nav exista (validar en una ruta con bottom-nav y en una sin
      él). En desktop mantener `md:bottom-4`.
- [ ] Sin cambiar el comportamiento (los tres callbacks `onAcceptAll`/`onRejectAll`/`onCustomize`
      intactos); solo layout/estilos.
- [ ] strings nuevos en `en.json`/`es.json` solo si se agrega texto (no debería).
- [ ] test de regresión source-level (patrón `cookie-consent.test.tsx` / `route-loading-skeletons`):
      asserta las clases de layout/posición nuevas (p. ej. offset mobile más bajo, contenedor de
      botones sin el wrap apretado) — falla antes / pasa después.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **P3** — pulido visual; el banner funciona, solo se ve mal.
- **Cluster con T-170** (mismo componente `cookie-consent-banner.tsx`/`cookie-consent.tsx`): el otro
  ticket toca la **semántica de cierre/persistencia** (X + reaparición). **Coordinar merge** o
  ejecutar contiguos. Si T-170 decide agregar/quitar una **X de cerrar**, ese control entra en esta
  misma fila de acciones → alinear el diseño de botones con esa decisión.
- Revisión visual humana en el preview de Vercel (desktop + mobile, con y sin bottom-nav) recomendada.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/cookie-banner-layout`.
2. Implementar directo (layout de botones + posición mobile) + test source-level.
3. `pnpm typecheck && pnpm lint && pnpm test`.
4. Commit (Conventional Commits, **sin** trailer `Co-Authored-By`).
5. `git push -u origin <rama>`; `gh pr create --draft` a `main`.
6. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo a `backlog/tickets/done/`.
