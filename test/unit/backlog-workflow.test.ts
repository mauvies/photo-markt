import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs with the repo root as cwd.
const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const exists = (p: string) => existsSync(resolve(root, p));

/**
 * Guards the consolidated backlog workflow (T-035): the whole flow lives under
 * `backlog/` and the runner greps the queue where it actually lives. If someone
 * moves the queue back to the repo root, splits the dirs again, or drifts the
 * runner's grep path, this fails — which is exactly the breakage that would make
 * `scripts/run-backlog.sh` silently stop finding tickets.
 */
describe('backlog workflow plumbing', () => {
  it('keeps the queue at backlog/BACKLOG.md, not the repo root', () => {
    expect(exists('backlog/BACKLOG.md')).toBe(true);
    expect(exists('BACKLOG.md')).toBe(false);
  });

  it('consolidates the flow into one backlog/ directory', () => {
    expect(exists('backlog/README.md')).toBe(true);
    expect(exists('backlog/TEMPLATE.md')).toBe(true);
    expect(exists('backlog/tickets')).toBe(true);
  });

  it('separates completed tickets into backlog/tickets/done/', () => {
    expect(exists('backlog/tickets/done')).toBe(true);
    // an archived ticket lives under done/, not alongside the active ones
    expect(exists('backlog/tickets/done/T-004-featured-events-empty-tab-height.md')).toBe(true);
    expect(exists('backlog/tickets/T-004-featured-events-empty-tab-height.md')).toBe(false);
  });

  it('run-backlog.sh greps the backlog where it actually lives', () => {
    const script = read('scripts/run-backlog.sh');
    const match = script.match(/grep -qE '([^']*)'\s+(\S+);/);
    expect(match, 'run-backlog.sh must grep a BACKLOG path for todo rows').not.toBeNull();
    const [, pattern, grepPath] = match as RegExpMatchArray;
    // the path it greps must be the one that exists
    expect(grepPath).toBe('backlog/BACKLOG.md');
    expect(exists(grepPath)).toBe(true);
    // and the todo-detection regex must still match the canonical status cell
    expect(new RegExp(pattern).test('| todo |')).toBe(true);
  });

  it('points the workflow docs at the new backlog/ paths', () => {
    const claude = read('CLAUDE.md');
    expect(claude).toContain('backlog/BACKLOG.md');
    expect(claude).toContain('backlog/tickets/');

    const workNext = read('.claude/commands/work-next.md');
    expect(workNext).toContain('backlog/BACKLOG.md');
    expect(workNext).toContain('backlog/tickets/');

    const ticket = read('.claude/commands/ticket.md');
    expect(ticket).toContain('backlog/BACKLOG.md');
    expect(ticket).toContain('backlog/TEMPLATE.md');
  });
});
