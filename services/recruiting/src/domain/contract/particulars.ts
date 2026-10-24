import { Decimal } from 'decimal.js';
import type { CalendarDate, LaunchCountry, ResolvedTerms, TermLength } from '@kithena/contracts';

/**
 * What the law of the employing entity says a written contract must state
 * (Recruiting PRD §21.1): the statutory particulars, each with the law that
 * asks for it and its value from the accepted offer, or null where nothing
 * Kithena holds says it — a registered address, a pay day, a sick-pay
 * scheme — for the person sending the contract to fill in.
 *
 * Pure data and pure functions, as the terms packs are. The drafter writes
 * the contract around these; the domain, not a model, answers for every
 * value, and `contractFigures` shows any figure the draft has that no
 * particular gave, before anything is sent.
 */

export interface ContractFacts {
  readonly employer: { readonly name: string; readonly address: string | null };
  readonly employee: { readonly name: string; readonly address: string | null };
  readonly role: string;
  readonly placeOfWork: string | null;
  readonly terms: ResolvedTerms;
  readonly pay: {
    readonly baseMinor: number;
    readonly currency: string;
    readonly frequency: 'year' | 'month' | 'hour';
    readonly variableTargetMinor: number;
    readonly signOnMinor: number;
    readonly relocationMinor: number;
  };
  readonly benefits: readonly string[];
  readonly startDate: CalendarDate;
  /** US: exempt from overtime under the FLSA; null where it was not asked. */
  readonly overtimeExempt: boolean | null;
}

export type ParticularKey =
  | 'parties'
  | 'employer_address'
  | 'employee_address'
  | 'start'
  | 'continuous_employment'
  | 'end'
  | 'role'
  | 'place_of_work'
  | 'contract_type'
  | 'pay'
  | 'pay_timing'
  | 'variable_pay'
  | 'hours'
  | 'overtime'
  | 'holiday'
  | 'sick_pay'
  | 'benefits'
  | 'pension'
  | 'probation'
  | 'notice'
  | 'dismissal_procedure'
  | 'training'
  | 'disciplinary'
  | 'collective_agreement'
  | 'at_will'
  | 'overtime_status'
  | 'conditions'
  | 'non_compete'
  | 'governing_law';

export interface Particular {
  readonly key: ParticularKey;
  /** The statute and section that asks for it. */
  readonly law: string;
  /** What the contract says, from what Kithena holds; null for the sender to fill in. */
  readonly value: string | null;
}

/** Minor units as a decimal with two places, never through a float. */
const amount = (minor: number, currency: string): string =>
  `${new Decimal(minor).div(100).toFixed(2)} ${currency}`;

const lengthOf = (l: TermLength | null): string | null =>
  l === null ? null : `${String(l.count)} ${l.count === 1 ? l.unit.replace(/s$/u, '') : l.unit}`;

const hoursOf = (terms: ResolvedTerms): string => {
  const hours = new Decimal(terms.weeklyMinutes).div(60).toDecimalPlaces(2).toString();
  const mode =
    terms.workMode === 'onsite'
      ? 'on site'
      : terms.workMode === 'remote'
        ? 'remote'
        : `hybrid, ${String(terms.hybridDaysOnsite ?? 0)} days a week on site`;
  return `${hours} hours a week (FTE ${terms.fte}), ${mode}`;
};

/** The statutory minimum holiday, for a contract that names no more. */
const HOLIDAY: Readonly<
  Record<LaunchCountry, { readonly law: string; readonly value: string | null }>
> = {
  GB: {
    law: 'Working Time Regulations 1998, regs. 13 and 13A',
    value: 'at least 5.6 weeks a year (28 days for a five-day week), pro rata',
  },
  DE: {
    law: '§ 3 BUrlG; § 2(1) no. 8 NachwG',
    value: 'at least 20 working days a year for a five-day week (24 Werktage), pro rata',
  },
  ES: { law: 'art. 38 Estatuto de los Trabajadores', value: 'at least 30 calendar days a year' },
  IN: { law: 'the state Shops and Establishments Act', value: null },
  US: { law: 'company policy; no federal minimum', value: null },
};

const law = (country: LaunchCountry, section: Readonly<Partial<Record<LaunchCountry, string>>>) =>
  section[country] ?? '';

export function particularsFor(facts: ContractFacts): Particular[] {
  const { terms, pay } = facts;
  const c = terms.country;
  const statement: Readonly<Record<LaunchCountry, string>> = {
    GB: 'Employment Rights Act 1996, s. 1',
    DE: '§ 2(1) NachwG',
    ES: 'art. 8.5 Estatuto de los Trabajadores; RD 1659/1998',
    IN: 'Industrial Employment (Standing Orders) Act 1946; state Shops and Establishments Act',
    US: 'state wage-notice law (NY Labor Law § 195.1, Cal. Labor Code § 2810.5)',
  };
  const s = statement[c];
  const out: (Particular | null)[] = [
    {
      key: 'parties',
      law: s,
      value: `${facts.employer.name} (employer) and ${facts.employee.name} (employee)`,
    },
    c === 'DE' || c === 'ES' || c === 'GB'
      ? { key: 'employer_address', law: s, value: facts.employer.address }
      : null,
    c === 'DE' || c === 'ES'
      ? { key: 'employee_address', law: s, value: facts.employee.address }
      : null,
    { key: 'start', law: s, value: facts.startDate },
    c === 'GB' ? { key: 'continuous_employment', law: s, value: facts.startDate } : null,
    terms.contractEnd === null
      ? null
      : {
          key: 'end',
          law:
            law(c, {
              DE: '§ 2(1) no. 3 NachwG; § 14(4) TzBfG',
              ES: 'art. 15 Estatuto de los Trabajadores',
              GB: 'Employment Rights Act 1996, s. 1(4)(g)',
            }) || s,
          value: terms.contractEnd,
        },
    { key: 'role', law: s, value: facts.role },
    { key: 'place_of_work', law: s, value: facts.placeOfWork },
    { key: 'contract_type', law: s, value: `${terms.contractType} (${terms.employmentType})` },
    {
      key: 'pay',
      law:
        c === 'US'
          ? 'Fair Labor Standards Act; state wage-notice law'
          : c === 'DE'
            ? '§ 2(1) no. 7 NachwG'
            : s,
      value: `${amount(pay.baseMinor, pay.currency)} a ${pay.frequency}, paid in ${String(terms.paymentsPerYear)} payments`,
    },
    c === 'US' || c === 'DE' || c === 'GB'
      ? { key: 'pay_timing', law: c === 'DE' ? '§ 2(1) no. 7 NachwG' : s, value: null }
      : null,
    pay.variableTargetMinor > 0 || pay.signOnMinor > 0 || pay.relocationMinor > 0
      ? {
          key: 'variable_pay',
          law: s,
          value: [
            pay.variableTargetMinor > 0
              ? `variable pay at target ${amount(pay.variableTargetMinor, pay.currency)} a year`
              : null,
            pay.signOnMinor > 0 ? `signing bonus ${amount(pay.signOnMinor, pay.currency)}` : null,
            pay.relocationMinor > 0
              ? `relocation ${amount(pay.relocationMinor, pay.currency)}`
              : null,
          ]
            .filter((x) => x !== null)
            .join('; '),
        }
      : null,
    { key: 'hours', law: c === 'DE' ? '§ 2(1) no. 9 NachwG' : s, value: hoursOf(terms) },
    c === 'DE' ? { key: 'overtime', law: '§ 2(1) no. 11 NachwG', value: null } : null,
    { key: 'holiday', law: HOLIDAY[c].law, value: HOLIDAY[c].value },
    c === 'GB'
      ? { key: 'sick_pay', law: 'Employment Rights Act 1996, s. 1(4)(d)(ii)', value: null }
      : null,
    {
      key: 'benefits',
      law: s,
      value:
        facts.benefits.length === 0 ? 'none beyond those the law gives' : facts.benefits.join(', '),
    },
    c === 'GB' || c === 'DE'
      ? {
          key: 'pension',
          law: c === 'GB' ? 'Pensions Act 2008 (auto-enrolment)' : '§ 2(1) no. 13 NachwG',
          value: null,
        }
      : null,
    terms.probation === null
      ? null
      : {
          key: 'probation',
          law:
            law(c, {
              DE: '§ 2(1) no. 6 NachwG; § 622(3) BGB',
              ES: 'art. 14 Estatuto de los Trabajadores',
              GB: 'Employment Rights Act 1996, s. 1(4)(da)',
            }) || s,
          value: `${lengthOf(terms.probation) ?? ''}${terms.probationEnd === null ? '' : `, ending ${terms.probationEnd}`}`,
        },
    {
      key: 'notice',
      law:
        law(c, {
          DE: '§ 622 BGB; § 2(1) no. 14 NachwG',
          ES: 'art. 49 Estatuto de los Trabajadores',
          GB: 'Employment Rights Act 1996, ss. 1(4)(e), 86',
        }) || s,
      value: `${lengthOf(terms.noticeEmployee) ?? ''} by the employee, ${lengthOf(terms.noticeEmployer) ?? ''} by the employer`,
    },
    c === 'DE'
      ? {
          key: 'dismissal_procedure',
          law: '§ 2(1) no. 14 NachwG',
          value:
            'notice in writing (§ 623 BGB), the notice periods above, and three weeks from receipt to bring an unfair-dismissal claim (§ 4 KSchG)',
        }
      : null,
    c === 'GB' || c === 'DE'
      ? {
          key: 'training',
          law: c === 'GB' ? 'Employment Rights Act 1996, s. 1(4)(db)' : '§ 2(1) no. 12 NachwG',
          value: null,
        }
      : null,
    c === 'GB'
      ? { key: 'disciplinary', law: 'Employment Rights Act 1996, s. 3', value: null }
      : null,
    terms.collectiveAgreement === null
      ? c === 'GB' || c === 'DE' || c === 'ES'
        ? { key: 'collective_agreement', law: s, value: 'none' }
        : null
      : {
          key: 'collective_agreement',
          law: s,
          value: `${terms.collectiveAgreement.key}${terms.collectiveAgreement.group === null ? '' : `, group ${terms.collectiveAgreement.group}`}`,
        },
    c === 'US' && terms.contractType.startsWith('at_will')
      ? {
          key: 'at_will',
          law: 'common law; state at-will doctrine',
          value:
            'employment is at will: either party may end it at any time, with or without cause or notice',
        }
      : null,
    c === 'US'
      ? {
          key: 'overtime_status',
          law: 'Fair Labor Standards Act, 29 U.S.C. § 213',
          value:
            facts.overtimeExempt === null
              ? null
              : facts.overtimeExempt
                ? 'exempt (FLSA)'
                : 'non-exempt (FLSA): overtime paid at 1.5 times the regular rate',
        }
      : null,
    terms.nonCompeteMonths === null || terms.nonCompeteMonths === 0
      ? null
      : {
          key: 'non_compete',
          law: law(c, { DE: '§§ 74–75d HGB', ES: 'art. 21.2 Estatuto de los Trabajadores' }) || s,
          value: `${String(terms.nonCompeteMonths)} months after the employment ends`,
        },
    terms.conditions.length === 0
      ? null
      : { key: 'conditions', law: s, value: terms.conditions.join(', ').replaceAll('_', ' ') },
    {
      key: 'governing_law',
      law: s,
      value: `the law of ${c}${terms.region === null ? '' : ` (${terms.region})`}`,
    },
  ];
  return out.filter((p): p is Particular => p !== null);
}

/** What a draft still asks a person to confirm: each `[[TO CONFIRM: …]]`, in order. */
export function toConfirm(draft: string): string[] {
  return Array.from(draft.matchAll(/\[\[TO CONFIRM:\s*([^\]]+?)\s*\]\]/gu), (m) => m[1] ?? '');
}

const FIGURE = /\d+(?:[.,]\d+)*/gu;
const figures = (text: string): string[] =>
  Array.from(text.matchAll(FIGURE), (m) => m[0].replaceAll(',', ''));

/**
 * Figures in a draft that no particular gave, each once: `65,000.00` and
 * `65000.00` are one figure. Clause numbers and years a date already gave are
 * known; anything else is for the sender to check before it goes.
 */
export function contractFigures(draft: string, particulars: readonly Particular[]): string[] {
  const said = particulars.map((p) => `${p.value ?? ''} ${p.law}`).join(' ');
  const known = new Set([...figures(said), ...figures(said).flatMap((f) => f.split(/[.-]/u))]);
  return [...new Set(figures(draft))].filter((f) => !known.has(f) && !/^\d{1,2}$/u.test(f));
}
