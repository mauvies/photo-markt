/**
 * The Supabase advisor gate (T-225).
 *
 * What is worth pinning is not the HTTP call but the decision it feeds: which
 * findings fail the build, and how a finding is identified across runs. A key
 * that drifts silently turns the gate into a rubber stamp — it would keep
 * passing while the baseline no longer describes anything real.
 */

import { describe, expect, it } from 'vitest';
import { ADVISORS_BASELINE } from '../../../scripts/advisors-baseline';
import {
  type AdvisorLint,
  advisorKey,
  diffAdvisors,
  formatReport,
  isBlocking,
} from '../../../scripts/supabase-advisors';

/** Shaped after a real `/advisors/security` row. */
function lint(overrides: Partial<AdvisorLint> = {}): AdvisorLint {
  return {
    name: 'function_search_path_mutable',
    level: 'WARN',
    detail: 'Function `public.set_orders_updated_at` has a role mutable search_path',
    metadata: { name: 'set_orders_updated_at', schema: 'public' },
    ...overrides,
  };
}

describe('advisorKey', () => {
  it('qualifies the entity with its schema', () => {
    expect(advisorKey(lint())).toBe('function_search_path_mutable:public.set_orders_updated_at');
  });

  it('includes the argument list so an overload is its own finding', () => {
    const key = advisorKey(
      lint({
        name: 'authenticated_security_definer_function_executable',
        metadata: {
          name: 'search_users_by_text',
          schema: 'public',
          arguments: 'search_text text, result_limit integer',
        },
      }),
    );

    expect(key).toBe(
      'authenticated_security_definer_function_executable:public.search_users_by_text(search_text text, result_limit integer)',
    );
  });

  it('falls back to the lint name for findings with no entity (auth-level lints)', () => {
    expect(advisorKey({ name: 'auth_leaked_password_protection', level: 'WARN' })).toBe(
      'auth_leaked_password_protection',
    );
    expect(advisorKey({ name: 'auth_otp_long_expiry', level: 'WARN', metadata: null })).toBe(
      'auth_otp_long_expiry',
    );
  });
});

describe('isBlocking', () => {
  it('blocks on ERROR and WARN', () => {
    expect(isBlocking(lint({ level: 'ERROR' }))).toBe(true);
    expect(isBlocking(lint({ level: 'WARN' }))).toBe(true);
  });

  it('does not block on INFO — the seven rls_enabled_no_policy findings are correct', () => {
    expect(isBlocking(lint({ level: 'INFO' }))).toBe(false);
  });
});

describe('diffAdvisors', () => {
  const baseline = {
    projectRef: 'test-ref',
    accepted: [
      {
        key: 'function_search_path_mutable:public.set_orders_updated_at',
        level: 'WARN',
        reason: 'trigger function, nothing to escalate to',
      },
    ],
  };

  it('passes when every blocking finding is accepted', () => {
    const diff = diffAdvisors([lint()], baseline);

    expect(diff.undeclared).toEqual([]);
    expect(diff.blocking).toHaveLength(1);
  });

  it('fails on a blocking finding nobody declared', () => {
    const rogue = lint({
      name: 'anon_security_definer_function_executable',
      metadata: { name: 'dump_everything', schema: 'public' },
    });

    const diff = diffAdvisors([lint(), rogue], baseline);

    expect(diff.undeclared).toEqual([rogue]);
    expect(formatReport(diff)).toContain(
      'anon_security_definer_function_executable:public.dump_everything',
    );
  });

  it('ignores an undeclared INFO finding', () => {
    const info = lint({
      name: 'rls_enabled_no_policy',
      level: 'INFO',
      metadata: { name: 'admin_users', schema: 'public' },
    });

    expect(diffAdvisors([info], baseline).undeclared).toEqual([]);
  });

  it('reports a stale baseline entry without failing the build', () => {
    const diff = diffAdvisors([], baseline);

    expect(diff.stale.map((entry) => entry.key)).toEqual([
      'function_search_path_mutable:public.set_orders_updated_at',
    ]);
    expect(diff.undeclared).toEqual([]);
    expect(formatReport(diff)).toContain('no longer reported');
  });

  it('does not call an accepted INFO finding stale — it is still being reported', () => {
    const infoBaseline = {
      projectRef: 'test-ref',
      accepted: [
        { key: 'rls_enabled_no_policy:public.admin_users', level: 'INFO', reason: 'admin-only' },
      ],
    };
    const info = lint({
      name: 'rls_enabled_no_policy',
      level: 'INFO',
      metadata: { name: 'admin_users', schema: 'public' },
    });

    expect(diffAdvisors([info], infoBaseline).stale).toEqual([]);
  });
});

describe('the checked-in baseline', () => {
  it('gives every accepted finding a reason', () => {
    const unexplained = ADVISORS_BASELINE.accepted.filter(
      (entry) => entry.reason.trim().length < 20,
    );
    expect(unexplained).toEqual([]);
  });

  it('declares each key once', () => {
    const keys = ADVISORS_BASELINE.accepted.map((entry) => entry.key);
    expect(keys).toHaveLength(new Set(keys).size);
  });

  it('points at staging, never production', () => {
    // The pinned ref is the control that keeps an account-wide PAT off prod.
    expect(ADVISORS_BASELINE.projectRef).toBe('rozglsxdolgouslaojtm');
  });
});
