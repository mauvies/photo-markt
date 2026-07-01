# `src/database/` — application database layer

This is the **application code** half of the database. It holds the Supabase
client constructors and the domain query layer — the only code the app uses to
read from and write to Postgres/Storage.

```
src/database/
  client.ts           # anon client (Client Components) — RLS enforced
  server.ts           # user-scoped client (Server Components/Actions/API) — RLS enforced
  supabase-admin.ts   # service-role client (admin only) — bypasses RLS
  queries/            # domain query layer — one file per domain (events, photos, carts, …)
    index.ts          # central export
```

Conventions (see [`CLAUDE.md`](../../CLAUDE.md) and
[`ARCHITECTURE.md` §2](../../ARCHITECTURE.md#2-application-architecture)):

- **All Supabase queries live in `queries/`** — never inline in components or
  actions. Add new queries to the domain file that fits.
- **Pick the client by trust boundary:** user-scoped `server.ts` by default;
  `supabase-admin.ts` only when RLS would block a legitimate operation
  (webhook writes, admin endpoints, watermark API, Inngest writes).
- **Mutations go through Server Actions**, not new API routes.

## Where the rest of the database lives

Schema, migrations, seed data and local-stack config are **not** here — they
are infrastructure owned by the Supabase CLI and live in
[`supabase/`](../../supabase/) at the repo root (it must stay there for the CLI
to work). See that directory's README and `ARCHITECTURE.md` §2.1 for why the
two layers are kept separate on purpose.
