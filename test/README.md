# Testing

This project uses **Vitest** for unit and integration tests, and **Supabase
local** (Docker-backed) for tests that need a real database.

## Prerequisites

- **Docker Desktop** running (Supabase local spins up Postgres, Auth, Storage
  and friends as containers).
- pnpm install completed at least once — `supabase` is shipped as a dev
  dependency, no separate global install needed.

## Layout

```
test/
  unit/                   # Pure functions, no DB, no mocks
    lib/                  # Tests for lib/* helpers
  integration/            # Hit real local Supabase via test helpers
    actions/              # Server Actions
    api/                  # API route handlers (e.g. Stripe webhook)
    queries/              # database/queries/* layer
    security/             # RLS regression tests
  helpers/
    supabase-test-client.ts   # createTestUser / createTestEvent / etc.
    server-action-mocks.ts    # mockSession shared by Server Action tests
  setup.ts                # env-var defaults loaded before each test file
```

Vitest discovers any file under `test/` matching `*.test.ts(x)`.

## Running tests

| Command | What it does |
|---|---|
| `pnpm test` | One-shot run of every test |
| `pnpm test:watch` | Watch mode |
| `pnpm test:coverage` | Run + write HTML/lcov coverage report under `coverage/` |

Coverage thresholds are **not enforced** yet — the report is informational.
The target is 60% on lines/branches/functions/statements; we'll flip the
gate on in `vitest.config.ts` once we've written enough tests to clear it.

## Local Supabase

Integration tests assume the stack is already up. Start it once per session:

```bash
pnpm db:start    # supabase start  — downloads images on first run
pnpm db:reset    # re-runs all migrations + supabase/seed.sql from scratch
pnpm db:stop     # supabase stop  — keeps the docker volume around
```

Ports (stable across resets, defined in `supabase/config.toml`):

- API: `http://127.0.0.1:54321`
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- Studio: `http://127.0.0.1:54323`
- Mailpit: `http://127.0.0.1:54324`

The service-role and anon JWTs are the well-known local defaults; they're
hardcoded in `test/helpers/supabase-test-client.ts` so contributors don't
need a `.env.test`.

> **Run `pnpm db:reset` once after pulling.** `supabase/seed.sql` grants the
> API roles (`anon`/`authenticated`/`service_role`) DML on `public` tables.
> A Supabase CLI bump once provisioned those tables without these grants, so
> every supabase-js call failed with `permission denied for table …` and the
> whole integration suite went red in `beforeEach`. The grants live in
> `seed.sql` (local-only — never touches production) and apply on `db:reset`.
> If the suite fails fast with "Local Supabase is not provisioned for tests",
> that's the pre-flight in `supabase-test-client.ts` telling you to reset.

## Patterns

### Unit test

Pure function in, expected output out. No setup, no DB.

```ts
import { describe, expect, it } from 'vitest';
import { slugify } from '@/lib/slugify';

describe('slugify', () => {
  it('strips accents', () => {
    expect(slugify('Maratón')).toBe('maraton');
  });
});
```

See `test/unit/example.test.ts` for a more complete example.

### Integration test

Reset the DB, set up fixtures with helpers, exercise the query, assert.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { getEventBySlug } from '@/database/queries/events';
import {
  createServiceClient,
  createTestEvent,
  createTestUser,
  resetDatabase,
} from '../helpers/supabase-test-client';

describe('getEventBySlug', () => {
  beforeEach(() => resetDatabase());

  it('returns a matching public event', async () => {
    const user = await createTestUser('PHOTOGRAPHER');
    await createTestEvent(user.id, { slug: 'my-slug-2026', is_public: true });

    const found = await getEventBySlug(createServiceClient(), 'my-slug-2026');
    expect(found?.slug).toBe('my-slug-2026');
  });
});
```

See `test/integration/example.test.ts` for the full reference.

### Choosing a client

`supabase-test-client.ts` exposes two builders:

- `createServiceClient()` — service-role JWT. Bypasses RLS. Use for setup and
  for assertions about *query behaviour* independent of authorization.
- `createAnonClient()` — anon JWT. Subject to RLS. Use when the assertion is
  specifically about RLS ("this user should not see X").

For tests that need a *specific authenticated user* (RLS scoped to them),
sign in with the credentials returned by `createTestUser()` — its
`password` is `'test-password-1234'` by convention.

## Debugging a failing test

1. **Run a single file** to narrow the noise:
   ```bash
   pnpm test test/integration/example.test.ts
   ```
2. **Open Studio** at `http://127.0.0.1:54323` to inspect what the test left
   in the DB. Integration tests reset between cases via `beforeEach`, but
   the last-run state survives between `pnpm test` invocations.
3. **Tail Supabase logs**:
   ```bash
   docker logs -f supabase_db_photomarkt
   ```
4. **Get the local connection string** for ad-hoc SQL:
   ```bash
   pnpm exec supabase status -o env | grep DB_URL
   ```
5. **Force a fresh state** if migrations or schema look stale:
   ```bash
   pnpm db:reset
   ```
6. **`permission denied for table …` on every test?** The local API roles are
   missing their DML grants — run `pnpm db:reset` to re-apply `supabase/seed.sql`.
7. **`Failed to download photo … Object not found` from an Inngest job when
   using `pnpm dev` (not `pnpm test`)?** That's a dev-environment mismatch, not
   a test failure — see the root [`README.md`](../README.md#5-optional-testing-ai-background-jobs-locally-face-indexing--thumbnails--bib-detection)
   for running the Inngest Dev Server locally.

## CI

`.github/workflows/test.yml` runs the same `pnpm test:coverage` pipeline on
every pull request and on push to `main`. The job sets up Supabase local
and uploads the coverage report as a workflow artifact (no Codecov yet).
