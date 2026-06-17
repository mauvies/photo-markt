## Context

`active_role` lives on `profiles` and is the single source of truth (no
localStorage, no query param; the `auth/role` cookie is dead). It is read in
layouts, pages, and the cart server actions. It is written in `switchRole`
(explicit), in `completeOnboarding`, and — the bug — in both dashboard layouts on
every render via `switchRole(targetRole, { skipRevalidation: true })`.

Next.js prefetches `<Link>` targets and renders RSC layouts in the background.
A talent user with any photographer route prefetched triggers a server render of
`photographer/layout.tsx`, which writes `active_role='photographer'`, reverting
the switch. Cart actions gate on `active_role === 'talent'` and then fail. The
revert needs no user interaction, which is why it looks random.

## Goals / Non-Goals

**Goals:**
- A role switch is never reverted by a background/prefetch/multi-tab render.
- Talent actions work whenever the user holds the talent role.
- Remove dead role storage.

**Non-Goals:**
- No DB schema change, no new role model, no middleware role logic.
- Not changing how onboarding assigns the first role.
- Not introducing client-side (localStorage/context) role state.

## Decisions

**1. Rendering is read-only for role.** Remove the `if (activeRole !== X)
switchRole(X)` blocks from both layouts. A layout knows its own role (it *is* the
talent/photographer layout), so it renders with that role literal — no DB read
needed to pick the view. This deletes the bug at the source and is strictly less
code. Alternative considered: guard the write with a `next-router-prefetch`
header check. Rejected — smaller but leaves the multi-tab race and keeps the
render-writes-DB smell; "fix it" means removing the class, not one trigger.

**2. Gate permissions by capability, not active view.** Cart actions and talent
page guards switch from `active_role === 'talent'` to `userHasRole('talent')`
(new helper in `roles.ts` using the existing `getUserRoles`). Buying photos is a
talent capability, not a view mode; a photographer who also enabled talent can
use their cart. This decouples the security gate from the flaky, render-touched
`active_role`. `active_role` remains only a UI preference (which dashboard to land
on), written solely by explicit `switchRole`.

**3. Layouts gate access by capability.** A user who lacks the layout's role is
redirected to their own dashboard (proper gating — the job the render-write was
wrongly standing in for). Users with no role still go to onboarding.

**4. Delete the dead cookie.** `app/auth/role/route.ts` sets an `active_role`
cookie nothing reads — remove it (and the now-unused `cookies` import).

## Risks / Trade-offs

- **Behavior change: cart works regardless of active view** → intended; it is the
  fix. No security loss — it is the user's own cart/purchase, gated on a real
  capability (holding the talent role) instead of a mutable preference.
- **Direct nav to /dashboard/talent by a photographer-only user** → previously
  auto-enabled talent on render; now redirected to their dashboard. The menu
  switch (which enables talent) is the supported path to become talent, so the
  normal flow is unaffected. This also closes an accidental "visiting the URL
  enables talent" side effect.
- **`active_role` can now lag the view for direct-URL navigation** (you can view
  the talent layout while `active_role` is still `photographer`). Acceptable:
  permissions no longer depend on it, and the next explicit switch reconciles it.

## Open Questions

- Should direct navigation to the talent dashboard by a talent-capable user also
  update `active_role` to `talent` for landing-preference consistency? Default:
  no write on render (the whole point). The explicit switch is the only writer.
