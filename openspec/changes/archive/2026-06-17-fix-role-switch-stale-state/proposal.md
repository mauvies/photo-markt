## Why

Switching from photographer to talent doesn't reliably stick: talent actions
(add to cart, view talent pages) intermittently fail as if the photographer role
is still cached. Root cause confirmed by investigation: **the dashboard layouts
write `active_role` to the database during render**
(`talent/layout.tsx:29-32`, `photographer/layout.tsx:32-35` call
`switchRole(..., { skipRevalidation: true })`). Rendering is not a user action —
Next.js prefetches routes and renders RSC layouts in the background, so when a
talent user has any photographer route prefetched, `photographer/layout.tsx`
runs server-side, sees `active_role='talent'`, and writes it back to
`photographer`. The cart actions then read `active_role !== 'talent'` and block.
This is intermittent and happens with no user interaction — exactly the reported
symptom.

The deeper problem: `active_role` conflates two concerns — *which dashboard the
user is viewing* (a UI preference) and *what the user is allowed to do* (a
permission). Gating purchases on a mutable, render-overwritten field is the bug.

(Note: there is no `localStorage` or URL query-param storage for the role — the
original hypothesis. The only extra store is a `active_role` cookie that is
written but never read — dead code.)

## What Changes

- **Layouts stop mutating role on render.** Remove the `switchRole(...)` write
  from `talent/layout.tsx` and `photographer/layout.tsx`. Each layout renders its
  own role view by definition; it gates by *capability* (redirect users who lack
  the role) instead of writing the DB. This removes the entire class of
  render-time role reverts (prefetch, multi-tab, any background render).
- **Permission gating moves to capability, not active view.** Talent cart actions
  and talent page guards check "does this user have the TALENT role" instead of
  `active_role === 'talent'`. A talent-capable user can use their cart regardless
  of which dashboard they last viewed. Add a `userHasRole(slug)` server helper.
- **`active_role` becomes a pure UI preference**, written only by the explicit
  user-initiated `switchRole` (menu / role route), and read for "which dashboard
  to land on". No render path writes it.
- **Delete the dead `active_role` cookie** set in `app/auth/role/route.ts` — never
  read anywhere.

## Capabilities

### New Capabilities
- `role-state-consistency`: How the active role is stored, who may write it, and
  how talent permissions are gated so a role switch is never silently reverted by
  a background render.

### Modified Capabilities
<!-- None — no existing spec covers role state. -->

## Impact

- **Code:** `app/[lang]/dashboard/talent/layout.tsx`,
  `app/[lang]/dashboard/photographer/layout.tsx`,
  `app/[lang]/dashboard/talent/cart/actions.ts` (5 gate sites),
  talent page guards (`talent/cart/page.tsx`, `talent/favorites/page.tsx`,
  `talent/events/[id]/*`), `app/[lang]/actions/roles.ts` (add `userHasRole`),
  `app/auth/role/route.ts` (remove cookie).
- **Behavior change (intentional):** purchasing/cart no longer depends on the
  current view — any talent-capable user can use the cart. This is the fix, not a
  regression; buying photos is a talent capability, not a view mode.
- **No DB schema change.** No new dependencies.
