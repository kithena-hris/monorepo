import * as z from 'zod';
import {
  AttributeDataType,
  ClassificationSchema,
  PiiKindSchema,
  ViewerScope,
  WriterRole,
  type AttributeDefinition,
} from '@kithena/contracts';

import { keyFrom } from '../schema/draft.js';
import { kindOf, type ColumnShape } from './column-shape.js';

/**
 * New information in an imported file (docs/ai-settings.md).
 *
 * A column the mapper cannot place becomes a proposed field, and each
 * proposed field says what happens for the people already here that the
 * file gives no value: they are asked, HR fills it in, it stays empty, or
 * everybody missing it gets one value. The model proposes, from the column's
 * header and the shape of its values and never a value; People's own rules
 * below propose when there is no model, and fill in whatever the model left
 * out. Whatever is proposed, HR reviews it, and a People administrator's OK
 * is what writes it.
 *
 * Pure: the file, the model and the counts are the application layer's.
 */

/* ------------------------------------------------------------- shapes -- */

const Label = z.string().trim().min(1).max(120);
const Key = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/u, 'a key is lower-case letters, digits and underscores');

/** What happens for people already here whom the file gives no value. */
export const ForExisting = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ask') }),
  z.object({ kind: z.literal('hr') }),
  z.object({ kind: z.literal('leave') }),
  z.object({ kind: z.literal('default'), value: z.string().trim().min(1).max(200) }),
]);
export type ForExisting = z.infer<typeof ForExisting>;

/** A proposed field, as a model describes one and as HR edits it. */
export const NewField = z.strictObject({
  label: Label.describe('What people see, in the words HR uses'),
  dataType: AttributeDataType,
  options: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/u)
    .nullable()
    .optional(),
  description: z.string().trim().max(500).nullable().optional(),
  required: z.boolean(),
  ownership: z.array(WriterRole).min(1).max(6).describe('Who fills it in'),
  visibility: z.array(ViewerScope).max(7).describe('Who sees it'),
  classification: ClassificationSchema,
  piiKind: PiiKindSchema,
  encrypted: z.boolean().describe('Stored sealed: bank details, identifiers, pay'),
  aiEligible: z
    .boolean()
    .describe('Whether the assistant may use its name and choices; never for confidential data'),
});
export type NewField = z.infer<typeof NewField>;

/** Where a proposed field goes: a section that exists, or one this import adds. */
export const Placement = z.union([
  z.strictObject({ sectionKey: z.string().min(1).max(64) }),
  z.strictObject({ newSection: Label }),
]);
export type Placement = z.infer<typeof Placement>;

/** One column, proposed as a field: what HR reviews, edits, and sends back. */
export const ColumnProposal = z.strictObject({
  column: z.int().min(0).max(1000),
  header: z.string().max(200),
  shape: z.string().max(200),
  include: z.boolean(),
  key: Key,
  field: NewField,
  placement: Placement,
  why: z.string().max(300),
  forExisting: ForExisting,
  forExistingWhy: z.string().max(300),
});
export type ColumnProposal = z.infer<typeof ColumnProposal>;

/* -------------------------------------------------------------- tools -- */

export const ProposeField = z.strictObject({
  column: z.int().min(0).max(1000).describe('The column’s index, as listed'),
  field: NewField,
  sectionKey: z.string().max(64).optional().describe('An existing section’s key, when one fits'),
  newSection: Label.optional().describe(
    'Otherwise the name of a new section; columns that belong together share one',
  ),
  why: z.string().trim().min(1).max(200).describe('One line: why this field is set up this way'),
  forExisting: z
    .enum(['ask', 'hr', 'leave', 'default'])
    .describe(
      'For people already here that the file gives no value: ask them (their own details), hr (HR records it), leave it empty (nice to have), default (one value suits everyone missing it)',
    ),
  forExistingWhy: z.string().trim().min(1).max(200).describe('One line: why'),
});
export const SkipColumn = z.strictObject({
  column: z.int().min(0).max(1000),
  why: z.string().trim().min(1).max(200),
});
export const Finish = z.strictObject({
  summary: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe('One sentence, naming no person and no value'),
});

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType;
}

/** What a model is offered. None of them writes anything. */
export const NEW_FIELD_TOOLS: readonly Tool[] = [
  {
    name: 'propose_field',
    description:
      'Propose one employee field for one column of the file, and what happens for people already here.',
    input: ProposeField,
  },
  {
    name: 'skip_column',
    description:
      'Say a column holds nothing an HR system should keep, or that duplicates an existing field.',
    input: SkipColumn,
  },
  { name: 'finish', description: 'Call once, last, with a one-sentence summary.', input: Finish },
];

/* ------------------------------------------------------------ defaults -- */

export interface ColumnSeen {
  readonly column: number;
  readonly header: string;
  readonly local: ColumnShape;
  /** The one value every row holds, when they all hold the same one: for a default, never a model. */
  readonly single: string | null;
}

const SEALABLE = new Set([
  'text',
  'long_text',
  'email',
  'phone',
  'url',
  'number',
  'decimal',
  'date',
  'bank_account',
]);

/** People's own proposal for a column, with the one-line reasons. */
export function localProposal(
  seen: ColumnSeen,
  sections: readonly { readonly key: string; readonly label: string }[],
  /** The fields the company has: a column named like one is left out, not duplicated. */
  existing: readonly { readonly key: string; readonly label: string }[] = [],
): Omit<ColumnProposal, 'key'> {
  const kind = kindOf(seen.header, seen.local);
  const dataType =
    kind === 'financial' && seen.local.dataType === 'select' ? 'text' : seen.local.dataType;
  const sealed = SEALABLE.has(dataType);
  const base = {
    label: seen.header.trim().slice(0, 120) || 'Imported column',
    dataType,
    ...(dataType === 'select' ? { options: [...seen.local.options] } : {}),
    ...(dataType === 'bank_account' ? { country: seen.local.country ?? 'ES' } : {}),
    description: null,
    required: false,
  };
  const own = (who: 'employee' | 'hr') =>
    ({ ownership: [who], visibility: ['self', 'hr'] }) as Pick<
      NewField,
      'ownership' | 'visibility'
    >;
  const field: NewField = (() => {
    switch (kind) {
      case 'financial':
        return {
          ...base,
          ...own('employee'),
          classification: 'confidential',
          piiKind: 'financial',
          encrypted: sealed,
          aiEligible: false,
        };
      case 'identifier':
        return {
          ...base,
          ...own('employee'),
          classification: 'confidential',
          piiKind: 'identity',
          encrypted: sealed,
          aiEligible: false,
        };
      case 'special':
        return {
          ...base,
          ...own('employee'),
          classification: 'special-category',
          piiKind: 'health',
          encrypted: false,
          aiEligible: false,
        };
      case 'contact':
      case 'birth':
        return {
          ...base,
          ...own('employee'),
          classification: 'confidential',
          piiKind: kind === 'contact' ? 'contact' : 'identity',
          encrypted: false,
          aiEligible: false,
        };
      case 'business':
        return {
          ...base,
          ownership: ['hr'],
          visibility: ['self', 'manager', 'hr'],
          classification: 'internal',
          piiKind: 'none',
          encrypted: false,
          aiEligible: true,
        };
      case 'plain':
        return {
          ...base,
          ...own('employee'),
          classification: 'internal',
          piiKind: 'none',
          encrypted: false,
          aiEligible: true,
        };
    }
  })();
  const why = {
    financial:
      'Bank and pay details are financial: sealed, seen by the employee and HR, never by the assistant.',
    identifier: 'An identifier names one person: sealed, and never shown to the assistant.',
    special: 'Health data is special category: only the employee and HR see it.',
    contact: 'Contact details are personal: the employee keeps them up to date, HR can see them.',
    birth: 'A date of birth identifies somebody: confidential, the employee’s own.',
    business: 'Organisational data HR keeps; managers can see it for their team.',
    plain: 'Ordinary, not sensitive: the employee fills it in, and the assistant may use it.',
  }[kind];
  const twin = existing.find((f) => f.key === keyFrom(seen.header));
  return {
    column: seen.column,
    header: seen.header,
    shape: seen.local.shape,
    // "Given name" is `given_name`, whatever its label says: never a second one.
    include: twin === undefined,
    field,
    placement: placementFor(kind, seen.header, sections),
    why:
      twin === undefined
        ? why
        : `Looks like the existing field “${twin.label}”: choose it for this column on the mapping screen instead.`,
    ...recommendFor(kind, seen),
  };
}

/** A section whose name fits the kind of data, else a new one named for it. */
function placementFor(
  kind: ReturnType<typeof kindOf>,
  header: string,
  sections: readonly { readonly key: string; readonly label: string }[],
): Placement {
  const fits: Record<string, { re: RegExp; otherwise: string }> = {
    financial: { re: /bank|pay|compens|financ|salar|tax/u, otherwise: 'Bank and pay' },
    identifier: { re: /ident|right to work/u, otherwise: 'Identification' },
    special: { re: /health|safety/u, otherwise: 'Health and safety' },
    contact: {
      re: /emergency/u.test(header.toLowerCase()) ? /emergency/u : /contact|personal/u,
      otherwise: /emergency/u.test(header.toLowerCase()) ? 'Emergency contact' : 'Contact details',
    },
    birth: { re: /personal/u, otherwise: 'Personal information' },
    business: { re: /employ|hr information|job|organi/u, otherwise: 'Employment' },
    plain: { re: /other|additional|imported/u, otherwise: 'Other information' },
  };
  const { re, otherwise } = fits[kind] ?? { re: /$^/u, otherwise: 'Other information' };
  const found = sections.find((s) => re.test(`${s.key} ${s.label.toLowerCase()}`));
  return found === undefined ? { newSection: otherwise } : { sectionKey: found.key };
}

/**
 * The recommendation for people already here. Their own details: ask them.
 * Organisational data: HR fills it. One value in every row of the file: that
 * value for everybody missing it. Anything else is nice to have: leave it.
 */
function recommendFor(
  kind: ReturnType<typeof kindOf>,
  seen: ColumnSeen,
): Pick<ColumnProposal, 'forExisting' | 'forExistingWhy'> {
  const personal =
    kind === 'financial' || kind === 'identifier' || kind === 'contact' || kind === 'birth';
  if (personal) {
    return {
      forExisting: { kind: 'ask' },
      forExistingWhy: 'Only they know it: they are asked, and reminded until it is filled in.',
    };
  }
  if (kind === 'special') {
    return {
      forExisting: { kind: 'leave' },
      forExistingWhy: 'Health information is volunteered, never chased.',
    };
  }
  if (seen.single !== null) {
    return {
      forExisting: { kind: 'default', value: seen.single },
      forExistingWhy: 'Every row in the file has the same value, so it likely holds for everybody.',
    };
  }
  if (kind === 'business') {
    return {
      forExisting: { kind: 'hr' },
      forExistingWhy: 'HR records it: it goes to HR’s completeness list.',
    };
  }
  return {
    forExisting: { kind: 'leave' },
    forExistingWhy: 'Nice to have: nobody is chased for it.',
  };
}

/* ------------------------------------------------------ the model's view -- */

/**
 * The model's proposals laid over People's own: per column, a valid proposal
 * from the model replaces the local one; a column it skipped is left out
 * (and says why); a column it did not mention keeps People's. Choices always
 * come from the file, and a default's value too: the model saw neither.
 */
export function withModel(
  local: readonly Omit<ColumnProposal, 'key'>[],
  calls: readonly { readonly name: string; readonly input: unknown }[],
  sections: readonly { readonly key: string; readonly label: string }[],
  seen: readonly ColumnSeen[],
): { proposals: Omit<ColumnProposal, 'key'>[]; summary: string | null; unreadable: number } {
  const byColumn = new Map(local.map((p) => [p.column, p]));
  let summary: string | null = null;
  let unreadable = 0;
  for (const call of calls) {
    if (call.name === 'finish') {
      const done = Finish.safeParse(call.input);
      if (done.success) summary = done.data.summary;
      else unreadable += 1;
      continue;
    }
    if (call.name === 'skip_column') {
      const skip = SkipColumn.safeParse(call.input);
      const was = skip.success ? byColumn.get(skip.data.column) : undefined;
      if (skip.success && was)
        byColumn.set(skip.data.column, { ...was, include: false, why: skip.data.why });
      else unreadable += 1;
      continue;
    }
    const proposed = call.name === 'propose_field' ? ProposeField.safeParse(call.input) : null;
    const was = proposed?.success ? byColumn.get(proposed.data.column) : undefined;
    if (!proposed?.success || was === undefined) {
      unreadable += 1;
      continue;
    }
    const p = proposed.data;
    const column = seen.find((s) => s.column === p.column);
    const placement: Placement =
      p.sectionKey !== undefined && sections.some((s) => s.key === p.sectionKey)
        ? { sectionKey: p.sectionKey }
        : { newSection: p.newSection ?? was.header };
    const forExisting: ForExisting =
      p.forExisting === 'default'
        ? column?.single == null
          ? { kind: 'leave' }
          : { kind: 'default', value: column.single }
        : { kind: p.forExisting };
    byColumn.set(p.column, {
      ...was,
      field: {
        ...p.field,
        ...(p.field.dataType === 'select' || p.field.dataType === 'multi_select'
          ? { options: [...(column?.local.options ?? [])] }
          : {}),
      },
      placement,
      why: p.why,
      forExisting,
      forExistingWhy: p.forExistingWhy,
    });
  }
  return { proposals: [...byColumn.values()], summary, unreadable };
}

/** Each proposal with a key: its label's, unless that is taken, then numbered. */
export function withKeys(
  proposals: readonly Omit<ColumnProposal, 'key'>[],
  taken: ReadonlySet<string>,
): ColumnProposal[] {
  const used = new Set(taken);
  return proposals.map((p) => {
    const base = keyFrom(p.field.label);
    let key = base;
    for (let n = 2; used.has(key); n += 1) key = `${base}_${String(n)}`.slice(0, 64);
    used.add(key);
    return { ...p, key };
  });
}

/* ------------------------------------------------ what applying means -- */

/**
 * A proposal as a field: who must fill it in follows from what happens for
 * people already here. Asked of them, it is theirs and required of everyone;
 * HR's, it is required and HR's; left empty, it is required of new people
 * only, if at all; a default, as marked.
 */
export function asDefinition(p: ColumnProposal): {
  readonly ownership: NewField['ownership'];
  readonly visibility: NewField['visibility'];
  readonly requiredness:
    { mode: 'never' } | { mode: 'always'; appliesTo: 'all_records' | 'new_records' };
} {
  const add = <T>(list: readonly T[], x: T): T[] => (list.includes(x) ? [...list] : [...list, x]);
  switch (p.forExisting.kind) {
    case 'ask':
      return {
        ownership: add(p.field.ownership, 'employee'),
        visibility: add(p.field.visibility, 'self'),
        requiredness: { mode: 'always', appliesTo: 'all_records' },
      };
    case 'hr':
      return {
        ownership: add(p.field.ownership, 'hr'),
        visibility: add(p.field.visibility, 'hr'),
        requiredness: { mode: 'always', appliesTo: 'all_records' },
      };
    case 'leave':
      return {
        ownership: [...p.field.ownership],
        visibility: [...p.field.visibility],
        requiredness: p.field.required
          ? { mode: 'always', appliesTo: 'new_records' }
          : { mode: 'never' },
      };
    case 'default':
      return {
        ownership: [...p.field.ownership],
        visibility: [...p.field.visibility],
        requiredness: p.field.required
          ? { mode: 'always', appliesTo: 'all_records' }
          : { mode: 'never' },
      };
  }
}

/** Why a proposal needs a second look: sensitive data. Null for ordinary data. */
export function sensitivity(
  f: Pick<NewField, 'classification' | 'piiKind' | 'dataType'>,
): string | null {
  if (
    f.classification === 'special-category' ||
    f.piiKind === 'health' ||
    f.piiKind === 'biometric'
  ) {
    return 'Special category (GDPR Article 9)';
  }
  if (f.piiKind === 'financial' || f.dataType === 'bank_account') return 'Financial';
  if (f.dataType === 'national_id' || f.piiKind === 'identity') return 'Identifies somebody';
  return null;
}

/* ------------------------------------------------------------- counts -- */

export interface ColumnCounts {
  /** Rows of the file with a value for it: people created or updated with one. */
  readonly fromFile: number;
  /** People already here the file gives no value. */
  readonly existingWithout: number;
}

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;
/** "Emergency contact" reads "emergency contact" mid-sentence; "IBAN" stays "IBAN". */
const lowerFirst = (s: string): string =>
  /^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;

/**
 * The review in one paragraph, in words: "Adds 3 fields: 2 to Personal
 * information, 1 to a new Equipment section. Values for 128 people from this
 * file. 342 people will be asked for their emergency contact."
 */
export function summaryOf(
  proposals: readonly ColumnProposal[],
  counts: ReadonlyMap<number, ColumnCounts>,
  peopleWithValues: number,
  sections: readonly { readonly key: string; readonly label: string }[],
): string {
  const kept = proposals.filter((p) => p.include);
  if (kept.length === 0) return 'Adds no fields: the file imports without these columns.';
  const where = new Map<string, number>();
  for (const p of kept) {
    const name =
      'sectionKey' in p.placement
        ? (sections.find((s) => s.key === (p.placement as { sectionKey: string }).sectionKey)
            ?.label ?? p.placement.sectionKey)
        : `a new ${p.placement.newSection} section`;
    where.set(name, (where.get(name) ?? 0) + 1);
  }
  const parts = [...where].map(([name, n]) => `${String(n)} to ${name}`);
  const sentences = [
    `Adds ${plural(kept.length, 'field', 'fields')}: ${parts.join(', ')}.`,
    `Values for ${plural(peopleWithValues, 'person', 'people')} from this file.`,
  ];
  for (const p of kept) {
    const n = counts.get(p.column)?.existingWithout ?? 0;
    if (n === 0) continue;
    const label = lowerFirst(p.field.label);
    switch (p.forExisting.kind) {
      case 'ask':
        sentences.push(`${plural(n, 'person', 'people')} will be asked for their ${label}.`);
        break;
      case 'hr':
        sentences.push(`HR will fill in ${String(n)} ${label} ${n === 1 ? 'value' : 'values'}.`);
        break;
      case 'default':
        sentences.push(
          `${plural(n, 'person', 'people')} get “${p.forExisting.value}” as their ${label}.`,
        );
        break;
      case 'leave':
        sentences.push(
          `${label.charAt(0).toUpperCase()}${label.slice(1)} stays empty for ${plural(n, 'person', 'people')}.`,
        );
        break;
    }
  }
  return sentences.join(' ');
}

/** The published fields a proposal must not collide with, by key. */
export const takenKeys = (fields: readonly Pick<AttributeDefinition, 'key'>[]): Set<string> =>
  new Set(fields.map((f) => f.key as string));

/* ---------------------------------------------------------- the budget -- */

/**
 * How many proposals a company may ask a model for: `limit` in any
 * `windowMs`. With none left, People's own proposal stands.
 *
 * ponytail: in this process's memory, so each People process counts its own;
 * move it to Postgres or Redis when People runs more than one.
 */
export class PlanBudget {
  readonly #used = new Map<string, number[]>();
  readonly limit: number;
  readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Spend one, or say how many seconds until one is free. `now` is an ISO instant. */
  take(
    tenantId: string,
    now: string,
  ): { readonly ok: true } | { readonly ok: false; readonly retryAfterSeconds: number } {
    const at = Date.parse(now);
    const recent = (this.#used.get(tenantId) ?? []).filter((t) => at - t < this.windowMs);
    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? at;
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - at) / 1000)),
      };
    }
    this.#used.set(tenantId, [...recent, at]);
    return { ok: true };
  }
}
