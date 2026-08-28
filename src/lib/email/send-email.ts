import { Resend } from 'resend';
import { env } from '@/env.mjs';

/**
 * The single Resend entry point for the whole app (T-253).
 *
 * ⚠️ **`resend.emails.send` resolves `{ data, error }` — it does NOT throw on an
 * API error.** An invalid key, an unverified sender domain, a rate limit or a
 * malformed `to` all come back as a *resolved* promise, so a caller that
 * discards the result reports success for a message that was never sent. Three
 * of the four senders in this directory did exactly that, and the guest
 * purchase email is not a courtesy: a guest has no account to recover from, so
 * that email **is** the delivery of what they paid for.
 *
 * Every send goes through here so the check cannot be forgotten again, and so
 * the FROM address is written once instead of copied per template.
 */
export const EMAIL_FROM = 'Photo Markt <noreply@photomarkt.com>';

/**
 * Thrown when Resend refuses the message. A distinct class so a caller can tell
 * "the provider said no" from "our own code blew up building the template".
 */
export class EmailDeliveryError extends Error {
  constructor(
    /** Short label for the template, e.g. `guest purchase`. */
    readonly kind: string,
    readonly reason: string,
  ) {
    super(`Resend rejected the ${kind} email: ${reason}`);
    this.name = 'EmailDeliveryError';
  }
}

/**
 * Constructed lazily rather than at module scope: importing a sender should not
 * build a client (and read the API key) in every test that merely touches the
 * module graph.
 */
let client: Resend | null = null;

function resendClient(): Resend {
  if (!client) client = new Resend(env.RESEND_API_KEY);
  return client;
}

export async function sendEmail({
  to,
  subject,
  html,
  kind,
}: {
  to: string;
  subject: string;
  html: string;
  /** Names the template in the thrown error — this is what a log search finds. */
  kind: string;
}): Promise<void> {
  const { error } = await resendClient().emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    html,
  });

  if (error) throw new EmailDeliveryError(kind, error.message);
}
