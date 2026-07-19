# T-158 · El resumen sticky del carrito ("Proceed to checkout") se mete debajo del nav al scrollear

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno
- **Rama:** `fix/cart-summary-sticky-offset`  (tipo = feat | fix | chore | refactor)
- **OpenSpec change:** —  (se crea al ejecutar, si el cambio toca >1 archivo o es ambiguo)
- **PR:** #212

## Requerimiento
> el componente de "proceed to checkout" en la página del carrito no se está quedando en
> la posición correcta cuando hago scroll hacia abajo. Debería quedarse como sticky en el
> tope de la pantalla **por debajo del nav**, pero está subiendo un poco más de lo que debe
> (queda detrás del header).

## Causa (verificada en código)
El panel de resumen (columna derecha, desktop) es `sticky top-4` en **ambas** superficies
de carrito:
- **Invitado:** `src/app/[lang]/cart/guest-cart-content.tsx:236` — `sticky top-4 self-start …`
- **Autenticado (talent):** `src/app/[lang]/dashboard/talent/cart/cart-content.tsx:368` —
  `sticky top-4 self-start …`

El header (`HeaderShell`, `src/components/header-shell.tsx:21`) es `sticky top-0 z-50` con
altura `--header-height` (= **4.5rem**, `globals.css:112,159`). Como el resumen fija su tope
en `top-4` (1rem desde el viewport), al scrollear se pega **por encima** de donde termina el
nav → queda parcialmente tapado/detrás del header en vez de justo debajo.

## Criterio de aceptación (Definition of Done)
- [ ] El resumen sticky se ancla **justo debajo del nav** (offset = `--header-height` +
      un gap pequeño, p.ej. `top-[calc(var(--header-height)+1rem)]`) en vez de `top-4`,
      así al scrollear no se solapa con el header.
- [ ] Corregido en **ambas** superficies (`guest-cart-content.tsx` y `cart-content.tsx`)
      para que invitado y autenticado se comporten igual.
- [ ] El sticky footer **mobile** (que es un patrón distinto, abajo) no se altera.
- [ ] Sin cambios de spacing no relacionados; sin strings nuevos (es solo layout).
- [ ] test de regresión: el markup del panel de resumen usa el offset basado en
      `--header-height` (no `top-4`) en ambos archivos — falla antes, pasa después
      (patrón de test source-level tipo T-127/T-128).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- Bug de layout/CSS puro — no toca pagos/auth/BD → sin `/code-review`, sin OpenSpec.
- Verificar el valor exacto del gap contra el diseño real en el preview de Vercel (mobile no
  aplica: usa footer sticky, no la columna). `--header-height` es la fuente única de la altura
  del header — referenciarla, no hardcodear 4.5rem.
- Ojo: el mismo patrón `sticky top-4` podría existir en otras columnas de resumen (p.ej.
  detalle de evento) — este ticket se acota a las dos superficies del carrito; si al ejecutar
  se ve el mismo defecto en otra, capturar aparte.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
