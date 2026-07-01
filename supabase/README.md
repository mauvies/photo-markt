# `supabase/` — database infrastructure (Supabase CLI)

This is the **infrastructure** half of the database, managed by the Supabase
CLI. It must stay at the repo root — the CLI resolves this directory relative
to the project root, and moving it breaks migrations, branching and the
`pnpm db:*` scripts.

```
supabase/
  config.toml     # local stack + project config (CLI-owned)
  migrations/     # raw SQL migrations (source of truth for the schema; no ORM)
  seed.sql        # local-only seed + DML grants (never runs against production)
  snippets/       # saved SQL snippets
  .branches/      # CLI branching state (generated)
  .temp/          # CLI scratch (generated)
```

Common commands (see [`CLAUDE.md`](../CLAUDE.md)):

```bash
pnpm db:start   # supabase start (local Docker stack)
pnpm db:reset   # supabase db reset (re-runs migrations + seed.sql)
pnpm db:seed    # re-run seed.sql via psql
pnpm db:stop    # supabase stop
```

> `seed.sql` is local-only. If you ever move it, update the `db:seed` path in
> `package.json`.

## Where the application database code lives

The Supabase clients and the domain query layer the app actually calls are
**not** here — they are application code under
[`src/database/`](../src/database/) (kept in `src/` by the T-019 convention).
See that directory's README and `ARCHITECTURE.md` §2.1 for why the two layers
are kept separate on purpose.
