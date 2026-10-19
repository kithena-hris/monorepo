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

const words = (key: string): string => key.replaceAll('_', ' ');

const money = (minor: number, currency: string): string =>
  new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 2 }).format(
    minor / 100,
  );

const length = (l: unknown): string | null =>
  typeof l === 'object' && l !== null && 'count' in l && 'unit' in l
    ? `${String((l as Length).count)} ${(l as Length).unit}`
    : null;

const hours = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${String(h)} hours` : `${String(h)} hours ${String(m)} minutes`;
};

/** The version the candidate accepted; the latest when the screen has no acceptance yet. */
function accepted(o: Offer) {
  const n = o.offer.acceptance?.version;
  return o.offer.versions.find((v) => v.version === n) ?? o.offer.versions.at(-1) ?? null;
}

export function contractTitle(o: Offer): string {
  return `Employment contract – ${o.candidate.name}`;
}

export function contractText(o: Offer, companyName: string): string {
  const v = accepted(o);
  const t = o.checked?.terms ?? null;
  if (v === null) return `${companyName} engages ${o.candidate.name} as ${o.job.title}.`;
  const terms = v.terms;
  const per = { year: 'a year', month: 'a month', hour: 'an hour' }[v.pay.frequency];
  const lines: (string | null)[] = [
    `This contract is between ${companyName} (the employer) and ${o.candidate.name} (the employee).`,
    `Role: ${o.job.title}.`,
    t === null
      ? null
      : `Contract: ${words(t.contractType)}, ${words(t.employmentType)}${
          typeof terms['contractEnd'] === 'string' ? `, ending ${terms['contractEnd']}` : ''
        }.`,
    `Start date: ${v.startDate}.`,
    `Pay: ${money(v.pay.baseMinor, v.pay.currency)} ${per}${
      typeof terms['paymentsPerYear'] === 'number'
        ? `, paid in ${String(terms['paymentsPerYear'])} payments a year`
        : ''
    }.`,
    v.pay.variableTargetMinor > 0
      ? `Variable pay at target: ${money(v.pay.variableTargetMinor, v.pay.currency)} a year.`
      : null,
    v.pay.signOnMinor > 0 ? `Signing bonus: ${money(v.pay.signOnMinor, v.pay.currency)}.` : null,
    v.pay.relocationMinor > 0
      ? `Relocation: ${money(v.pay.relocationMinor, v.pay.currency)}.`
      : null,
    t === null
      ? null
      : `Working time: ${hours(t.weeklyMinutes)} a week (${t.fte} FTE)${
          typeof terms['workMode'] === 'string'
            ? `, ${words(terms['workMode'])}${
                typeof terms['hybridDaysOnsite'] === 'number'
                  ? ` with ${String(terms['hybridDaysOnsite'])} days on site`
                  : ''
              }`
            : ''
        }.`,
    length(terms['probation']) === null
      ? 'Probation: none.'
      : `Probation: ${length(terms['probation']) ?? ''}.`,
    length(terms['noticeEmployee']) === null || length(terms['noticeEmployer']) === null
      ? null
      : `Notice: ${length(terms['noticeEmployee']) ?? ''} by the employee, ${length(terms['noticeEmployer']) ?? ''} by the employer.`,
    typeof terms['nonCompeteMonths'] === 'number' && terms['nonCompeteMonths'] > 0
      ? `Non-compete: ${String(terms['nonCompeteMonths'])} months after the employment ends${
          typeof terms['nonCompeteCompensationPercent'] === 'number'
            ? `, compensated at ${String(terms['nonCompeteCompensationPercent'])}% of pay`
            : ''
        }.`
      : null,
    terms['mobilityClause'] === true
      ? 'Mobility: the employee may be asked to work from another of the employer’s locations.'
      : null,
    v.benefitIds.length === 0
      ? null
      : `Benefits: ${v.benefitIds
          .map((id) => {
            const b = o.benefits.find((x) => x.id === id);
            return b === undefined
              ? words(id.replace(/^statutory:/u, ''))
              : (Object.values(b.names)[0] ?? id);
          })
          .join(', ')}.`,
    t === null || t.documents.filter((d) => d !== 'contract').length === 0
      ? null
      : `Signed with this contract: ${t.documents
          .filter((d) => d !== 'contract')
          .map(words)
          .join(', ')}.`,
    o.offer.acceptance === null
      ? null
      : `These are the terms of offer version ${String(o.offer.acceptance.version)} (${o.offer.acceptance.versionHash.slice(0, 12)}), which the employee accepted.`,
  ];
  return lines.filter((l): l is string => l !== null).join('\n\n');
}
