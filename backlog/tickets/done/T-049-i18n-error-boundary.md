# T-049 · Página de error "Something went wrong" hardcodeada en inglés (i18n del error boundary)

- **Prioridad:** P2
- **Estado:** done
- **Blockers:** ninguno (el fallo de Connect que la dispara es operativo + T-045; ver Notas)
- **Rama:** `fix/i18n-error-boundary`
- **OpenSpec change:** —
- **PR:** #107

## Requerimiento
Cuando algo falla (p. ej. "Conectar con Stripe" en payout-profile), la app redirige a una
página que dice **"Something went wrong"** en inglés fijo, sin traducir. Debe mostrarse
traducida (es/en) como el resto de la app.

## Causa (ya localizada)
Strings hardcodeadas en inglés en los error boundaries:
- `src/app/[lang]/error.tsx` — "Something went wrong" / "An unexpected error occurred. Please
  try again." / "Try again". Es client component bajo `/[lang]/`, así que **puede** traducirse.
- `src/app/error.tsx` (GlobalError) — mismas strings; renderiza su propio `<html lang="en">` y
  vive fuera de los providers/locale, así que traducirlo es más limitado (ver Notas).
- `src/app/not-found.tsx` / `src/app/[lang]/not-found.tsx` — revisar de paso por el mismo patrón.

## Criterio de aceptación (Definition of Done)
- [x] `/[lang]/error.tsx` muestra título, descripción y botón "Reintentar" **traducidos** según el
      locale (bloque nuevo `errorPage.*` en `en.json` y `es.json`).
- [x] strings nuevas en `en.json` y `es.json`.
- [x] `not-found` (`/[lang]/`) traducida igual (o dejado explícitamente fuera de alcance con razón).
- [x] Decidir y documentar el trato del `GlobalError` raíz (mantener EN mínimo, o detectar locale
      por cookie `preferred-locale`) — no debe romper por no tener acceso al dictionary.
- [x] test que verifique paridad de claves `errorPage.*` en ambos diccionarios.
- [x] `pnpm typecheck && pnpm lint && pnpm test` en verde

## Notas
- **Por qué se ve esta página en el flujo de Connect:** el fallo de "Conectar con Stripe" lanza
  un error crudo que burbujea hasta este boundary. Ese fallo tiene **dos causas separadas**, que
  NO son de este ticket:
  1. **Operativa (bloquea Connect ahora):** el `STRIPE_SECRET_KEY` en Vercel es una **restricted
     key** (`rk_live_…`) sin permisos de Connect (`connected_account_write`,
     `accounts_kyc_raw_bank_details_read`, `accounts_kyc_basic_read`). Fix en el dashboard de
     Stripe: usar la **Secret key** (`sk_live_…`) o habilitar esos permisos en la restricted key.
  2. **Manejo elegante del error de Stripe** en `getStripeConnectStatusAction`
     (`payout-profile/actions.ts`) para no tumbar el render → eso ya está en el alcance de
     **T-045** (que audita explícitamente las acciones de Connect). Coordinar con T-045: este
     ticket traduce el boundary; T-045 evita llegar a él en el flujo de Stripe.
- El `GlobalError` raíz de Next se monta fuera del árbol de i18n; opción pragmática: dejar un
  texto EN neutro o leer la cookie `preferred-locale` (como hace `auth/callback/route.ts`).

---

## Flujo de ejecución (lo sigue `/work-next`, igual para todos)
1. `git checkout main && git pull` → crear rama `<tipo>/<slug>`.
2. Si aplica, `/opsx:propose`; si no, implementar directo.
3. Implementar + test (paridad de diccionarios).
4. `pnpm typecheck && pnpm lint && pnpm test`.
5. Commit (Conventional Commits, **sin** `Co-Authored-By`).
6. `git push -u origin <rama>`.
7. `gh pr create --draft` a `main`.
8. Marcar `done`, mover a Archivo con nº de PR, y mover el ticket a `backlog/tickets/done/`.
9. Si hubo OpenSpec change, `/opsx:archive`.
