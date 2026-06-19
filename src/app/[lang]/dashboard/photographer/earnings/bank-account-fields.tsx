/**
 * Country-specific bank account field configurations
 */

export interface BankAccountFields {
  label1: string;
  label2: string | null;
  label3: string | null;
  placeholder1: string;
  placeholder2: string | null;
  placeholder3: string | null;
  format1?: (value: string) => string;
  format2?: (value: string) => string;
  format3?: (value: string) => string;
}

export const BANK_ACCOUNT_FORMATS: Record<string, BankAccountFields> = {
  US: {
    label1: 'Routing Number',
    label2: 'Account Number',
    label3: null,
    placeholder1: '9-digit routing number',
    placeholder2: 'Account number',
    placeholder3: null,
    format1: (v) => v.replace(/\D/g, '').slice(0, 9),
    format2: (v) => v.replace(/\D/g, ''),
  },
  GB: {
    label1: 'Sort Code',
    label2: 'Account Number',
    label3: null,
    placeholder1: 'XX-XX-XX',
    placeholder2: '8-digit account number',
    placeholder3: null,
    format1: (v) => {
      const digits = v.replace(/\D/g, '').slice(0, 6);
      return digits.match(/.{1,2}/g)?.join('-') || digits;
    },
    format2: (v) => v.replace(/\D/g, '').slice(0, 8),
  },
  CA: {
    label1: 'Transit Number',
    label2: 'Institution Number',
    label3: 'Account Number',
    placeholder1: '5-digit transit number',
    placeholder2: '3-digit institution number',
    placeholder3: 'Account number',
    format1: (v) => v.replace(/\D/g, '').slice(0, 5),
    format2: (v) => v.replace(/\D/g, '').slice(0, 3),
    format3: (v) => v.replace(/\D/g, ''),
  },
  AU: {
    label1: 'BSB',
    label2: 'Account Number',
    label3: null,
    placeholder1: 'XXX-XXX',
    placeholder2: 'Account number',
    placeholder3: null,
    format1: (v) => {
      const digits = v.replace(/\D/g, '').slice(0, 6);
      return digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
    },
    format2: (v) => v.replace(/\D/g, ''),
  },
  // Default format for IBAN countries (most of EU and others)
  DEFAULT: {
    label1: 'IBAN',
    label2: null,
    label3: null,
    placeholder1: 'IBAN (e.g., GB82 WEST 1234 5698 7654 32)',
    placeholder2: null,
    placeholder3: null,
    format1: (v) => v.replace(/\s/g, '').toUpperCase().slice(0, 34),
  },
};

// Countries that use IBAN format
export const IBAN_COUNTRIES = [
  'AD',
  'AE',
  'AL',
  'AT',
  'AZ',
  'BA',
  'BE',
  'BG',
  'BH',
  'BR',
  'BY',
  'CH',
  'CR',
  'CY',
  'CZ',
  'DE',
  'DK',
  'DO',
  'EE',
  'EG',
  'ES',
  'FI',
  'FO',
  'FR',
  'GB',
  'GE',
  'GI',
  'GL',
  'GR',
  'GT',
  'HR',
  'HU',
  'IE',
  'IL',
  'IS',
  'IT',
  'JO',
  'KW',
  'KZ',
  'LB',
  'LC',
  'LI',
  'LT',
  'LU',
  'LV',
  'MC',
  'MD',
  'ME',
  'MK',
  'MR',
  'MT',
  'MU',
  'NL',
  'NO',
  'PK',
  'PL',
  'PS',
  'PT',
  'QA',
  'RO',
  'RS',
  'SA',
  'SE',
  'SI',
  'SK',
  'SM',
  'TN',
  'TR',
  'UA',
  'VG',
  'XK',
];

// Common countries list for dropdown
export const COMMON_COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'ES', name: 'Spain' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' },
  { code: 'PT', name: 'Portugal' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DK', name: 'Denmark' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'FI', name: 'Finland' },
  { code: 'PL', name: 'Poland' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'GR', name: 'Greece' },
  { code: 'MX', name: 'Mexico' },
  { code: 'BR', name: 'Brazil' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'PE', name: 'Peru' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'IN', name: 'India' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'SG', name: 'Singapore' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'CN', name: 'China' },
];

export function getBankAccountFields(countryCode: string | null): BankAccountFields {
  if (!countryCode) {
    return BANK_ACCOUNT_FORMATS.DEFAULT;
  }

  const upperCode = countryCode.toUpperCase();

  // Check if country has specific format
  if (BANK_ACCOUNT_FORMATS[upperCode]) {
    return BANK_ACCOUNT_FORMATS[upperCode];
  }

  // Check if country uses IBAN
  if (IBAN_COUNTRIES.includes(upperCode)) {
    return BANK_ACCOUNT_FORMATS.DEFAULT;
  }

  // Default to IBAN format for unknown countries
  return BANK_ACCOUNT_FORMATS.DEFAULT;
}
