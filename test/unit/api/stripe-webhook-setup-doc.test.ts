import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T-192 regression: the webhook route's header comment documents which events
 * the Stripe Dashboard endpoint must subscribe to. An earlier version listed
 * only `account.updated` + `charge.refunded`; a prod endpoint configured from
 * that list silently dropped every sale and subscription (orders and
 * subscriptions are only ever written by this handler), producing "0 orders /
 * 0 subscriptions all-time" while Connect status kept syncing fine.
 *
 * This test parses the route source and asserts that EVERY event the handler's
 * switch processes appears in the setup doc, so the two can never diverge
 * again. Source-level on purpose — the bug lives in the doc, and the doc is
 * what a human follows when (re)configuring the Stripe endpoint.
 */

const routeSource = readFileSync(
  join(process.cwd(), 'src/app/api/stripe/webhook/route.ts'),
  'utf8',
);

/** Events the handler actually processes: every `case '<event>'` in the switch. */
function handledEvents(): string[] {
  const events = [...routeSource.matchAll(/case '([a-z_.]+)':/g)].map((m) => m[1]);
  return [...new Set(events)];
}

/**
 * The "Stripe Dashboard setup required" section of the header doc — the part
 * an operator follows when configuring the endpoint. Deliberately NOT the
 * whole header: the descriptive "Handles Stripe webhook events" list above it
 * already names every event, so asserting against the full header could never
 * catch an incomplete SETUP list (the exact T-192 failure mode).
 */
function setupDoc(): string {
  const header = routeSource.slice(0, routeSource.indexOf('import '));
  const start = header.indexOf('Stripe Dashboard setup required');
  expect(start, 'setup section must exist in the webhook header doc').toBeGreaterThan(-1);
  return header.slice(start);
}

describe('stripe webhook setup doc (T-192)', () => {
  it('the switch handles the full expected event set', () => {
    // Guard the parser itself: if the switch shape changes and the regex stops
    // matching, this fails loudly instead of green-lighting an empty list.
    expect(handledEvents()).toEqual(
      expect.arrayContaining([
        'checkout.session.completed',
        'payment_intent.succeeded',
        'payment_intent.payment_failed',
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'account.updated',
        'charge.refunded',
      ]),
    );
  });

  it('every handled event is listed in the Stripe Dashboard setup section', () => {
    const doc = setupDoc();
    for (const event of handledEvents()) {
      expect(doc, `setup doc must tell the operator to subscribe to ${event}`).toContain(event);
    }
  });

  it('the documented production endpoint URL is the www host (apex 307-redirects)', () => {
    // T-192 actual root cause: the endpoint was registered on the apex domain,
    // which 307-redirects to www; Stripe does not follow webhook redirects, so
    // EVERY delivery failed. The setup doc must name the www URL and never
    // reintroduce the bare apex as the endpoint.
    const doc = setupDoc();
    expect(doc).toContain('https://www.photomarkt.com/api/stripe/webhook');
    expect(doc).not.toMatch(/In production: https:\/\/photomarkt\.com/);
  });
});
