## 1. Capability helper

- [x] 1.1 Added `userHasRole(slug)` to `roles.ts` — pure read via `getUserRoles`.

## 2. Stop render-time role writes

- [x] 2.1 `talent/layout.tsx`: removed the render-time `switchRole('talent')` write; keep onboarding redirect; render `activeRole='talent'`; redirect users lacking the talent role.
- [x] 2.2 `photographer/layout.tsx`: same for photographer.
- [x] 2.3 Dropped unused `switchRole` import from both layouts.

## 3. Gate talent actions by capability

- [x] 3.1 `talent/cart/actions.ts`: all 7 gate sites now use `userHasRole('talent')`.
- [x] 3.2 Guards updated to capability: `talent/cart/page.tsx`, `talent/favorites/page.tsx`, `talent/events/[id]/actions.ts` (5 gates), `talent/events/[id]/page.tsx` (`viewerIsTalent` now capability-based), and `app/[lang]/actions/saved-events.ts` (`requireTalent` + `getSavedEventIdsAction` — found via the favorites page throwing at runtime). Left as view-preference (correctly): the `/dashboard` landing router, `getDashboardPath`, the public `events/[shareCode]` talent redirect, and the nav components.

## 4. Remove dead cookie

- [x] 4.1 `app/auth/role/route.ts`: removed the unused `active_role` cookie + `cookies` import.

## 5. Tests + verify

- [x] 5.1 Regression test: talent-capable user with active view photographer can `addPhotoToCartAction` (cart.test.ts); rejection test now uses a photographer-only user.
- [x] 5.2 `userHasRole` reflects membership not active view (roles.test.ts).
- [x] 5.3 `pnpm lint` + `pnpm typecheck` clean; full suite 469/469 pass.
- [ ] 5.4 Manual: switch to talent, navigate around (let photographer routes prefetch), confirm `active_role` stays `talent` and the cart works. _(browser — left for the user)_
