import * as z from 'zod';
import type { Classification, PiiKind } from '@kithena/contracts';

/** What happens for people without a value: `ForExisting` in `new-fields.ts`, which reads this file. */
type ForExisting =
  | { readonly kind: 'ask' | 'hr' | 'leave' | 'new' }
  | { readonly kind: 'default'; readonly value: string };

/** As much of a proposal (`ColumnProposal`) as who fills it in needs. */
interface Proposed {
  readonly column: number;
  readonly key: string;
  readonly include: boolean;
  readonly field: {
    readonly label: string;
    readonly piiKind: PiiKind;
    readonly classification: Classification;
  };
  readonly placement: { readonly sectionKey: string } | { readonly newSection: string };
  readonly forExisting: ForExisting;
  readonly forExistingWhy: string;
}

/**
 * Who fills in a new field for the people the file gives no value
 * (docs/ai-settings.md, "People without a value").
 *
 * Employment data is HR's: HR has it, so HR fills it in. Personal data the
 * employee holds — their bank account, licence, passport, home address,
 * emergency contact, family, sizes and languages — is theirs to give, so they
 * are asked, once, for everything asked of them. HR never types in what HR
 * does not have.
 *
 * Rules first, from the field's key and label, then its kind and its
 * section; the model only for a field the rules cannot place, told its label,
 * section and kind and never a value, and read strictly. Whatever is
 * suggested, HR changes it in one click. Pure.
 */

export type Owner = 'hr' | 'employee' | 'leave';

/** What the rules and the model may know of a field: never a value. */
export interface FieldFacts {
  readonly key: string;
  readonly label: string;
  /** The section's name, existing or new. */
  readonly section: string;
  readonly piiKind: PiiKind;
  readonly classification: Classification;
}

export interface Suggested {
  readonly owner: Owner;
  /** One line HR reads beside the choice. */
  readonly why: string;
}

const ASSIGNED = 'The company assigns it: HR fills it in.';
const EMPLOYMENT = 'Employment data: HR holds it, so HR fills it in.';
const DOCUMENT = 'Their own document: only they have the number.';
const BANK = 'Bank details are the employee’s to give.';
const TAX = 'Their tax details: the employee fills them in.';
const CONTACT = 'Personal contact details: the employee keeps them up to date.';
const PERSONAL = 'Personal details only the employee knows.';
const ABOUT = 'About them, not their job: the employee tells us.';
const SPECIAL = 'Volunteered, never chased: it can reveal health, religion or the like.';
const NOTES = 'Free notes: nobody is chased for them.';

/**
 * By key and label, first match wins: what the company assigns before what
 * a person holds ("Work phone", "Manager email" are HR's; "Mobile phone" is
 * theirs), a person's own before their job ("Tax filing status" is theirs,
 * "Bonus" is pay).
 */
const BY_NAME: readonly (readonly [RegExp, Owner, string])[] = [
  [
    /\bwork (e ?mail|phone|location|address)|\bmanager|supervisor|reports? to|\bbadge|laptop|serial|\basset|equipment|parking|locker/u,
    'hr',
    ASSIGNED,
  ],
  [
    /passport|driv\w* licen[cs]e|national (id|insurance)|\bnino\b|\bssn\b|social security|\bsin\b|\bpan\b|\btin\b|tax id|steuer|\bnif\b|\bnie\b|\bdni\b|work permit|\bvisa\b|work authori[sz]ation|right to work|immigration/u,
    'employee',
    DOCUMENT,
  ],
  [/bank|iban|account (number|no)|routing|sort code|ifsc|swift|\bbic\b/u, 'employee', BANK],
  [/tax (filing|status|code|form|withholding)|filing status|\bw ?4\b|allowances/u, 'employee', TAX],
  [
    /emergency|next of kin|\bkin\b|\bhome\b|address|personal (e ?mail|phone)|mobile|\bcell\b/u,
    'employee',
    CONTACT,
  ],
  [
    /marital|dependa?ents?|children|spouse|partner|nationality|citizenship|pronoun|gender|birth|\bdob\b|preferred name/u,
    'employee',
    PERSONAL,
  ],
  [
    /\bt ?shirt|shirt size|clothing|uniform|language|education|degree|university|college|school|qualification|certific|skill|linkedin|github|portfolio|website|hobb|\bbio\b/u,
    'employee',
    ABOUT,
  ],
  [/\bnotes?\b|comments?|remarks?/u, 'leave', NOTES],
  [
    /\bjob\b|title|position|\brole\b|department|division|\bteam\b|grade|level|\bband\b|family|cost cent|legal entity|company|employ|hire|start date|seniority|probation|contract|\bfte\b|hours|shift|arrangement|work model|location|office|\bsite\b|salary|wage|\bpay|bonus|commission|equity|stock|raise|hourly|compensation|currency|flsa|exempt|benefit|pension|retirement|\bleave\b|absence|return|balance|termination|rehire|notice|performance|review|rating/u,
    'hr',
    EMPLOYMENT,
  ],
];

const words = (s: string): string =>
  s
    .toLowerCase()
    .replaceAll(/[_\-/()]+/gu, ' ')
    .replaceAll(/\s+/gu, ' ');

/** The rules' suggestion, or null when they cannot place the field. */
export function ownerByRules(f: FieldFacts): Suggested | null {
  if (f.classification === 'special-category' || f.piiKind === 'health' || f.piiKind === 'biometric')
    return { owner: 'leave', why: SPECIAL };
  const name = `${words(f.label)} ${words(f.key)}`;
  const named = BY_NAME.find(([re]) => re.test(name));
  if (named !== undefined) return { owner: named[1], why: named[2] };
  if (f.piiKind === 'financial') return { owner: 'employee', why: BANK };
  if (f.piiKind === 'identity') return { owner: 'employee', why: DOCUMENT };
  if (f.piiKind === 'contact') return { owner: 'employee', why: CONTACT };
  const section = words(f.section);
  if (/personal|contact|emergency|bank|identif|family|about/u.test(section))
    return { owner: 'employee', why: PERSONAL };
  if (/employ|job|compens|\bpay|organi|position|\bwork/u.test(section))
    return { owner: 'hr', why: EMPLOYMENT };
  return null;
}

/**
 * The suggestion as what happens for people without a value. HR's, with one
 * value in every row of the file: that value for everybody, rather than HR
 * typing it. Somebody's own detail is never guessed from everybody else's.
 */
export function forExistingOf(
  s: Suggested,
  single: string | null,
): { forExisting: ForExisting; forExistingWhy: string } {
  if (s.owner === 'employee') return { forExisting: { kind: 'ask' }, forExistingWhy: s.why };
  if (s.owner === 'leave') return { forExisting: { kind: 'leave' }, forExistingWhy: s.why };
  return single === null
    ? { forExisting: { kind: 'hr' }, forExistingWhy: s.why }
    : {
        forExisting: { kind: 'default', value: single },
        forExistingWhy: 'Every row in the file has the same value, so it likely holds for everybody.',
      };
}

/* ---------------------------------------------------------- the model -- */

export const WHO_FILLS_INSTRUCTION = `An HR team is importing a spreadsheet of employees into new fields. Some people will have no value for a field. For each listed field, say who should fill it in for them:
- "employee": personal data the employee holds and HR does not have (their documents, bank, home, family, sizes, languages, education).
- "hr": employment data HR holds (job, team, manager, location, dates, contract, pay, equipment the company assigns).
- "leave": nice to have, volunteered, or free notes: nobody is asked.

You see each field's key, label, section and kind, never a value. Answer with one JSON object and nothing else, mapping each key to one of the three words, for example {"favourite_colour":"leave","locker_code":"hr"}.`;

/** What the model is told: labels, sections and kinds. */
export function whoFillsContext(fields: readonly FieldFacts[]): Record<string, unknown> {
  return {
    fields: fields.map((f) => ({
      key: f.key,
      label: f.label,
      section: f.section,
      kind: f.piiKind,
      classification: f.classification,
    })),
  };
}

const OwnerWord = z.enum(['hr', 'employee', 'leave']);

/** The model's answer, strictly: one of three words, for a key it was asked about. */
export function whoFillsAnswer(raw: unknown, asked: ReadonlySet<string>): Map<string, Owner> {
  const read = new Map<string, Owner>();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return read;
  for (const [key, value] of Object.entries(raw)) {
    const owner = OwnerWord.safeParse(value);
    if (asked.has(key) && owner.success) read.set(key, owner.data);
  }
  return read;
}

const BY_MODEL: Record<Owner, string> = {
  employee: 'The assistant reads it as theirs to give, so they are asked.',
  hr: 'The assistant reads it as employment data, so HR fills it in.',
  leave: 'The assistant reads it as nice to have, so nobody is chased for it.',
};

/* ------------------------------------------------------ the proposals -- */

/** A proposal's facts, its section named as HR sees it. */
export function factsOf(
  p: Proposed,
  sections: readonly { readonly key: string; readonly label: string }[],
): FieldFacts {
  const section =
    'sectionKey' in p.placement
      ? (sections.find((s) => s.key === (p.placement as { sectionKey: string }).sectionKey)
          ?.label ?? p.placement.sectionKey)
      : p.placement.newSection;
  return {
    key: p.key,
    label: p.field.label,
    section,
    piiKind: p.field.piiKind,
    classification: p.field.classification,
  };
}

/** The proposals the rules cannot place: what the model is asked about. */
export const unplaced = (
  proposals: readonly Proposed[],
  sections: readonly { readonly key: string; readonly label: string }[],
): FieldFacts[] =>
  proposals
    .filter((p) => p.include)
    .map((p) => factsOf(p, sections))
    .filter((f) => ownerByRules(f) === null);

/**
 * Each proposal with who fills it in: the rules' suggestion where they place
 * it, else the model's, else what was proposed already.
 */
export function owned<P extends Proposed>(
  proposals: readonly P[],
  sections: readonly { readonly key: string; readonly label: string }[],
  seen: readonly { readonly column: number; readonly single: string | null }[],
  model: ReadonlyMap<string, Owner> = new Map(),
): P[] {
  return proposals.map((p) => {
    const ruled = ownerByRules(factsOf(p, sections));
    const answered = model.get(p.key);
    const s = ruled ?? (answered === undefined ? null : { owner: answered, why: BY_MODEL[answered] });
    if (s === null) return p;
    const single = seen.find((x) => x.column === p.column)?.single ?? null;
    return { ...p, ...forExistingOf(s, single) };
  });
}
