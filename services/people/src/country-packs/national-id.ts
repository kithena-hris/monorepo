import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * A national identifier, checked against its country's rule (PRD §6.4).
 *
 * Pure: no clock, no I/O. A `national_id` attribute carries a country and a
 * scheme in its `typeConfig`, and this is what those two name.
 *
 * **Refuse only what is certainly wrong.** A country here is a claim that its
 * paperwork rules are right, and a validator that rejects a real employee's
 * real identifier stops their payroll. Where a rule was not certain it is
 * checked for shape only, and the comment says so — each is a place for the
 * per-country reviewer PEO-059 asks for to tighten.
 */

export interface NationalIdCheck {
  /** Uppercase, with the spaces, dots, dashes and slashes people type removed. */
  readonly normalised: string;
  /** `length_only` when no rule exists for the scheme: accepted, not vouched for. */
  readonly checked: 'rule' | 'length_only';
}

/** A reason the value is wrong, or null when it is fine. */
type Rule = (value: string) => string | null;

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/**
 * NIF of a natural person: a DNI, a NIE, or a K/L/M NIF.
 *
 * All three end in the same mod-23 control letter. A NIE's X, Y or Z stands
 * for 0, 1 or 2 in front of the digits; a K, L or M NIF is computed over its
 * seven digits alone. A company CIF is refused — an employee is never one.
 */
const nif: Rule = (v) => {
  let digits: string;
  if (/^\d{8}[A-Z]$/u.test(v)) digits = v.slice(0, 8);
  else if (/^[XYZ]\d{7}[A-Z]$/u.test(v)) digits = String('XYZ'.indexOf(v[0] ?? '')) + v.slice(1, 8);
  else if (/^[KLM]\d{7}[A-Z]$/u.test(v)) digits = v.slice(1, 8);
  else return 'a NIF is eight digits and a letter, or a NIE such as X1234567L';

  return DNI_LETTERS[Number(digits) % 23] === v.at(-1) ? null : 'that NIF’s letter does not match its digits';
};

/*
 * Número de afiliación a la Seguridad Social: province, number, two control
 * digits. Shape only — the mod-97 control has a special case for short
 * numbers that was not verified against TGSS documentation.
 */
const naf: Rule = (v) => (/^\d{12}$/u.test(v) ? null : 'a Social Security number is twelve digits');

/**
 * National Insurance number, per HMRC's allocation rules.
 *
 * First letter never D, F, I, Q, U or V; second never those or O; seven
 * prefix pairs are never allocated. The suffix is A to D, and may be absent
 * because HMRC's own RTI schema allows it blank.
 */
const NINO = /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]?$/u;
const NINO_NEVER = new Set(['BG', 'GB', 'KN', 'NK', 'NT', 'TN', 'ZZ']);
const nino: Rule = (v) =>
  NINO.test(v) && !NINO_NEVER.has(v.slice(0, 2))
    ? null
    : 'a National Insurance number is two letters, six digits and A, B, C or D';

/**
 * Steuerliche Identifikationsnummer: eleven digits, no leading zero, and an
 * ISO 7064 MOD 11,10 check digit.
 *
 * The rule about how often a digit may repeat is deliberately not checked: it
 * changed for numbers issued from 2016, and an old rule refuses new numbers.
 */
const steuerId: Rule = (v) => {
  if (!/^[1-9]\d{10}$/u.test(v)) return 'a Steuer-ID is eleven digits';
  let product = 10;
  for (const d of v.slice(0, 10)) {
    const sum = (Number(d) + product) % 10 || 10;
    product = (sum * 2) % 11;
  }
  const check = (11 - product) % 10;
  return check === Number(v[10]) ? null : 'that Steuer-ID’s check digit does not match';
};

/*
 * Sozialversicherungsnummer: area, birth date, initial, serial, check digit.
 * Shape only — the check digit's letter weighting was not verified.
 */
const svNummer: Rule = (v) =>
  /^\d{8}[A-Z]\d{3}$/u.test(v) ? null : 'a Sozialversicherungsnummer looks like 65170839J003';

/*
 * PAN: five letters, four digits, a letter.
 *
 * The fourth letter is the holder's type — P for a person — but any letter is
 * accepted: a contractor may quote a firm's or a company's PAN, and the set of
 * type codes has grown before. The last letter is a check character whose
 * algorithm the Income Tax Department does not publish, so it is not checked.
 */
const pan: Rule = (v) => (/^[A-Z]{5}\d{4}[A-Z]$/u.test(v) ? null : 'a PAN looks like ABCPD1234E');

/* Universal Account Number (EPF). Shape only; no public check digit. */
const uan: Rule = (v) => (/^\d{12}$/u.test(v) ? null : 'a UAN is twelve digits');

/**
 * Social Security number, refusing only what SSA says it never issues: area
 * 000, 666 or 900–999, group 00, serial 0000. Randomised issuance since 2011
 * means nothing else about the digits is meaningful.
 */
const ssn: Rule = (v) => {
  if (!/^\d{9}$/u.test(v)) return 'an SSN is nine digits';
  const area = v.slice(0, 3);
  if (area === '000' || area === '666' || area.startsWith('9')) return 'that SSN area is never issued';
  if (v.slice(3, 5) === '00' || v.slice(5) === '0000') return 'that SSN is never issued';
  return null;
};

const RULES: Readonly<Record<string, Readonly<Record<string, Rule>>>> = {
  ES: { nif, naf },
  GB: { nino },
  DE: { steuer_id: steuerId, sv_nummer: svNummer },
  IN: { pan, uan },
  US: { ssn },
};

/** Whether a real rule, rather than a length check, stands behind a scheme. */
export function hasRule(country: string, scheme: string): boolean {
  return RULES[country.toUpperCase()]?.[scheme] !== undefined;
}

/** The longest identifier accepted where there is no rule, matching the scheme's own bound. */
const LENGTH_ONLY_MAX = 32;

export function checkNationalId(country: string, scheme: string, raw: string): Result<NationalIdCheck> {
  const normalised = raw.toUpperCase().replaceAll(/[\s.\-/]/gu, '');
  const rule = RULES[country.toUpperCase()]?.[scheme];

  if (rule === undefined) {
    if (normalised.length === 0 || normalised.length > LENGTH_ONLY_MAX) {
      return err(failure('NATIONAL_ID_INVALID', `an identifier is 1 to ${String(LENGTH_ONLY_MAX)} characters`));
    }
    return ok({ normalised, checked: 'length_only' });
  }

  const problem = rule(normalised);
  return problem === null
    ? ok({ normalised, checked: 'rule' })
    : err(failure('NATIONAL_ID_INVALID', problem));
}
