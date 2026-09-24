import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * A national identifier, judged against its country's published rules (PRD
 * §6.4, PEO-125).
 *
 * Pure: no clock, no I/O. A `national_id` attribute carries a country and a
 * scheme in its `typeConfig`, and this is what those two name.
 *
 * **Strict findings, never a hard block.** Every rule here is the strictest
 * one published, and none of them refuses a value. A value that cannot be the
 * identifier at all — the wrong length or characters once the spacing people
 * type is removed — is refused as invalid input. Anything else is accepted
 * with findings: `ok`, `attention` (it matches the national format, but a
 * person should look — a company's PAN, a National Insurance number with no
 * suffix) or `mismatch` (it has the shape, and a published rule says it is
 * wrong — a control letter that does not compute). A value with an
 * `attention` or `mismatch` finding goes to HR's review queue (§8.4), and
 * whatever the reviewer decides is final.
 *
 * Why not refuse a mismatch: a validator that rejects a real employee's real
 * identifier stops their payroll, and the one thing worse than a typo in a
 * NIF is a person who cannot be paid because our rule was wrong.
 *
 * **A message never repeats the value.** Findings are stored on the review
 * record and travel on the audit event by code; neither may hold the
 * identifier.
 */

export type FindingLevel = 'ok' | 'attention' | 'mismatch';

export interface IdentifierFinding {
  readonly level: FindingLevel;
  /** Stable, for a client to key on: `check_mismatch`, `holder_not_person`, … */
  readonly code: string;
  /** For a person: what the check found. Never the value. */
  readonly message: string;
}

export interface NationalIdCheck {
  /** Uppercase, with the spaces, dots, dashes and slashes people type removed. */
  readonly normalised: string;
  /** `length_only` when no rule exists for the scheme: accepted, not vouched for. */
  readonly checked: 'rule' | 'length_only';
  /** At least one; every one `ok` unless something needs a person to look. */
  readonly findings: readonly IdentifierFinding[];
}

/** Whether a reviewer must look: anything worse than `ok`. */
export function needsReview(findings: readonly IdentifierFinding[]): boolean {
  return findings.some((f) => f.level !== 'ok');
}

/** A rule: why the value cannot be the identifier at all, or its findings. */
type Rule = (value: string) => { readonly refuse: string } | readonly IdentifierFinding[];

const finding = (level: FindingLevel, code: string, message: string): IdentifierFinding => ({
  level,
  code,
  message,
});

const CHECK_OK = finding('ok', 'check_ok', 'Matches the national format and its check computes.');
const checkMismatch = (what: string) =>
  finding(
    'mismatch',
    'check_mismatch',
    `Matches the national format, but ${what} does not compute.`,
  );
const unverifiable = (why: string) =>
  finding(
    'ok',
    'check_unavailable',
    `Matches the national format. Cannot be verified further: ${why}.`,
  );

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/**
 * NIF of a natural person: a DNI, a NIE, or a K/L/M NIF.
 *
 * All three end in the same mod-23 control letter. A NIE's X, Y or Z stands
 * for 0, 1 or 2 in front of the digits; a K, L or M NIF is computed over its
 * seven digits alone. A company's CIF (a letter, seven digits, a control) is
 * accepted as needing attention: an employee is never a company, but a
 * contractor quoting one is a person's mistake to look at, not to refuse.
 */
const nif: Rule = (v) => {
  if (!/^[A-Z0-9]{9}$/u.test(v))
    return { refuse: 'a NIF is nine letters and digits, such as 12345678Z or X1234567L' };
  let digits: string;
  if (/^\d{8}[A-Z]$/u.test(v)) digits = v.slice(0, 8);
  else if (/^[XYZ]\d{7}[A-Z]$/u.test(v)) digits = String('XYZ'.indexOf(v[0] ?? '')) + v.slice(1, 8);
  else if (/^[KLM]\d{7}[A-Z]$/u.test(v)) digits = v.slice(1, 8);
  else if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/u.test(v)) {
    return [
      finding(
        'attention',
        'holder_not_person',
        'Matches the format of a company’s tax number (CIF), not a person’s NIF or NIE.',
      ),
    ];
  } else {
    return [
      finding('mismatch', 'format_mismatch', 'Does not match the DNI, NIE or personal NIF format.'),
    ];
  }
  return DNI_LETTERS[Number(digits) % 23] === v.at(-1)
    ? [CHECK_OK]
    : [checkMismatch('the control letter')];
};

/**
 * Número de afiliación a la Seguridad Social: a two-digit province, an
 * eight-digit number and two control digits, per the TGSS mod-97 rule.
 *
 * The short-number case: when the number is under 10,000,000 the control is
 * computed over province × 10⁷ + number, not the twelve digits as written;
 * otherwise over province × 10⁸ + number.
 */
const naf: Rule = (v) => {
  if (!/^\d{12}$/u.test(v)) return { refuse: 'a Social Security number is twelve digits' };
  const province = Number(v.slice(0, 2));
  const number = Number(v.slice(2, 10));
  const base =
    number < 10_000_000 ? province * 10_000_000 + number : province * 100_000_000 + number;
  return base % 97 === Number(v.slice(10)) ? [CHECK_OK] : [checkMismatch('the control digits')];
};

/**
 * National Insurance number, per HMRC's allocation rules (NIM39110).
 *
 * First letter never D, F, I, Q, U or V; second never those or O; seven
 * prefix pairs are never allocated. The suffix is A to D. HMRC's RTI schema
 * allows it blank, so a missing one is accepted — and flagged, because the
 * number on the person's card always has one.
 */
const NINO_PREFIX = /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]$/u;
const NINO_NEVER = new Set(['BG', 'GB', 'KN', 'NK', 'NT', 'TN', 'ZZ']);
const nino: Rule = (v) => {
  if (!/^[A-Z]{2}\d{6}[A-Z]?$/u.test(v)) {
    return { refuse: 'a National Insurance number is two letters, six digits and a letter' };
  }
  const prefix = v.slice(0, 2);
  if (!NINO_PREFIX.test(prefix) || NINO_NEVER.has(prefix)) {
    return [
      finding(
        'mismatch',
        'prefix_not_issued',
        'Has the shape of a National Insurance number, but HMRC never issues that prefix.',
      ),
    ];
  }
  if (v.length === 8) {
    return [
      finding(
        'attention',
        'suffix_missing',
        'Matches the national format, but the final letter (A, B, C or D) is missing.',
      ),
    ];
  }
  if (!/[A-D]$/u.test(v)) {
    return [
      finding(
        'mismatch',
        'suffix_invalid',
        'Has the shape of a National Insurance number, but the final letter is always A, B, C or D.',
      ),
    ];
  }
  // A NINO carries no check character: the prefix and suffix are all there is.
  return [
    finding(
      'ok',
      'format_ok',
      'Matches HMRC’s allocation rules. National Insurance numbers carry no check digit.',
    ),
  ];
};

/**
 * Steuerliche Identifikationsnummer: eleven digits, no leading zero, an ISO
 * 7064 MOD 11,10 check digit, and the digit-occurrence rule over the first
 * ten.
 *
 * Both variants are accepted: before 2016 exactly one digit appears twice;
 * from 2016 exactly one digit appears twice or three times, and three are
 * never all adjacent. Every other digit appears at most once.
 */
const steuerId: Rule = (v) => {
  if (!/^[1-9]\d{10}$/u.test(v))
    return { refuse: 'a Steuer-ID is eleven digits, never starting with 0' };
  const findings: IdentifierFinding[] = [];

  const counts = new Map<string, number>();
  for (const d of v.slice(0, 10)) counts.set(d, (counts.get(d) ?? 0) + 1);
  const repeated = [...counts.entries()].filter(([, n]) => n > 1);
  const [digit, times] = repeated[0] ?? ['', 0];
  const patternOk =
    repeated.length === 1 &&
    (times === 2 || (times === 3 && !v.slice(0, 10).includes(digit.repeat(3))));
  if (!patternOk) {
    findings.push(
      finding(
        'mismatch',
        'digit_pattern',
        'Has the shape of a Steuer-ID, but its digits repeat in a way no issued number does.',
      ),
    );
  }

  let product = 10;
  for (const d of v.slice(0, 10)) {
    const sum = (Number(d) + product) % 10 || 10;
    product = (sum * 2) % 11;
  }
  if ((11 - product) % 10 !== Number(v[10])) findings.push(checkMismatch('the check digit'));
  return findings.length === 0 ? [CHECK_OK] : findings;
};

/**
 * Sozialversicherungsnummer (Rentenversicherungsnummer): area, birth date
 * DDMMYY, the initial of the birth name, a two-digit serial, a check digit.
 *
 * The check: the letter becomes its two-digit alphabet position (A = 01), the
 * twelve digits before the check are weighted 2 1 2 5 7 1 2 1 2 1 2 1, the
 * digit sums of the products are added, and the total mod 10 is the check.
 * A birth date that is not a calendar day asks for attention rather than a
 * mismatch: the Rentenversicherung does issue numbers with an adjusted date
 * when a day's serials run out.
 */
const SV_WEIGHTS = [2, 1, 2, 5, 7, 1, 2, 1, 2, 1, 2, 1] as const;
const svNummer: Rule = (v) => {
  if (!/^\d{8}[A-Z]\d{3}$/u.test(v))
    return { refuse: 'a Sozialversicherungsnummer looks like 65170839J003' };
  const findings: IdentifierFinding[] = [];

  const day = Number(v.slice(2, 4));
  const month = Number(v.slice(4, 6));
  if (day < 1 || day > 31 || month < 1 || month > 12) {
    findings.push(
      finding(
        'attention',
        'birth_date_invalid',
        'Matches the national format, but its birth-date part is not a calendar date.',
      ),
    );
  }

  const letter = String(v.charCodeAt(8) - 64).padStart(2, '0');
  const digits = v.slice(0, 8) + letter + v.slice(9, 11);
  let total = 0;
  SV_WEIGHTS.forEach((w, i) => {
    const product = Number(digits[i]) * w;
    total += Math.floor(product / 10) + (product % 10);
  });
  if (total % 10 !== Number(v[11])) findings.push(checkMismatch('the check digit'));
  return findings.length === 0 ? [CHECK_OK] : findings;
};

/**
 * PAN: five letters, four digits, a letter.
 *
 * The fourth letter is the holder's type, from the Income Tax Department's
 * closed list: P person, C company, H Hindu undivided family, F firm, A
 * association of persons, T trust, B body of individuals, L local authority,
 * J artificial juridical person, G government. An employee is P; any other
 * listed code asks for attention (a contractor quoting their firm's PAN), and
 * a letter outside the list is a mismatch.
 *
 * The tenth character is a check letter whose algorithm the department has
 * never published, so it is **not checked** and the finding says so. No
 * algorithm is invented here.
 */
const PAN_HOLDERS: Readonly<Record<string, string>> = {
  C: 'a company',
  H: 'a Hindu undivided family',
  F: 'a firm',
  A: 'an association of persons',
  T: 'a trust',
  B: 'a body of individuals',
  L: 'a local authority',
  J: 'an artificial juridical person',
  G: 'a government body',
};
const pan: Rule = (v) => {
  if (!/^[A-Z]{5}\d{4}[A-Z]$/u.test(v)) return { refuse: 'a PAN looks like ABCPD1234E' };
  const holder = v[3] ?? '';
  const unverified = unverifiable(
    'the Income Tax Department does not publish the PAN check letter',
  );
  if (holder === 'P') return [unverified];
  const who = PAN_HOLDERS[holder];
  return who === undefined
    ? [
        finding(
          'mismatch',
          'holder_unknown',
          'Has the shape of a PAN, but its fourth letter is not a holder type the Income Tax Department issues.',
        ),
        unverified,
      ]
    : [
        finding(
          'attention',
          'holder_not_person',
          `Valid shape, but the holder-type letter says ${who}, not a person.`,
        ),
        unverified,
      ];
};

/* Universal Account Number (EPF): twelve digits. EPFO publishes no check digit. */
const uan: Rule = (v) =>
  /^\d{12}$/u.test(v)
    ? [unverifiable('EPFO publishes no check digit for the UAN')]
    : { refuse: 'a UAN is twelve digits' };

/**
 * Social Security number: SSA never issues area 000, 666 or 900–999, group 00
 * or serial 0000. Randomised issuance since 2011 means nothing else about the
 * digits is meaningful, and there is no check digit.
 */
const ssn: Rule = (v) => {
  if (!/^\d{9}$/u.test(v)) return { refuse: 'an SSN is nine digits' };
  const area = v.slice(0, 3);
  if (
    area === '000' ||
    area === '666' ||
    area.startsWith('9') ||
    v.slice(3, 5) === '00' ||
    v.slice(5) === '0000'
  ) {
    return [
      finding(
        'mismatch',
        'not_issued',
        'Has the shape of an SSN, but the Social Security Administration never issues that number.',
      ),
    ];
  }
  return [finding('ok', 'format_ok', 'Matches SSA’s issuing rules. SSNs carry no check digit.')];
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

export function normaliseNationalId(raw: string): string {
  return raw.toUpperCase().replaceAll(/[\s.\-/]/gu, '');
}

export function checkNationalId(
  country: string,
  scheme: string,
  raw: string,
): Result<NationalIdCheck> {
  const normalised = normaliseNationalId(raw);
  const rule = RULES[country.toUpperCase()]?.[scheme];

  if (rule === undefined) {
    if (normalised.length === 0 || normalised.length > LENGTH_ONLY_MAX) {
      return err(
        failure(
          'NATIONAL_ID_INVALID',
          `an identifier is 1 to ${String(LENGTH_ONLY_MAX)} characters`,
        ),
      );
    }
    return ok({
      normalised,
      checked: 'length_only',
      findings: [unverifiable('there is no rule for this scheme yet')],
    });
  }

  const judged = rule(normalised);
  return 'refuse' in judged
    ? err(failure('NATIONAL_ID_INVALID', judged.refuse))
    : ok({ normalised, checked: 'rule', findings: judged });
}
