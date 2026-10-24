
/**
 * What the phone works out from a value as it is typed (design v3 P15, P20):
 * the right control letter for a Spanish NIF, and whether an IBAN's check
 * digits hold and whose bank it is. Pure; People still checks the value it
 * is sent, and HR still checks it against the document.
 */

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** The same number with the control letter it should have, or null when it has it or isn't a NIF. */
export function nifSuggestion(typed: string): string | null {
  const v = typed.replace(/[\s.-]/gu, '').toUpperCase();
  let digits: string;
  if (/^\d{8}[A-Z]$/u.test(v)) digits = v.slice(0, 8);
  else if (/^[XYZ]\d{7}[A-Z]$/u.test(v)) digits = String('XYZ'.indexOf(v[0] ?? '')) + v.slice(1, 8);
  else if (/^[KLM]\d{7}[A-Z]$/u.test(v)) digits = v.slice(1, 8);
  else return null;
  const letter = DNI_LETTERS[Number(digits) % 23] ?? '';
  return letter === v.at(-1) ? null : `${v.slice(0, -1)}${letter}`;
}

/**
 * Spanish banks by their four-digit entity code, the ones most payrolls see.
 * ponytail: a short list, not the Banco de España register; an unknown code
 * still checks out, it is only not named.
 */
const ES_BANKS = (): Readonly<Record<string, string>> => ({
  '0049': 'Banco Santander',
  '0075': 'Banco Santander',
  '0081': 'Banco Sabadell',
  '0128': 'Bankinter',
  '0182': 'BBVA',
  '0487': 'Banco Mare Nostrum',
  '1465': 'ING',
  '2038': 'CaixaBank',
  '2080': 'Abanca',
  '2085': 'Ibercaja',
  '2095': 'Kutxabank',
  '2100': 'CaixaBank',
  '2103': 'Unicaja',
  '3058': 'Cajamar',
  '0238': 'Banco Pichincha',
  '1491': 'Triodos Bank',
  '0073': 'Openbank',
});

/** An IBAN as somebody reads it: valid or not, and the bank where it is known. */
export function ibanCheck(typed: string): { valid: boolean; bank: string | null } | null {
  const v = typed.replace(/\s/gu, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/u.test(v)) return null;
  const moved = v.slice(4) + v.slice(0, 4);
  let numeric = '';
  for (let i = 0; i < moved.length; i += 1) {
    const c = moved.charAt(i);
    numeric += /[A-Z]/u.test(c) ? String(c.charCodeAt(0) - 55) : c;
  }
  let rest = 0;
  for (const digit of numeric) rest = (rest * 10 + Number(digit)) % 97;
  const valid = rest === 1;
  const bank = v.startsWith('ES') ? (ES_BANKS()[v.slice(4, 8)] ?? null) : null;
  return { valid, bank };
}
