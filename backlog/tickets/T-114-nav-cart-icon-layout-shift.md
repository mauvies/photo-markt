# T-114 · Fix: el ícono del carrito en el header desplaza los items del nav al aparecer (layout shift)

- **Prioridad:** P2
- **Estado:** todo
- **Blockers:** ninguno
- **Rama:** `fix/nav-cart-icon-layout-shift`
- **OpenSpec change:** —  (fix de layout acotado)
- **PR:** —

## Requerimiento
En el navbar/header, los links/controles del nav hacen un **salto en el eje horizontal** justo antes y
después de que aparece el ícono del carrito: cuando el ícono se monta, empuja a los demás items del
header, y al desmontarse vuelven a saltar. El usuario quiere que **la aparición/desaparición del ícono
del carrito NO desplace** al resto de los items del nav.

## Estado actual (verificado en el código)
- Header público `src/components/nav.tsx`: es un `flex ... justify-between` con el logo a la izquierda y
  un grupo a la derecha `<div className="flex items-center gap-2 md:gap-5">` que contiene, en orden:
  `{showCart && <CartLinkButton guest={!user} />}` → `LanguageSwitcher` → (avatar | login/signup).
- `src/components/cart-link-button.tsx`: `CartIconButton` hace **`if (count <= 0) return null`** — un
  carrito vacío no renderiza nada (decisión de producto documentada, líneas ~21-22).
- **Causa raíz del salto:** el `count` se resuelve **async** tras el primer paint →
  - Auth: `useCartItemCount()` (React Query) arranca en 0/undefined y actualiza al resolver el fetch.
  - Invitado: `useGuestCart().itemCount` arranca en 0 en SSR y se hidrata desde `localStorage`.
  Al pasar de 0 → N el ícono va de `null` a renderizado, **cambia el ancho** del grupo derecho y, como
  está anclado a la derecha (`justify-between`), empuja hacia la izquierda a los items vecinos
  (`LanguageSwitcher`, login/signup o avatar) → el salto horizontal que reporta el usuario. (Nota: ese
  grupo ya reserva espacio para el avatar con un `Skeleton h-10 w-10` mientras `user === undefined`;
  falta el mismo tratamiento para el slot del carrito.)

## Criterio de aceptación (Definition of Done)
- [ ] Los items del header (idioma, login/signup, avatar) **no se desplazan horizontalmente** cuando el
      ícono del carrito aparece o desaparece (transición count 0↔N, hidratación de invitado, y navegación
      entre superficies con/sin carrito).
- [ ] Se **preserva** la decisión "carrito vacío no muestra ícono" (el ícono sigue oculto cuando el
      carrito está vacío) — la corrección es **reservar el espacio** del slot, no mostrar un ícono vacío
      (mismo patrón que el `Skeleton` que ya reserva el hueco del avatar). Si el implementador decide que
      mostrar siempre el ícono en superficies de compra es mejor, documentar la decisión en el PR.
- [ ] Aplica al header público `nav.tsx`; **investigar** si los headers de dashboard
      (`talent-dashboard-header.tsx` / `dashboard-top-header.tsx`) montan el carrito con el mismo patrón y,
      si sufren el mismo salto, aplicar el mismo fix (o documentar por qué no aplica).
- [ ] Sin regresión visual en mobile ni desktop (el `gap-2 md:gap-5` y el resto del layout intactos).
- [ ] test de regresión/feature que falla antes y pasa después (p. ej.: el slot del carrito reserva ancho
      con count 0 y con count N el ancho del grupo no cambia; o DOM: los items vecinos mantienen su
      posición). Si un test de layout no es viable, documentar por qué y cubrir el render del placeholder.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` en verde.

## Notas
- **Archivos probables:** `src/components/nav.tsx` (grupo derecho del header) y
  `src/components/cart-link-button.tsx` (el `return null` con carrito vacío). Los hooks de conteo
  (`use-cart-item-count.ts` / `guest-cart-provider`) probablemente **no** haga falta tocarlos — el fix es
  de layout (reservar hueco), no de datos.
- **Direcciones de fix candidatas (decidir al ejecutar):** (a) envolver el carrito en un contenedor de
  ancho fijo (`w-10`/`shrink-0`) que exista siempre en superficies de compra y solo muestre el ícono
  cuando `count > 0`; (b) reservar el hueco con un placeholder invisible análogo al `Skeleton` del avatar.
- No confundir con la familia Header/nav ya hecha (T-002/T-003/T-006) — esto es un bug de layout-shift
  nuevo, distinto.

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `fix/nav-cart-icon-layout-shift`.
2. Si aplica, `/opsx:propose` para generar el change; si no, implementar directo.
3. Implementar + test de regresión (CLAUDE.md lo exige).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** trailer `Co-Authored-By` — rompe Vercel Hobby).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` apuntando a `main`.
8. Marcar ticket `done`, mover a Archivo en `backlog/BACKLOG.md` con el nº de PR, y mover el archivo del ticket a `backlog/tickets/done/`.
9. Si había OpenSpec change, `/opsx:archive`.
