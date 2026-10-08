/** A currency's minor unit, as Intl knows it: 2 for EUR, 0 for JPY; null for no currency. */
export const minorDigits = (currency: string): number | null => {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? null
    );
  } catch {
    return null;
  }
};

/** `"55000.5"` EUR → `"5500050"`, by moving digits: never through a float. Null for anything else. */
export function toMinorDigits(amount: string, currency: string): string | null {
  const places = minorDigits(currency);
  if (places === null) return null;
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(amount.replaceAll(',', '').trim());
  if (!match) return null;
  const [, whole = '', fraction = ''] = match;
  if (fraction.length > places) return null;
  const digits = `${whole}${fraction.padEnd(places, '0')}`.replace(/^0+/, '');
  return digits === '' ? null : digits;
}

/** `"5500050"` EUR → `"55,000.50 EUR"` for reading; the value itself stays digits. */
export function bandAmount(minor: string, currency: string): string {
  const places = minorDigits(currency) ?? 2;
  const padded = minor.padStart(places + 1, '0');
  const whole = places === 0 ? padded : padded.slice(0, -places);
  const fraction = places === 0 ? '' : `.${padded.slice(-places)}`;
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction} ${currency}`;
}
