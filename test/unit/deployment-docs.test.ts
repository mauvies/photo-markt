import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs with the repo root as cwd.
const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/**
 * Guards the production deployment docs (T-026): the go-live doc must exist and
 * the README must point at it, not at the old non-existent
 * `memory/project_deployment.md` that the deployment section used to link.
 */
describe('deployment docs', () => {
  it('ships docs/deployment.md', () => {
    expect(existsSync(resolve(root, 'docs/deployment.md'))).toBe(true);
  });

  it('README no longer links to the missing memory/project_deployment.md', () => {
    expect(read('README.md')).not.toContain('memory/project_deployment.md');
  });

  it('README links to the real deployment doc', () => {
    expect(read('README.md')).toContain('docs/deployment.md');
  });

  it('the go-live doc covers the critical launch areas', () => {
    const doc = read('docs/deployment.md');
    for (const heading of [
      'Environment variables',
      'Database migrations',
      'Stripe live-mode',
      'Resend domain',
      'smoke test',
    ]) {
      expect(doc).toContain(heading);
    }
  });
});
