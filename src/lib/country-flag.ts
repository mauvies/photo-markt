/**
 * Country → emoji flag, resilient to how the data is actually stored.
 *
 * T-107 persists `events.country` as Google Places' **long country name**
 * ("Spain", "United States"), not an ISO code, and it's **empty** on legacy
 * events (which crammed the formatted address into `city`). So this helper:
 *  - accepts a 2-letter ISO-3166 alpha-2 code directly ("ES"),
 *  - otherwise maps a known country **name** (English or Spanish) → alpha-2,
 *  - returns `null` for empty/unknown input so callers omit the flag cleanly
 *    (never guess from free text).
 *
 * The flag emoji is built from the two Regional Indicator Symbols for the
 * alpha-2 code (U+1F1E6 is 'A'), which every modern OS renders as a flag.
 */

// Kept intentionally small and focused on the app's actual audience (sports
// events across Spain, Latin America, the US and western Europe). Names are
// normalized (lowercased, accent-stripped) before lookup, so add plain keys.
const NAME_TO_ALPHA2: Record<string, string> = {
  spain: 'ES',
  espana: 'ES',
  'united states': 'US',
  'united states of america': 'US',
  'estados unidos': 'US',
  usa: 'US',
  'united kingdom': 'GB',
  'reino unido': 'GB',
  mexico: 'MX',
  argentina: 'AR',
  chile: 'CL',
  colombia: 'CO',
  peru: 'PE',
  ecuador: 'EC',
  uruguay: 'UY',
  paraguay: 'PY',
  bolivia: 'BO',
  venezuela: 'VE',
  brazil: 'BR',
  brasil: 'BR',
  portugal: 'PT',
  france: 'FR',
  francia: 'FR',
  germany: 'DE',
  alemania: 'DE',
  italy: 'IT',
  italia: 'IT',
  netherlands: 'NL',
  'paises bajos': 'NL',
  belgium: 'BE',
  belgica: 'BE',
  switzerland: 'CH',
  suiza: 'CH',
  austria: 'AT',
  ireland: 'IE',
  irlanda: 'IE',
  canada: 'CA',
  australia: 'AU',
  'new zealand': 'NZ',
  'nueva zelanda': 'NZ',
  'costa rica': 'CR',
  panama: 'PA',
  guatemala: 'GT',
  honduras: 'HN',
  'el salvador': 'SV',
  nicaragua: 'NI',
  'dominican republic': 'DO',
  'republica dominicana': 'DO',
  'puerto rico': 'PR',
  cuba: 'CU',
  morocco: 'MA',
  marruecos: 'MA',
  'south africa': 'ZA',
  sudafrica: 'ZA',
  japan: 'JP',
  japon: 'JP',
  norway: 'NO',
  noruega: 'NO',
  sweden: 'SE',
  suecia: 'SE',
  denmark: 'DK',
  dinamarca: 'DK',
  poland: 'PL',
  polonia: 'PL',
  'czech republic': 'CZ',
  czechia: 'CZ',
  greece: 'GR',
  grecia: 'GR',
  andorra: 'AD',
};

function alpha2ToFlag(code: string): string {
  const upper = code.toUpperCase();
  const codePoints = [...upper].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65));
  return String.fromCodePoint(...codePoints);
}

/**
 * Returns the emoji flag for a country value, or `null` when it's empty or not
 * recognized (so the caller renders no flag rather than a broken/guessed one).
 */
export function countryFlagEmoji(country: string | null | undefined): string | null {
  const raw = (country ?? '').trim();
  if (!raw) return null;

  // Already an ISO alpha-2 code.
  if (/^[A-Za-z]{2}$/.test(raw)) return alpha2ToFlag(raw);

  const normalized = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  const alpha2 = NAME_TO_ALPHA2[normalized];
  return alpha2 ? alpha2ToFlag(alpha2) : null;
}
