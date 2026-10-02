import * as z from 'zod';
import {
  AttributeDataType,
  ClassificationSchema,
  PiiKindSchema,
  ViewerScope,
  WriterRole,
  type AttributeDefinition,
} from '@kithena/contracts';

import { encryptable, keyFrom } from '../schema/draft.js';
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
  /** Required of people added from now on; nobody here now is asked. */
  z.object({ kind: z.literal('new') }),
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
  encrypted: z.boolean().describe('Stored sealed: bank details and identifiers; never a choice'),
  aiEligible: z
    .boolean()
    .describe('Whether the assistant may use its name and choices; never for confidential data'),
  requiresApproval: z.boolean().optional().describe('A change waits for a second HR member'),
  decimals: z.int().min(0).max(6).optional().describe('Decimal places, for decimal or percentage'),
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
  /** How sure People's rules are of the type: the values decided it, or only the header. */
  confidence: z.enum(['high', 'medium']),
});
export type ColumnProposal = z.infer<typeof ColumnProposal>;

/* --------------------------------------------------- the model's answer -- */

/** One column's field, as the model proposes it. Read strictly: anything else is dropped. */
export const ProposeField = z.strictObject({
  column: z.int().min(0).max(1000),
  field: NewField,
  sectionKey: z.string().max(64).optional(),
  newSection: Label.optional(),
  why: z.string().trim().min(1).max(200),
  forExisting: z.enum(['ask', 'hr', 'leave', 'new', 'default']),
  forExistingWhy: z.string().trim().min(1).max(200),
});
export const SkipColumn = z.strictObject({
  column: z.int().min(0).max(1000),
  why: z.string().trim().min(1).max(200),
});

/**
 * What the model answers: one JSON object. The envelope is read first and
 * each item on its own, so one malformed proposal is dropped and counted
 * rather than costing the rest.
 */
export const ModelAnswer = z.object({
  proposals: z.array(z.unknown()).max(200).default([]),
  skipped: z.array(z.unknown()).max(200).default([]),
  summary: z.string().trim().max(300).optional(),
});

/* ------------------------------------------------------------ defaults -- */

export interface ColumnSeen {
  readonly column: number;
  readonly header: string;
  readonly local: ColumnShape;
  /** The one value every row holds, when they all hold the same one: for a default, never a model. */
  readonly single: string | null;
}

/** Types a model may change: what the values left open. */
const LOOSE: ReadonlySet<string> = new Set(['text', 'long_text', 'select']);

const RANK = { public: 0, internal: 1, confidential: 2, 'special-category': 3 } as const;

/** What a type is called in a sentence about why it cannot be sealed. */
const UNSEALED_AS: Partial<Record<string, string>> = {
  select: 'a list',
  multi_select: 'a list',
  boolean: 'a yes or no',
  percentage: 'a percentage',
};

/**
 * A field as the draft will take it, and a plain note when something had to
 * change: every proposal, People's or a model's or HR's edit, goes through
 * here before anybody sees it, so none is refused when it is applied.
 *
 * - A choice, a yes or no, a percentage, a reference is never stored sealed.
 *   Sensitive data of that type is kept unsealed, at least confidential, and
 *   a change to it waits for approval. Financial data must be sealed, so a
 *   value that cannot be is no longer called financial.
 * - Financial data and bank accounts are sealed where the type allows.
 * - A national identifier needs its country's scheme and a bank account its
 *   country; without them, sealed text.
 * - A choice with no choices is text.
 * - Anything confidential or sealed is never the assistant's.
 */
export function fitted(field: NewField, header: string): { field: NewField; note: string | null } {
  let f: NewField = { ...field, label: field.label.trim() || header.trim().slice(0, 120) || 'Imported column' };
  let note: string | null = null;
  const choice = f.dataType === 'select' || f.dataType === 'multi_select';
  if (choice && (f.options ?? []).length === 0) {
    const { options: _o, ...rest } = f;
    f = { ...rest, dataType: 'text' };
  }
  if (f.dataType === 'national_id' || (f.dataType === 'bank_account' && !f.country)) {
    const { country: _c, ...rest } = f;
    f = { ...rest, dataType: 'text', encrypted: true };
  }
  const wantsSeal = f.encrypted || f.piiKind === 'financial';
  if (wantsSeal && !encryptable({ dataType: f.dataType, effectiveDated: false })) {
    f = {
      ...f,
      encrypted: false,
      piiKind: f.piiKind === 'financial' ? 'none' : f.piiKind,
      classification: RANK[f.classification] < RANK.confidential ? 'confidential' : f.classification,
      requiresApproval: true,
    };
    const as = f.classification === 'special-category' ? 'special-category data' : 'confidential';
    note = `Stored as ${as}, with changes approved, not encrypted, because it’s ${UNSEALED_AS[f.dataType] ?? 'this type'}.`;
  } else if (wantsSeal) {
    f = { ...f, encrypted: true };
  }
  if (f.encrypted || RANK[f.classification] >= RANK.confidential) f = { ...f, aiEligible: false };
  if (f.classification === 'special-category') f = { ...f, required: false };
  return { field: f, note };
}

/** People's own proposal for a column, with the one-line reasons. */
export function localProposal(
  seen: ColumnSeen,
  sections: readonly { readonly key: string; readonly label: string }[],
  /** The fields the company has: a column named like one is left out, not duplicated. */
  existing: readonly { readonly key: string; readonly label: string }[] = [],
): Omit<ColumnProposal, 'key'> {
  const kind = kindOf(seen.header, seen.local);
  const dataType = seen.local.dataType;
  const base = {
    label: seen.header.trim().slice(0, 120) || 'Imported column',
    dataType,
    ...(dataType === 'select' ? { options: [...seen.local.options] } : {}),
    ...(dataType === 'bank_account' && seen.local.country !== null
      ? { country: seen.local.country }
      : {}),
    ...(seen.local.decimals === undefined ? {} : { decimals: seen.local.decimals }),
    description: null,
    required: false,
  };
  // HR writes the file's values, so HR is always among who fills it in.
  const own = (who: 'employee' | 'hr') =>
    ({ ownership: who === 'hr' ? ['hr'] : ['employee', 'hr'], visibility: ['self', 'hr'] }) as Pick<
      NewField,
      'ownership' | 'visibility'
    >;
  const proposed: NewField = (() => {
    switch (kind) {
      case 'financial':
        return {
          ...base,
          ...own('employee'),
          classification: 'confidential',
          piiKind: 'financial',
          encrypted: true,
          aiEligible: false,
        };
      case 'identifier':
        return {
          ...base,
          ...own('employee'),
          classification: 'confidential',
          piiKind: 'identity',
          encrypted: true,
          aiEligible: false,
        };
      case 'pay':
        return {
          ...base,
          ownership: ['hr'],
          visibility: ['hr', 'finance'],
          classification: 'confidential',
          piiKind: 'none',
          encrypted: false,
          aiEligible: false,
          requiresApproval: true,
        };
      case 'special':
        // Imported, at the company's choice as data controller: sealed where
        // the type allows, HR's alone, never required, changes approved.
        return {
          ...base,
          ...own('hr'),
          visibility: ['hr'],
          classification: 'special-category',
          piiKind: 'health',
          encrypted: true,
          aiEligible: false,
          requiresApproval: true,
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
  const { field, note } = fitted(proposed, seen.header);
  const why = {
    financial: 'Bank details are financial: sealed, seen by the employee and HR, never by the assistant.',
    identifier: 'An identifier names one person: sealed, and never shown to the assistant.',
    pay: 'Pay is confidential: HR and finance see it, a change is approved, the assistant never does.',
    special: SPECIAL,
    contact: 'Contact details are personal: the employee keeps them up to date, HR can see them.',
    birth: 'A date of birth identifies somebody: confidential, the employee’s own.',
    business: 'Organisational data HR keeps; managers can see it for their team.',
    plain: 'Ordinary, not sensitive: the employee fills it in, and the assistant may use it.',
  }[kind];
  const twin = existing.find((f) => f.key === keyFrom(seen.header) || nearly(f.label, seen.header));
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
        ? note === null
          ? why
          : `${note} ${why}`
        : `Looks like the existing field “${twin.label}”: choose it for this column on the mapping screen instead.`,
    ...recommendFor(kind, seen),
    // The values chose the type, or the header said what it is; plain free
    // text is the header's guess.
    confidence:
      kind === 'plain' && (dataType === 'text' || dataType === 'long_text') ? 'medium' : 'high',
  };
}

/** Why a column that can reveal health, religion and the like is kept the way it is. */
export const SPECIAL =
  'This can reveal health, religion or the like, which GDPR treats as special-category data: imported at your choice as data controller, sealed where it can be, seen by HR alone, never by the assistant.';

/**
 * Two names for one thing, spelled a little differently: "Cost center" and
 * "Cost centre". The same words but one, and that one a spelling of the
 * other: as long, give or take a letter, at least five letters, and at most
 * two edits apart. "Parking spot" is not "Parking lot"; "Region" is not
 * "Religion".
 */
export function nearly(a: string, b: string): boolean {
  const words = (s: string): string[] =>
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w !== '');
  const x = words(a);
  const y = words(b);
  if (x.length !== y.length) return false;
  const differ = x.flatMap((w, i) => (w === y[i] ? [] : [[w, y[i] ?? ''] as const]));
  if (differ.length === 0) return true;
  const [pair] = differ;
  if (differ.length > 1 || pair === undefined) return false;
  const [u, v] = pair;
  if (Math.min(u.length, v.length) < 5 || Math.abs(u.length - v.length) > 1) return false;
  let row = Array.from({ length: v.length + 1 }, (_, j) => j);
  for (let i = 1; i <= u.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= v.length; j += 1) {
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (u[i - 1] === v[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return (row[v.length] ?? 99) <= 2;
}

/** A section whose name fits the kind of data, else a new one named for it. */
function placementFor(
  kind: ReturnType<typeof kindOf>,
  header: string,
  sections: readonly { readonly key: string; readonly label: string }[],
): Placement {
  const fits: Record<string, { re: RegExp; otherwise: string }> = {
    financial: { re: /bank|pay|compens|financ|salar|tax/u, otherwise: 'Bank and pay' },
    pay: { re: /compens|pay|salar/u, otherwise: 'Compensation' },
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
  if (kind === 'pay') {
    return {
      forExisting: { kind: 'hr' },
      forExistingWhy: 'HR and payroll hold it: it goes to HR’s completeness list.',
    };
  }
  if (personal) {
    return {
      forExisting: { kind: 'ask' },
      forExistingWhy: 'Only they know it: they are asked, and reminded until it is filled in.',
    };
  }
  if (kind === 'special') {
    return {
      forExisting: { kind: 'leave' },
      forExistingWhy: 'Volunteered, never chased.',
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
 * The model's answers laid over People's own proposals: per column, a valid
 * proposal from the model replaces the local one; a column it skipped is left
 * out (and says why); a column it did not mention keeps People's. Choices
 * always come from the file, and a default's value too: the model saw
 * neither. One answer per chunk of columns; an answer that is not the
 * envelope at all counts as one unreadable item.
 */
export function withModel(
  local: readonly Omit<ColumnProposal, 'key'>[],
  answers: readonly unknown[],
  sections: readonly { readonly key: string; readonly label: string }[],
  seen: readonly ColumnSeen[],
): { proposals: Omit<ColumnProposal, 'key'>[]; summary: string | null; unreadable: number } {
  const byColumn = new Map(local.map((p) => [p.column, p]));
  let summary: string | null = null;
  let unreadable = 0;
  for (const raw of answers) {
    const answer = ModelAnswer.safeParse(raw);
    if (!answer.success) {
      unreadable += 1;
      continue;
    }
    summary ??= answer.data.summary ?? null;
    for (const item of answer.data.skipped) {
      const skip = SkipColumn.safeParse(item);
      const was = skip.success ? byColumn.get(skip.data.column) : undefined;
      if (skip.success && was)
        byColumn.set(skip.data.column, { ...was, include: false, why: skip.data.why });
      else unreadable += 1;
    }
    for (const item of answer.data.proposals) {
      const proposed = ProposeField.safeParse(item);
      const was = proposed.success ? byColumn.get(proposed.data.column) : undefined;
      if (!proposed.success || was === undefined) {
        unreadable += 1;
        continue;
      }
      const p = proposed.data;
      // Special category stays as People's rules keep it: the model cannot lower it.
      if (was.field.classification === 'special-category') continue;
      const special = p.field.classification === 'special-category';
      const column = seen.find((s) => s.column === p.column);
      const placement: Placement =
        p.sectionKey !== undefined && sections.some((s) => s.key === p.sectionKey)
          ? { sectionKey: p.sectionKey }
          : p.newSection === undefined
            ? was.placement
            : { newSection: p.newSection };
      const forExisting: ForExisting =
        p.forExisting === 'default'
          ? column?.single == null
            ? { kind: 'leave' }
            : { kind: 'default', value: column.single }
          : { kind: p.forExisting };
      // The values decided a date, a number, an amount, a code: the model saw
      // only their shape, so it names the field and People keeps the type.
      const typed = !LOOSE.has(was.field.dataType);
      const { options: _o, country: _c, decimals: _d, ...named } = p.field;
      const asked: NewField = typed
        ? {
            ...named,
            dataType: was.field.dataType,
            ...(was.field.options === undefined ? {} : { options: was.field.options }),
            ...(was.field.country === undefined ? {} : { country: was.field.country }),
            ...(was.field.decimals === undefined ? {} : { decimals: was.field.decimals }),
          }
        : {
            ...p.field,
            ...(p.field.dataType === 'select' || p.field.dataType === 'multi_select'
              ? { options: [...(column?.local.options ?? [])] }
              : {}),
          };
      // Never less protection than People's rules give it.
      const guarded: NewField = special
        ? {
            ...asked,
            ownership: ['hr'],
            visibility: ['hr'],
            classification: 'special-category',
            piiKind: 'health',
            encrypted: true,
            aiEligible: false,
            requiresApproval: true,
          }
        : RANK[asked.classification] < RANK[was.field.classification]
          ? {
              ...asked,
              ownership: was.field.ownership,
              visibility: was.field.visibility,
              classification: was.field.classification,
              piiKind: was.field.piiKind,
              encrypted: was.field.encrypted,
              aiEligible: was.field.aiEligible,
              ...(was.field.requiresApproval === undefined
                ? {}
                : { requiresApproval: was.field.requiresApproval }),
            }
          : asked;
      const { field, note } = fitted(guarded, was.header);
      const why = special ? SPECIAL : p.why;
      byColumn.set(p.column, {
        ...was,
        field,
        placement,
        why: note === null ? why : `${note} ${why}`,
        forExisting: special ? { kind: 'leave' } : forExisting,
        forExistingWhy: special ? 'Volunteered, never chased.' : p.forExistingWhy,
      });
    }
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
 * only, if at all; a default, as marked. HR writes the file's values, so HR
 * always fills it in and sees it, whatever else was chosen.
 */
export function asDefinition(p: ColumnProposal): {
  readonly ownership: NewField['ownership'];
  readonly visibility: NewField['visibility'];
  readonly requiredness:
    { mode: 'never' } | { mode: 'always'; appliesTo: 'all_records' | 'new_records' };
} {
  const add = <T>(list: readonly T[], ...xs: T[]): T[] => [...new Set([...list, ...xs])];
  const asked = p.forExisting.kind === 'ask';
  const requiredness =
    asked || p.forExisting.kind === 'hr'
      ? ({ mode: 'always', appliesTo: 'all_records' } as const)
      : p.forExisting.kind === 'new'
        ? ({ mode: 'always', appliesTo: 'new_records' } as const)
        : p.field.required
        ? ({
            mode: 'always',
            appliesTo: p.forExisting.kind === 'leave' ? 'new_records' : 'all_records',
          } as const)
        : ({ mode: 'never' } as const);
  return {
    ownership: asked ? add(p.field.ownership, 'employee', 'hr') : add(p.field.ownership, 'hr'),
    visibility: asked ? add(p.field.visibility, 'self', 'hr') : add(p.field.visibility, 'hr'),
    requiredness,
  };
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
  /** People who will have a value once the file is imported: the rows that carry one. */
  readonly have: number;
  /** Everybody else, after the import: people here now the file gives none, and rows without one. */
  readonly missing: number;
  /** People already here the file gives no value: who a default is written for. */
  readonly existingWithout: number;
  /** The file's own rows that reach someone without a value, by name: the first twenty. */
  readonly without: readonly string[];
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
