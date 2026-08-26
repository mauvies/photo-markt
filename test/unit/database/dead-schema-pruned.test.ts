import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T-219 regression: the archaeological layer this repo kept re-discovering and
 * never removing — `payment_accounts`, `ai_search_profiles`, `time_sync_tokens`,
 * `upload_batches`, `upload_objects`, the ghost `events` columns, and
 * `profiles.is_admin`.
 *
 * ⚠️ **`is_admin` is the one that matters.** The others were merely dead; a
 * column *named* `is_admin` that gates nothing is an invitation. Real platform
 * authorization is the `admin_users` table, read through `supabaseAdmin`. A
 * future contributor writing `if (profile.is_admin)` in good faith would ship a
 * bypass that reads like a gate — and a `drop column` cannot prevent that,
 * because the check compiles fine against a column PostgREST simply never
 * returns. Only an assertion over the source can.
 *
 * Source-level on purpose, following `dead-billing-routes-removed.test.ts`
 * (T-202) and `dead-admin-payout-route-removed.test.ts` (T-220): a query against
 * a pruned database proves nothing in a unit run (there is none), and what must
 * not come back is the FILE and the IDENTIFIER.
 */

const SRC = join(process.cwd(), 'src');
const QUERIES = join(SRC, 'database/queries');
const MIGRATIONS = join(process.cwd(), 'supabase/migrations');

/** Every .ts/.tsx source file below `dir`. */
function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry)) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}

/** Repo-relative paths of every source file under `src/` containing `needle`. */
function sourceFilesContaining(needle: string): string[] {
  return sourceFilesUnder(SRC)
    .filter((file) => readFileSync(file, 'utf8').includes(needle))
    .map((file) => file.slice(process.cwd().length + 1));
}

/** The T-219 migration, read once. Empty string if it has been deleted. */
function pruneMigrationSource(): string {
  if (!existsSync(MIGRATIONS)) return '';
  const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_prune_dead_schema.sql'));
  return file ? readFileSync(join(MIGRATIONS, file), 'utf8') : '';
}

describe('dead schema pruned (T-219)', () => {
  it('ships no is_admin authorization check', () => {
    // THE headline assertion. `admin_users` is service-role-only (RLS enabled,
    // no policies) and is looked up with supabaseAdmin; `profiles` has a public
    // SELECT policy, which is why the flag was moved out of it in the first
    // place (20260513000000). A re-added `is_admin` read would be both dead and
    // dangerous.
    expect(
      sourceFilesContaining('is_admin'),
      'platform admin authorization is the `admin_users` table via supabaseAdmin — `is_admin` is a ' +
        'dropped column that gates nothing, so a check against it is a bypass wearing the ' +
        'appearance of a gate',
    ).toEqual([]);
  });

  it('keeps admin_users as the live gate', () => {
    // Guards the assertion above from being satisfied by deleting admin gating
    // altogether: `is_admin` is absent BECAUSE `admin_users` owns this. If the
    // status page lost its check, the test above would still pass while the
    // service-health surface rendered for any authenticated user.
    const statusPage = join(SRC, 'app/[lang]/dashboard/admin/status/page.tsx');
    expect(existsSync(statusPage), 'the admin status page is the one admin-gated surface').toBe(
      true,
    );

    const source = readFileSync(statusPage, 'utf8');
    expect(source).toContain("from('admin_users')");
    expect(source, 'a non-admin must be refused, not merely looked up').toContain('if (!admin)');
  });

  it('no longer ships the payment-accounts query module', () => {
    // Superseded by Stripe Connect (`profiles.stripe_connect_account_id`). It
    // held photographer bank/PayPal details in a jsonb column with zero readers
    // — the module coming back would be a second, unreviewed payout identity.
    expect(existsSync(join(QUERIES, 'payment-accounts.ts'))).toBe(false);
    expect(readFileSync(join(QUERIES, 'index.ts'), 'utf8')).not.toContain('payment-accounts');
  });

  it('queries none of the dropped tables', () => {
    for (const table of [
      'payment_accounts',
      'ai_search_profiles',
      'ai_search_usage',
      'time_sync_tokens',
      'upload_batches',
      'upload_objects',
    ]) {
      expect(
        sourceFilesContaining(`from('${table}')`),
        `public.${table} was dropped by the T-219 migration — a query against it now fails at runtime`,
      ).toEqual([]);
    }
  });

  it('references none of the dropped columns', () => {
    expect(
      sourceFilesContaining('payment_account_id'),
      'dropped with public.payment_accounts; the payout ledger identifies its destination through ' +
        'the photographer’s Stripe Connect account',
    ).toEqual([]);

    expect(
      sourceFilesContaining('organizer_fee_per_photo'),
      'the wizard collected this fee and no money path ever applied it — reinstating the field ' +
        'would promise organizers a payout that does not exist. Build the revenue split first',
    ).toEqual([]);

    for (const column of ['start_date', 'end_date', 'time_offset', 'time_sync_enabled']) {
      expect(
        sourceFilesContaining(`events.${column}`),
        `events.${column} was a camera-time-sync ghost column, dropped by T-219`,
      ).toEqual([]);
    }
  });

  it('keeps the migration that performs the drops', () => {
    // Without this, deleting the migration would silently un-prune the schema on
    // the next environment rebuild while every assertion above stayed green —
    // the source has no reason to mention a table it no longer uses.
    const sql = pruneMigrationSource();
    expect(sql, 'supabase/migrations/*_prune_dead_schema.sql must exist').not.toBe('');

    for (const artifact of [
      'payment_accounts',
      'ai_search_profiles',
      'ai_search_usage',
      'time_sync_tokens',
      'upload_batches',
      'upload_objects',
      'payment_account_id',
      'organizer_fee_per_photo_cents',
      'is_admin',
      'search_user_by_email',
      'set_photo_embeddings_updated_at',
    ]) {
      expect(sql, `the T-219 migration must drop ${artifact}`).toContain(artifact);
    }

    // Idempotent by construction: the migration set is known not to describe
    // production completely (an edited-after-apply migration never re-runs), so
    // an unguarded drop fails in whichever environment already lacks the object.
    const drops = sql.split('\n').filter((line) => /^\s*(drop|alter)\b/i.test(line));
    expect(drops.length).toBeGreaterThan(0);
    for (const line of drops) {
      expect(line.toLowerCase(), `every drop must be guarded: ${line.trim()}`).toContain(
        'if exists',
      );
    }
  });
});
