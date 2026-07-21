/**
 * Filter the Stripe SDK's "Accounts v2" recommendation out of process warnings.
 *
 * Every call to a Connect **Accounts v1** endpoint (`accounts.retrieve/create`,
 * `accountLinks.create`, `balance.retrieve`, `transfers.create`) makes the
 * Stripe server return a `stripe-notice` header, which stripe@22 relays through
 * `process.emitWarning(msg, 'Stripe')`. The message reads:
 *   "We recommend building your integration using Accounts v2."
 *
 * We stay on Accounts **v1 deliberately** (T-164 — see `ARCHITECTURE.md` §4.3):
 * v1 is fully supported (no sunset date), and migrating our whole Connect
 * surface to v2 is a large, payment-critical change with zero functional
 * benefit today. This is a purely informational recommendation, so we drop it
 * to keep dev consoles and prod server logs clean — while forwarding **every**
 * other warning (Stripe or otherwise) untouched.
 */

// Deliberately the full recommendation sentence, NOT just "Accounts v2": if a
// future SDK reworded the notice this stops matching and the (benign) log noise
// resurfaces — self-correcting, and we notice. That is safer than matching a
// broad "Accounts v2" substring, which could also swallow a genuinely important
// future notice (e.g. an Accounts v1 sunset warning that also names v2).
const ACCOUNTS_V2_RECOMMENDATION = 'We recommend building your integration using Accounts v2';

/**
 * True only for Stripe's Accounts v2 recommendation notice — matched on both the
 * `'Stripe'` warning type and the message text so no other warning is swallowed.
 */
export function isStripeAccountsV2Recommendation(warning: string | Error, type?: string): boolean {
  if (type !== 'Stripe') return false;
  // Defensive: this predicate runs inside a process-global `emitWarning`
  // wrapper, so a caller could pass a non-string/message-less payload. Coerce to
  // a string rather than risk `.includes` throwing out of the global handler.
  const raw = typeof warning === 'string' ? warning : warning?.message;
  const message = typeof raw === 'string' ? raw : '';
  return message.includes(ACCOUNTS_V2_RECOMMENDATION);
}

// Marks `process` so repeated imports of the Stripe client don't stack wrappers.
const INSTALLED_FLAG = Symbol.for('photomarkt.stripeWarningFilterInstalled');

type EmitWarning = typeof process.emitWarning;
type PatchedProcess = NodeJS.Process & { [INSTALLED_FLAG]?: boolean };

/**
 * Wrap `process.emitWarning` once so the Accounts v2 recommendation is dropped
 * and all other warnings pass through. Idempotent, and a no-op outside Node
 * (e.g. the Edge runtime, where `process.emitWarning` is absent).
 */
export function installStripeWarningFilter(): void {
  if (typeof process === 'undefined' || typeof process.emitWarning !== 'function') return;

  const proc = process as PatchedProcess;
  if (proc[INSTALLED_FLAG]) return;
  proc[INSTALLED_FLAG] = true;

  const original = process.emitWarning.bind(process);

  const patched = (warning: string | Error, ...rest: unknown[]): void => {
    // Overloads: emitWarning(warning, type?, ...) or emitWarning(warning, options?).
    // Stripe uses the string form with type 'Stripe'; also read `options.type`.
    const first = rest[0];
    const type =
      typeof first === 'string'
        ? first
        : first && typeof first === 'object' && 'type' in first
          ? (first as { type?: string }).type
          : undefined;

    if (isStripeAccountsV2Recommendation(warning, type)) return;

    (original as (w: string | Error, ...args: unknown[]) => void)(warning, ...rest);
  };

  process.emitWarning = patched as EmitWarning;
}
