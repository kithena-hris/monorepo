/**
 * The employment contract's text, from an accepted offer (Recruiting PRD
 * §21.1): the parties, the role, the start, the pay, the benefits, the
 * working pattern, the probation and notice periods, and the documents the
 * country's pack requires beside it. Plain paragraphs: Documents draws them
 * as a PDF and places the signatures (`fileDraft`).
 *
 * Reads Recruiting's offer screen as JSON (`RecruitingOffer`), so a field it
 * does not find is left out rather than refused: a contract with one fewer
 * line is still the contract the candidate accepted, hash and all.
 */

import type { T } from '@reach/ui';

interface Length {
  readonly count: number;
  readonly unit: string;
}

interface Offer {
  readonly offer: {
    readonly versions: readonly {
      readonly version: number;
      readonly terms: Readonly<Record<string, unknown>>;
      readonly pay: {
        readonly baseMinor: number;
        readonly currency: string;
        readonly frequency: 'year' | 'month' | 'hour';
        readonly variableTargetMinor: number;
        readonly signOnMinor: number;
        readonly relocationMinor: number;
      };
      readonly benefitIds: readonly string[];
      readonly startDate: string;
    }[];
    readonly acceptance: { readonly version: number; readonly versionHash: string } | null;
  };
  readonly candidate: { readonly name: string };
  readonly job: { readonly title: string };
  readonly checked: {
    readonly terms: {
      readonly contractType: string;
      readonly employmentType: string;
      readonly weeklyMinutes: number;
      readonly fte: string;
      readonly documents: readonly string[];
    } | null;
  } | null;
  readonly benefits: readonly {
    readonly id: string;
    readonly names: Readonly<Record<string, string>>;
  }[];
}

/** A term's key in words: the known ones translated, a country pack's own name as written. */
function words(key: string, t: T): string {
  switch (key) {
    case 'permanent':
      return t('lib.contract-text.permanent', 'permanent');
    case 'fixed_term':
      return t('lib.contract-text.fixed_term', 'fixed term');
    case 'contractor':
      return t('lib.contract-text.contractor', 'contractor');
    case 'full_time':
      return t('lib.contract-text.full_time', 'full time');
    case 'part_time':
      return t('lib.contract-text.part_time', 'part time');
    case 'onsite':
      return t('lib.contract-text.on_site', 'on site');
    case 'hybrid':
      return t('lib.contract-text.hybrid', 'hybrid');
    case 'remote':
      return t('lib.contract-text.remote', 'remote');
    default:
      return key.replaceAll('_', ' ');
  }
}

const money = (minor: number, currency: string, language: string): string =>
  new Intl.NumberFormat(language, { style: 'currency', currency, minimumFractionDigits: 2 }).format(
    minor / 100,
  );

function length(l: unknown, t: T): string | null {
  if (typeof l !== 'object' || l === null || !('count' in l) || !('unit' in l)) return null;
  const { count, unit } = l as Length;
  switch (unit) {
    case 'days':
      return t(
        'lib.contract-text.days',
        { one: '{{count}} day', other: '{{count}} days' },
        { count },
      );
    case 'weeks':
      return t(
        'lib.contract-text.weeks',
        { one: '{{count}} week', other: '{{count}} weeks' },
        { count },
      );
    case 'months':
      return t(
        'lib.contract-text.months',
        { one: '{{count}} month', other: '{{count}} months' },
        { count },
      );
    default:
      return `${String(count)} ${unit}`;
  }
}

function hours(minutes: number, t: T): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const whole = t(
    'lib.contract-text.hours',
    { one: '{{count}} hour', other: '{{count}} hours' },
    { count: h },
  );
  return m === 0
    ? whole
    : t('lib.contract-text.hours_and_minutes', '{{hours}} {{minutes}}', {
        hours: whole,
        minutes: t(
          'lib.contract-text.minutes',
          { one: '{{count}} minute', other: '{{count}} minutes' },
          {
            count: m,
          },
        ),
      });
}

/** The version the candidate accepted; the latest when the screen has no acceptance yet. */
function accepted(o: Offer) {
  const n = o.offer.acceptance?.version;
  return o.offer.versions.find((v) => v.version === n) ?? o.offer.versions.at(-1) ?? null;
}

/**
 * The words are the company's language (`t`, `language`), not the reader's:
 * the contract is the company's document, whoever presses the button.
 */
export function contractTitle(o: Offer, t: T): string {
  return t('lib.contract-text.employment_contract', 'Employment contract – {{name}}', {
    name: o.candidate.name,
  });
}

export function contractText(o: Offer, companyName: string, t: T, language = 'en-US'): string {
  const v = accepted(o);
  const checked = o.checked?.terms ?? null;
  const name = o.candidate.name;
  if (v === null)
    return t('lib.contract-text.engages_as', '{{company}} engages {{name}} as {{role}}.', {
      company: companyName,
      name,
      role: o.job.title,
    });
  const terms = v.terms;
  const pay = money(v.pay.baseMinor, v.pay.currency, language);
  const payments = typeof terms['paymentsPerYear'] === 'number' ? terms['paymentsPerYear'] : null;
  const lines: (string | null)[] = [
    t(
      'lib.contract-text.this_contract_is_between',
      'This contract is between {{company}} (the employer) and {{name}} (the employee).',
      { company: companyName, name },
    ),
    t('lib.contract-text.role', 'Role: {{role}}.', { role: o.job.title }),
    checked === null
      ? null
      : typeof terms['contractEnd'] === 'string'
        ? t(
            'lib.contract-text.contract_ending',
            'Contract: {{contract}}, {{employment}}, ending {{end}}.',
            {
              contract: words(checked.contractType, t),
              employment: words(checked.employmentType, t),
              end: terms['contractEnd'],
            },
          )
        : t('lib.contract-text.contract', 'Contract: {{contract}}, {{employment}}.', {
            contract: words(checked.contractType, t),
            employment: words(checked.employmentType, t),
          }),
    t('lib.contract-text.start_date', 'Start date: {{date}}.', { date: v.startDate }),
    payments === null
      ? v.pay.frequency === 'year'
        ? t('lib.contract-text.pay_a_year', 'Pay: {{pay}} a year.', { pay })
        : v.pay.frequency === 'month'
          ? t('lib.contract-text.pay_a_month', 'Pay: {{pay}} a month.', { pay })
          : t('lib.contract-text.pay_an_hour', 'Pay: {{pay}} an hour.', { pay })
      : v.pay.frequency === 'year'
        ? t(
            'lib.contract-text.pay_a_year_in_payments',
            'Pay: {{pay}} a year, paid in {{payments}} payments a year.',
            {
              pay,
              payments: String(payments),
            },
          )
        : v.pay.frequency === 'month'
          ? t(
              'lib.contract-text.pay_a_month_in_payments',
              'Pay: {{pay}} a month, paid in {{payments}} payments a year.',
              {
                pay,
                payments: String(payments),
              },
            )
          : t(
              'lib.contract-text.pay_an_hour_in_payments',
              'Pay: {{pay}} an hour, paid in {{payments}} payments a year.',
              {
                pay,
                payments: String(payments),
              },
            ),
    v.pay.variableTargetMinor > 0
      ? t('lib.contract-text.variable_pay_at_target', 'Variable pay at target: {{pay}} a year.', {
          pay: money(v.pay.variableTargetMinor, v.pay.currency, language),
        })
      : null,
    v.pay.signOnMinor > 0
      ? t('lib.contract-text.signing_bonus', 'Signing bonus: {{pay}}.', {
          pay: money(v.pay.signOnMinor, v.pay.currency, language),
        })
      : null,
    v.pay.relocationMinor > 0
      ? t('lib.contract-text.relocation', 'Relocation: {{pay}}.', {
          pay: money(v.pay.relocationMinor, v.pay.currency, language),
        })
      : null,
    checked === null
      ? null
      : typeof terms['workMode'] !== 'string'
        ? t('lib.contract-text.working_time', 'Working time: {{hours}} a week ({{fte}} FTE).', {
            hours: hours(checked.weeklyMinutes, t),
            fte: checked.fte,
          })
        : typeof terms['hybridDaysOnsite'] === 'number'
          ? t(
              'lib.contract-text.working_time_mode_days',
              {
                one: 'Working time: {{hours}} a week ({{fte}} FTE), {{mode}} with {{count}} day on site.',
                other:
                  'Working time: {{hours}} a week ({{fte}} FTE), {{mode}} with {{count}} days on site.',
              },
              {
                hours: hours(checked.weeklyMinutes, t),
                fte: checked.fte,
                mode: words(terms['workMode'], t),
                count: terms['hybridDaysOnsite'],
              },
            )
          : t(
              'lib.contract-text.working_time_mode',
              'Working time: {{hours}} a week ({{fte}} FTE), {{mode}}.',
              {
                hours: hours(checked.weeklyMinutes, t),
                fte: checked.fte,
                mode: words(terms['workMode'], t),
              },
            ),
    length(terms['probation'], t) === null
      ? t('lib.contract-text.probation_none', 'Probation: none.')
      : t('lib.contract-text.probation', 'Probation: {{length}}.', {
          length: length(terms['probation'], t) ?? '',
        }),
    length(terms['noticeEmployee'], t) === null || length(terms['noticeEmployer'], t) === null
      ? null
      : t(
          'lib.contract-text.notice',
          'Notice: {{employee}} by the employee, {{employer}} by the employer.',
          {
            employee: length(terms['noticeEmployee'], t) ?? '',
            employer: length(terms['noticeEmployer'], t) ?? '',
          },
        ),
    typeof terms['nonCompeteMonths'] === 'number' && terms['nonCompeteMonths'] > 0
      ? typeof terms['nonCompeteCompensationPercent'] === 'number'
        ? t(
            'lib.contract-text.non_compete_compensated',
            {
              one: 'Non-compete: {{count}} month after the employment ends, compensated at {{percent}} of pay.',
              other:
                'Non-compete: {{count}} months after the employment ends, compensated at {{percent}} of pay.',
            },
            {
              count: terms['nonCompeteMonths'],
              percent: new Intl.NumberFormat(language, { style: 'percent' }).format(
                terms['nonCompeteCompensationPercent'] / 100,
              ),
            },
          )
        : t(
            'lib.contract-text.non_compete',
            {
              one: 'Non-compete: {{count}} month after the employment ends.',
              other: 'Non-compete: {{count}} months after the employment ends.',
            },
            { count: terms['nonCompeteMonths'] },
          )
      : null,
    terms['mobilityClause'] === true
      ? t(
          'lib.contract-text.mobility',
          'Mobility: the employee may be asked to work from another of the employer’s locations.',
        )
      : null,
    v.benefitIds.length === 0
      ? null
      : t('lib.contract-text.benefits', 'Benefits: {{benefits}}.', {
          benefits: new Intl.ListFormat(language, { type: 'unit', style: 'short' }).format(
            v.benefitIds.map((id) => {
              const b = o.benefits.find((x) => x.id === id);
              return b === undefined
                ? words(id.replace(/^statutory:/u, ''), t)
                : (b.names[language] ??
                    b.names[language.slice(0, 2)] ??
                    Object.values(b.names)[0] ??
                    id);
            }),
          ),
        }),
    checked === null || checked.documents.filter((d) => d !== 'contract').length === 0
      ? null
      : t(
          'lib.contract-text.signed_with_this_contract',
          'Signed with this contract: {{documents}}.',
          {
            documents: new Intl.ListFormat(language, { type: 'unit', style: 'short' }).format(
              checked.documents.filter((d) => d !== 'contract').map((d) => words(d, t)),
            ),
          },
        ),
    o.offer.acceptance === null
      ? null
      : t(
          'lib.contract-text.these_are_the_terms_of_offer_version',
          'These are the terms of offer version {{version}} ({{hash}}), which the employee accepted.',
          {
            version: String(o.offer.acceptance.version),
            hash: o.offer.acceptance.versionHash.slice(0, 12),
          },
        ),
  ];
  return lines.filter((l): l is string => l !== null).join('\n\n');
}
