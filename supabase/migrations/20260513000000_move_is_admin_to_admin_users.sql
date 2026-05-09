-- Move admin flag out of profiles into a dedicated admin_users table.
--
-- Why: profiles has a public RLS policy (photographer_profiles_public_select)
-- that exposed is_admin via PostgREST queries like
--   `?select=is_admin&active_role=eq.PHOTOGRAPHER`
-- leaking the list of admins. Column-level REVOKE would also break
-- getProfile()'s `select *` for authenticated users. A dedicated table with
-- *no* RLS policies — so only the service_role can read or write it — is the
-- cleanest separation. Server-side admin checks use supabaseAdmin and bypass
-- RLS, so they continue to work.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default timezone('utc', now()),
  granted_by uuid references auth.users(id) on delete set null
);

comment on table public.admin_users is
  'Platform admins. Service-role-only access; gates /api/admin/* endpoints.';

alter table public.admin_users enable row level security;
-- Intentionally no policies: anon and authenticated cannot read or write.

-- Carry over any existing admins from the now-removed is_admin column.
insert into public.admin_users (user_id)
select id from public.profiles where is_admin = true
on conflict (user_id) do nothing;

alter table public.profiles drop column if exists is_admin;
