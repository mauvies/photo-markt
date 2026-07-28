/**
 * The single currency the platform charges, settles, and pays out in (T-193).
 *
 * The Stripe platform account settles in EUR (`default_currency: eur`) and the
 * business + audience are in the EU. Charging in any other currency forces a
 * ~2% currency-conversion fee at settlement on every sale. The currency used to
 * be hardcoded to USD in a dozen places; every Stripe charge/transfer, every
 * order-currency default, and every money formatter now references this
 * constant so the charge currency can never silently diverge from the
 * settlement currency again.
 *
 * NOTE (Stripe "separate charges and transfers"): the per-order transfer to the
 * photographer's connected account is created with a `source_transaction`, so
 * Stripe requires the transfer currency to match the charge currency — both use
 * `PLATFORM_CURRENCY`.
 */

/** ISO 4217 code, lowercase — the form Stripe's API expects (`price_data.currency`, transfers). */
export const PLATFORM_CURRENCY = 'eur';

/** Uppercase ISO 4217 code — for `Intl.NumberFormat({ currency })` and schema.org `priceCurrency`. */
export const PLATFORM_CURRENCY_CODE = 'EUR';

/** Currency symbol for lightweight string interpolation where a full formatter is overkill. */
export const PLATFORM_CURRENCY_SYMBOL = '€';
