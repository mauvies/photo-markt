-- T-220: the manual payout-approval flow is gone, and so is `/api/admin/*`.
--
-- `admin_users` was introduced by `20260513000000` to gate that endpoint, and its
-- table comment still advertises it. That comment is the first thing anyone
-- inspecting the schema reads, and T-219 (pruning dead schema) is next in the
-- queue — a table documented as gating endpoints that no longer exist reads as
-- dead weight, when it is in fact the sole gate on the admin service-status page
-- and the fix the May 2026 security audit (finding C1) put in place.
--
-- ⚠️ Metadata only. This migration contains no DDL, no data change and no policy
-- change: `comment on` cannot affect a row, a constraint or an access rule. It
-- exists because an already-applied migration is never re-executed, so the text
-- in `20260513000000` can only be corrected by a new statement.

comment on table public.admin_users is
  'Platform admins. Service-role-only access (RLS enabled, no policies). Gates the admin service-status page at [lang]/dashboard/admin/status; there are no /api/admin/* endpoints since T-220. Look up via supabaseAdmin, never via the user-scoped client.';
