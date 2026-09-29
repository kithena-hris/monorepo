import * as z from 'zod';
import {
  AttributeDataType,
  ClassificationSchema,
  CollectAt,
  PiiKindSchema,
  RequirednessPredicate,
  ViewerScope,
  VisibilityRule,
  WriterRole,
  type AttributeDefinition,
} from '@kithena/contracts';

import { keyFrom } from '../schema/draft.js';

/**
 * Settings set up in words: what a model may propose, and what People makes
 * of it (docs/ai-settings.md).
 *
 * The model never writes. It answers a request with tool calls, each one a
 * change described in the shapes below; People reads them strictly — a call
 * that is not one of these shapes is dropped and counted, never guessed at —
 * resolves what they name against the settings as they are, puts them in the
 * order they can be applied in, and says each one in words for the
 * administrator to review. Applying is the administrator's act, through the
 * same commands the screens use, and every one of them checks again.
 *
 * Pure: no model, no database, no clock. The snapshot is what the application
 * layer read.
 */

/* ----------------------------------------------------------- snapshot -- */

/** The settings a plan is made against and read back from. Never a person's values. */
export interface SettingsSnapshot {
  /** Live sections, in order. */
  readonly sections: readonly {
    readonly key: string;
    readonly label: string;
    readonly origin: string;
  }[];
  /** Live draft fields, each section's in order. */
  readonly fields: readonly AttributeDefinition[];
  /** What is published, by key: the draft may be ahead of it. */
  readonly published: {
    readonly version: number;
    readonly fieldKeys: readonly string[];
  } | null;
  readonly organisation: {
    readonly defaultTimeZone: string;
    readonly cohortMinimum: number;
    readonly entities: readonly {
      readonly id: string;
      readonly name: string;
      readonly country: string;
      readonly timeZone: string;
      readonly numbering: {
        readonly prefix: string;
        readonly digits: number;
        readonly next: number;
      } | null;
    }[];
    readonly locations: readonly {
      readonly id: string;
      readonly name: string;
      readonly country: string;
      readonly legalEntityId: string;
      readonly timeZone: string;
    }[];
  };
  /**
   * Who holds which role, for resolving a grant or a revocation by name. Read
   * here and never sent to a model: the model says the name the administrator
   * typed, and People finds the account.
   */
  readonly people: readonly {
    readonly accountId: string;
    readonly name: string | null;
    readonly roles: readonly string[];
  }[];
  readonly viewerAccountId: string;
}

/* ------------------------------------------------------------ changes -- */

const Key = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/u, 'a key is lower-case letters, digits and underscores');
const Name = z.string().trim().min(1).max(200);
const Zone = z
  .string()
  .min(1)
  .max(64)
  .describe('An IANA time zone, such as Europe/Madrid. Never an offset.');
const Country = z
  .string()
  .regex(/^[A-Z]{2}$/u)
  .describe('ISO 3166-1 alpha-2, upper case: ES, GB, DE');
const Role = z.enum(['hr', 'finance', 'people_admin']);
export const PACK_COUNTRIES = ['ES', 'GB', 'DE', 'IN', 'US'] as const;

/**
 * A field as the field editor describes one (`FieldInput`), plus the country
 * and scheme a national identifier or a bank account is checked against.
 */
const fieldShape = {
  key: Key.optional().describe(
    'The field’s key. For a new field, leave it out and People makes one from the label.',
  ),
  sectionKey: z
    .string()
    .min(1)
    .max(120)
    .describe(
      'The section it is in: an existing section’s key, or the key or name of a section this plan adds',
    ),
  label: Name.describe('What people see'),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .describe('Help text shown under the field; null for none'),
  dataType: AttributeDataType,
  options: z
    .array(z.string().trim().min(1).max(200))
    .max(200)
    .optional()
    .describe('The choices, in order: for select and multi_select only'),
  country: Country.nullable()
    .optional()
    .describe('Required for national_id and bank_account: whose rules check the value'),
  scheme: z
    .string()
    .max(32)
    .nullable()
    .optional()
    .describe(
      'For national_id: which identifier (nif, naf, nino, steuer_id, sv_nummer, pan, uan, ssn)',
    ),
  requiredness: z.enum(['never', 'always', 'conditional']),
  requiredWhen: RequirednessPredicate.nullable()
    .optional()
    .describe('Only with conditional: when it is required'),
  ownership: z.array(WriterRole).min(1).max(6).describe('Who fills it in'),
  visibility: z.array(ViewerScope).max(7).describe('Who sees it'),
  visibilityRules: z
    .array(VisibilityRule)
    .max(5)
    .optional()
    .describe('Rarely needed: who else sees it, on the records a condition holds for'),
  collectAt: CollectAt.describe('When it is asked for'),
  classification: ClassificationSchema.describe(
    'public: fine in a directory; internal: ordinary business data; confidential: would harm if disclosed; special-category: GDPR Article 9 (health, religion, ethnicity, union, sex life, biometrics)',
  ),
  piiKind: PiiKindSchema,
  encrypted: z
    .boolean()
    .optional()
    .describe(
      'Stored sealed. Always for bank accounts, national identifiers and financial data; once on, never off',
    ),
  aiEligible: z
    .boolean()
    .optional()
    .describe(
      'Whether the AI assistant may use the field’s name and choices. Only ever for public or internal data',
    ),
};

export const FieldSpec = z.strictObject(fieldShape);
export type FieldSpec = z.infer<typeof FieldSpec>;
const { key: _key, ...patchable } = fieldShape;
export const FieldPatch = z.strictObject(patchable).partial();
export type FieldPatch = z.infer<typeof FieldPatch>;

/** Each change, keyed by the tool a model calls to propose it. */
const CHANGES = {
  add_section: z.strictObject({
    label: Name,
    key: Key.optional().describe(
      'Only when the request gives one; otherwise People makes it from the label',
    ),
  }),
  rename_section: z.strictObject({ sectionKey: z.string().max(120), label: Name }),
  reorder_sections: z.strictObject({
    order: z
      .array(z.string().max(120))
      .min(1)
      .max(100)
      .describe('Every live section’s key, in the new order'),
  }),
  remove_section: z.strictObject({ sectionKey: z.string().max(120) }),
  add_field: z.strictObject({
    field: FieldSpec,
    column: z
      .int()
      .min(0)
      .max(1000)
      .optional()
      .describe('Only when proposing a field for a spreadsheet column: the column’s index'),
  }),
  edit_field: z.strictObject({
    key: Key,
    changes: FieldPatch.describe('Only what changes; leave out what stays'),
  }),
  remove_field: z.strictObject({ key: Key }),
  reorder_fields: z.strictObject({
    sectionKey: z.string().max(120),
    order: z
      .array(Key)
      .min(1)
      .max(200)
      .describe('Every field’s key in that section, in the new order'),
  }),
  add_legal_entity: z.strictObject({ name: Name, country: Country, timeZone: Zone }),
  edit_legal_entity: z.strictObject({
    legalEntity: z.string().max(200).describe('Its id, or its name'),
    name: Name.optional(),
    timeZone: Zone.optional(),
  }),
  add_location: z.strictObject({
    name: Name,
    country: Country,
    timeZone: Zone,
    legalEntity: z
      .string()
      .max(200)
      .describe(
        'The legal entity it belongs to: an id, or the name of an existing entity or one this plan adds',
      ),
  }),
  edit_location: z.strictObject({
    location: z.string().max(200).describe('Its id, or its name'),
    name: Name,
  }),
  set_numbering: z.strictObject({
    legalEntity: z
      .string()
      .max(200)
      .describe('An id, or the name of an existing entity or one this plan adds'),
    prefix: z.string().max(10).describe('Up to ten letters, digits or hyphens: ES-'),
    digits: z.int().min(1).max(12).describe('Zero-padded to this many digits'),
    start: z.int().min(1).describe('Where the sequence starts; never moves back'),
  }),
  set_default_time_zone: z.strictObject({ timeZone: Zone }),
  set_cohort_minimum: z.strictObject({
    minimum: z
      .int()
      .min(10)
      .max(1000)
      .describe('The smallest group a report describes; raised, never lowered'),
  }),
  add_country_pack: z.strictObject({ country: z.enum(PACK_COUNTRIES) }),
  grant_role: z.strictObject({
    person: Name.describe('The person, by name, as the request names them'),
    role: Role,
  }),
  revoke_role: z.strictObject({
    person: Name.describe('The person, by name, as the request names them'),
    role: Role,
  }),
} as const;

export type ChangeKind = keyof typeof CHANGES;
export const CHANGE_KINDS = Object.keys(CHANGES) as ChangeKind[];
export type Change = {
  [K in ChangeKind]: { readonly kind: K } & z.infer<(typeof CHANGES)[K]>;
}[ChangeKind];

export function readChange(value: unknown): Change | null {
  if (typeof value !== 'object' || value === null) return null;
  const { kind, ...input } = value as { kind?: unknown };
  if (typeof kind !== 'string' || !Object.hasOwn(CHANGES, kind)) return null;
  const parsed = CHANGES[kind as ChangeKind].safeParse(input);
  return parsed.success ? ({ kind, ...parsed.data } as Change) : null;
}

/** What is not a change: something People will not do here, and the end of the plan. */
export const CannotDo = z.strictObject({
  request: z.string().trim().min(1).max(300).describe('What was asked, in a few words'),
  area: z.enum(['integrations', 'webhooks', 'provisioning', 'chat_apps', 'other']),
});
export const FinishPlan = z.strictObject({
  summary: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe('One sentence saying what the plan does, naming no person and no value'),
});

/** Where each area's page is, for a refusal to link to. */
export const REFUSED_HREF = {
  integrations: '/settings/people/integrations',
  webhooks: '/settings/people/integrations?tab=webhooks',
  provisioning: '/settings/people/integrations?tab=provisioning',
  chat_apps: '/settings/people/integrations?tab=chat',
  other: '/settings',
} as const;

/* -------------------------------------------------------------- tools -- */

export interface SettingsTool {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType;
}

const TOOL_WORDS: Record<ChangeKind | 'cannot_do' | 'finish_plan', string> = {
  add_section: 'Propose a new section of employee fields.',
  rename_section: 'Propose renaming a section. Its key and fields stay.',
  reorder_sections: 'Propose a new order for the sections.',
  remove_section:
    'Propose removing (archiving) a section. Refused while it holds a required field.',
  add_field: 'Propose a new employee field, with everything about it.',
  edit_field: 'Propose changing an existing field. Its key never changes.',
  remove_field: 'Propose removing (archiving) a company-defined field. Values are kept.',
  reorder_fields: 'Propose a new order for the fields in one section.',
  add_legal_entity: 'Propose a new legal entity: the employer of record.',
  edit_legal_entity: 'Propose renaming a legal entity or changing its default time zone.',
  add_location: 'Propose a new work location in a legal entity.',
  edit_location: 'Propose renaming a work location.',
  set_numbering: 'Propose employee numbering for a legal entity.',
  set_default_time_zone: 'Propose the company’s default time zone.',
  set_cohort_minimum:
    'Propose raising the smallest group reports describe (completeness and reporting).',
  add_country_pack: 'Propose adding a country’s pack of identifiers and fields to the draft.',
  grant_role: 'Propose giving a person a role. Always confirmed by the administrator.',
  revoke_role: 'Propose taking a role from a person. Always confirmed by the administrator.',
  cannot_do:
    'Say that part of the request is something you may not do here: integrations, webhooks, provisioning (SCIM), chat apps, or anything needing a secret or a token.',
  finish_plan: 'Finish: call once, last, with a one-sentence summary of the whole plan.',
};

/** The tools a model is offered: one per change, then the two that are not changes. */
export const SETTINGS_TOOLS: readonly SettingsTool[] = [
  ...CHANGE_KINDS.map((name) => ({ name, description: TOOL_WORDS[name], input: CHANGES[name] })),
  { name: 'cannot_do', description: TOOL_WORDS.cannot_do, input: CannotDo },
  { name: 'finish_plan', description: TOOL_WORDS.finish_plan, input: FinishPlan },
];

/* --------------------------------------------------------------- plan -- */

export type Area = 'fields' | 'organisation' | 'reminders' | 'packs' | 'roles';

export interface PlannedChange {
  readonly id: string;
  readonly change: Change;
  readonly area: Area;
  /** "Add a field", "Rename a section". */
  readonly title: string;
  /** What it names: "IBAN in Bank details". */
  readonly subject: string;
  /** How it is now, in words; null for something new. */
  readonly before: string | null;
  /** How it will be. */
  readonly after: string;
  /** Why the administrator must tick it on purpose; null when an ordinary change. */
  readonly confirm: string | null;
  /** Why it cannot be applied as it is; null when it can. */
  readonly problem: string | null;
}

export interface Plan {
  readonly summary: string;
  readonly changes: readonly PlannedChange[];
  /** What was asked that People will not do here, and where it is done instead. */
  readonly refused: readonly { readonly request: string; readonly href: string }[];
  /** Tool calls that were not one of the shapes above: left out, and counted. */
  readonly unreadable: number;
}

export interface ToolCall {
  readonly name: string;
  readonly input: unknown;
}

/** The order changes can be applied in: what later ones name comes first. */
const APPLY_ORDER: readonly ChangeKind[] = [
  'add_country_pack',
  'add_section',
  'rename_section',
  'add_field',
  'edit_field',
  'remove_field',
  'remove_section',
  'reorder_sections',
  'reorder_fields',
  'add_legal_entity',
  'edit_legal_entity',
  'set_numbering',
  'add_location',
  'edit_location',
  'set_default_time_zone',
  'set_cohort_minimum',
  'grant_role',
  'revoke_role',
];

const AREA: Record<ChangeKind, Area> = {
  add_section: 'fields',
  rename_section: 'fields',
  reorder_sections: 'fields',
  remove_section: 'fields',
  add_field: 'fields',
  edit_field: 'fields',
  remove_field: 'fields',
  reorder_fields: 'fields',
  add_legal_entity: 'organisation',
  edit_legal_entity: 'organisation',
  add_location: 'organisation',
  edit_location: 'organisation',
  set_numbering: 'organisation',
  set_default_time_zone: 'organisation',
  set_cohort_minimum: 'reminders',
  add_country_pack: 'packs',
  grant_role: 'roles',
  revoke_role: 'roles',
};

/**
 * What a model answered, as a plan: every call read strictly, the changes in
 * the order they apply, each resolved against the settings and said in words.
 */
export function readPlan(calls: readonly ToolCall[], snapshot: SettingsSnapshot): Plan {
  let unreadable = 0;
  let summary = '';
  const refused: { request: string; href: string }[] = [];
  const changes: Change[] = [];
  for (const call of calls) {
    if (call.name === 'finish_plan') {
      const done = FinishPlan.safeParse(call.input);
      if (done.success) summary = done.data.summary;
      else unreadable += 1;
      continue;
    }
    if (call.name === 'cannot_do') {
      const no = CannotDo.safeParse(call.input);
      if (no.success) refused.push({ request: no.data.request, href: REFUSED_HREF[no.data.area] });
      else unreadable += 1;
      continue;
    }
    const change = readChange({ ...(call.input as object), kind: call.name });
    if (change === null) unreadable += 1;
    else changes.push(change);
  }
  return {
    summary: summary || defaultSummary(changes.length),
    changes: planChanges(changes, snapshot),
    refused,
    unreadable,
  };
}

const defaultSummary = (n: number): string =>
  n === 0 ? 'No changes.' : `${String(n)} ${n === 1 ? 'change' : 'changes'} to the settings.`;

/**
 * Changes, in applying order, resolved and said. Also how an edited plan is
 * read again before it is applied: the ids are the changes' own when they
 * have them.
 */
export function planChanges(
  changes: readonly (Change & { readonly id?: string })[],
  snapshot: SettingsSnapshot,
): PlannedChange[] {
  const ordered = changes
    .map((c, i) => ({ c, i }))
    .toSorted((a, b) => APPLY_ORDER.indexOf(a.c.kind) - APPLY_ORDER.indexOf(b.c.kind) || a.i - b.i);
  const world = worldOf(snapshot);
  return ordered.map(({ c }, n) => {
    const { id, ...rest } = c as Change & { id?: string };
    const change = resolved(rest, world);
    const words = say(change, world, snapshot);
    const planned: PlannedChange = {
      id: id ?? `c${String(n + 1)}`,
      change,
      area: AREA[change.kind],
      ...words,
      confirm: confirmOf(change, world),
      problem: problemOf(change, world, snapshot),
    };
    grow(world, planned.change);
    return planned;
  });
}

/**
 * A change with what it names by name written as keys and ids, where they
 * resolve: "Bank" becomes `bank`, an existing entity's name its id. A new
 * section is named by its key, which is its name's; a new entity keeps its
 * name, which is resolved once it exists.
 */
function resolved(change: Change, world: World): Change {
  const section = (named: string): string => sectionKeyIn(named, world.sections) ?? named;
  const entity = (named: string): string => entityIn(named, world.entities)?.id ?? named;
  switch (change.kind) {
    case 'rename_section':
    case 'remove_section':
    case 'reorder_fields':
      return { ...change, sectionKey: section(change.sectionKey) };
    case 'reorder_sections':
      return { ...change, order: change.order.map(section) };
    case 'add_field':
      return {
        ...change,
        field: { ...change.field, sectionKey: section(change.field.sectionKey) },
      };
    case 'edit_field':
      return change.changes.sectionKey === undefined
        ? change
        : {
            ...change,
            changes: { ...change.changes, sectionKey: section(change.changes.sectionKey) },
          };
    case 'edit_legal_entity':
    case 'set_numbering':
    case 'add_location':
      return { ...change, legalEntity: entity(change.legalEntity) };
    default:
      return change;
  }
}

/* ---------------------------------------------------- resolving names -- */

interface World {
  /** Section key → label, live and planned. */
  readonly sections: Map<string, string>;
  readonly fields: Map<string, FieldSpec>;
  /** Legal entities by id and by lower-cased name; planned ones by name only. */
  readonly entities: Map<string, { readonly id: string | null; readonly name: string }>;
  readonly locations: Map<string, { readonly id: string; readonly name: string }>;
}

const lower = (s: string): string => s.trim().toLocaleLowerCase('en');

function worldOf(s: SettingsSnapshot): World {
  const entities = new Map<string, { id: string | null; name: string }>();
  for (const e of s.organisation.entities) {
    entities.set(e.id, { id: e.id, name: e.name });
    entities.set(lower(e.name), { id: e.id, name: e.name });
  }
  const locations = new Map<string, { id: string; name: string }>();
  for (const l of s.organisation.locations) {
    locations.set(l.id, { id: l.id, name: l.name });
    locations.set(lower(l.name), { id: l.id, name: l.name });
  }
  return {
    sections: new Map(s.sections.map((x) => [x.key, x.label])),
    fields: new Map(s.fields.map((f) => [f.key as string, specOf(f)])),
    entities,
    locations,
  };
}

/** A section a change names, by key, by a new section's key, or by name. */
export function sectionKeyIn(named: string, sections: ReadonlyMap<string, string>): string | null {
  if (sections.has(named)) return named;
  const byName = [...sections].find(([, label]) => lower(label) === lower(named));
  if (byName) return byName[0];
  const derived = keyFrom(named);
  return sections.has(derived) ? derived : null;
}

function grow(world: World, change: Change): void {
  switch (change.kind) {
    case 'add_section':
      world.sections.set(change.key ?? keyFrom(change.label), change.label);
      break;
    case 'rename_section': {
      const key = sectionKeyIn(change.sectionKey, world.sections);
      if (key !== null) world.sections.set(key, change.label);
      break;
    }
    case 'remove_section': {
      const key = sectionKeyIn(change.sectionKey, world.sections);
      if (key !== null) world.sections.delete(key);
      break;
    }
    case 'add_field':
      world.fields.set(change.field.key ?? keyFrom(change.field.label), change.field);
      break;
    case 'edit_field': {
      const was = world.fields.get(change.key);
      if (was) world.fields.set(change.key, patched(was, change.changes));
      break;
    }
    case 'remove_field':
      world.fields.delete(change.key);
      break;
    case 'add_legal_entity':
      if (!world.entities.has(lower(change.name))) {
        world.entities.set(lower(change.name), { id: null, name: change.name });
      }
      break;
    default:
      break;
  }
}

/** A legal entity a change names: an id, or a name the settings or the plan hold. */
export function entityIn(
  named: string,
  entities: ReadonlyMap<string, { readonly id: string | null; readonly name: string }>,
): { readonly id: string | null; readonly name: string } | null {
  return entities.get(named) ?? entities.get(lower(named)) ?? null;
}

/** The person a role change names: exactly one, or why not. */
export function personIn(
  named: string,
  people: SettingsSnapshot['people'],
):
  | { readonly accountId: string; readonly name: string; readonly roles: readonly string[] }
  | string {
  const found = people.filter((p) => p.name !== null && lower(p.name) === lower(named));
  const loose =
    found.length > 0
      ? found
      : people.filter((p) => p.name !== null && lower(p.name).includes(lower(named)));
  const [one, two] = loose;
  if (one === undefined || one.name === null) return `Nobody here is called ${named}`;
  if (two !== undefined)
    return `More than one person is called ${named}: choose them on the roles page`;
  return { accountId: one.accountId, name: one.name, roles: one.roles };
}

/* --------------------------------------------------------------- words -- */

export const WRITER_WORDS: Readonly<Record<string, string>> = {
  employee: 'the employee',
  manager: 'their manager',
  hr: 'HR',
  finance: 'finance',
  system: 'an integration',
  external: 'an outside system',
};
export const SCOPE_WORDS: Readonly<Record<string, string>> = {
  self: 'the employee',
  manager: 'their manager',
  manager_chain: 'managers above them',
  hr: 'HR',
  finance: 'finance',
  admin: 'People administrators',
  directory: 'everyone in the directory',
};
export const ROLE_WORDS: Readonly<Record<string, string>> = {
  hr: 'HR',
  finance: 'Finance',
  people_admin: 'People administrator',
};
const COLLECT_WORDS: Readonly<Record<string, string>> = {
  signup: 'at sign-up',
  enrolment: 'at enrolment',
  onboarding: 'during onboarding',
  hr_only: 'by HR only',
  anytime: 'any time',
};

export const joined = (words: readonly string[]): string =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;

const typeWords = (f: Pick<FieldSpec, 'dataType' | 'country'>): string =>
  `${f.dataType.replaceAll('_', ' ')}${f.country ? ` (${f.country})` : ''}`;

/** A field in one line: type, requiredness, who fills it in and who sees it. */
export function fieldWords(f: FieldSpec): string {
  const need =
    f.requiredness === 'always'
      ? 'required'
      : f.requiredness === 'conditional'
        ? 'required on some records'
        : 'optional';
  const seen =
    f.visibility.length === 0
      ? 'nobody individually'
      : joined(f.visibility.map((v) => SCOPE_WORDS[v] ?? v));
  return [
    typeWords(f),
    need,
    `filled in by ${joined(f.ownership.map((w) => WRITER_WORDS[w] ?? w))}`,
    `seen by ${seen}`,
    `asked ${COLLECT_WORDS[f.collectAt] ?? f.collectAt}`,
    f.classification,
  ].join(' · ');
}

function say(
  change: Change,
  world: World,
  snapshot: SettingsSnapshot,
): { title: string; subject: string; before: string | null; after: string } {
  const sectionLabel = (named: string): string => {
    const key = sectionKeyIn(named, world.sections);
    return key === null ? named : (world.sections.get(key) ?? named);
  };
  const entityName = (named: string): string => entityIn(named, world.entities)?.name ?? named;
  switch (change.kind) {
    case 'add_section':
      return { title: 'Add a section', subject: change.label, before: null, after: change.label };
    case 'rename_section':
      return {
        title: 'Rename a section',
        subject: sectionLabel(change.sectionKey),
        before: sectionLabel(change.sectionKey),
        after: change.label,
      };
    case 'reorder_sections':
      return {
        title: 'Reorder the sections',
        subject: 'Sections',
        before: joined([...world.sections.values()]),
        after: joined(change.order.map(sectionLabel)),
      };
    case 'remove_section':
      return {
        title: 'Remove a section',
        subject: sectionLabel(change.sectionKey),
        before: sectionLabel(change.sectionKey),
        after: 'Removed; its values are kept',
      };
    case 'add_field':
      return {
        title: 'Add a field',
        subject: `${change.field.label} in ${sectionLabel(change.field.sectionKey)}`,
        before: null,
        after: fieldWords(change.field),
      };
    case 'edit_field': {
      const was = world.fields.get(change.key);
      return {
        title: 'Change a field',
        subject: was?.label ?? change.key,
        before: was ? fieldWords(was) : null,
        after: was
          ? fieldWords(patched(was, change.changes))
          : Object.keys(change.changes).join(', '),
      };
    }
    case 'remove_field': {
      const was = world.fields.get(change.key);
      return {
        title: 'Remove a field',
        subject: was?.label ?? change.key,
        before: was ? fieldWords(was) : null,
        after: 'Removed from forms; its values are kept',
      };
    }
    case 'reorder_fields':
      return {
        title: 'Reorder fields',
        subject: sectionLabel(change.sectionKey),
        before: null,
        after: joined(change.order.map((k) => world.fields.get(k)?.label ?? k)),
      };
    case 'add_legal_entity':
      return {
        title: 'Add a legal entity',
        subject: change.name,
        before: null,
        after: `${change.name} · ${change.country} · ${change.timeZone}`,
      };
    case 'edit_legal_entity': {
      const was = snapshot.organisation.entities.find(
        (e) => e.id === entityIn(change.legalEntity, world.entities)?.id,
      );
      return {
        title: 'Change a legal entity',
        subject: entityName(change.legalEntity),
        before: was ? `${was.name} · ${was.timeZone}` : null,
        after: `${change.name ?? was?.name ?? change.legalEntity} · ${change.timeZone ?? was?.timeZone ?? ''}`,
      };
    }
    case 'add_location':
      return {
        title: 'Add a work location',
        subject: change.name,
        before: null,
        after: `${change.name} · ${entityName(change.legalEntity)} · ${change.country} · ${change.timeZone}`,
      };
    case 'edit_location': {
      const was =
        world.locations.get(change.location) ?? world.locations.get(lower(change.location));
      return {
        title: 'Rename a work location',
        subject: was?.name ?? change.location,
        before: was?.name ?? null,
        after: change.name,
      };
    }
    case 'set_numbering': {
      const id = entityIn(change.legalEntity, world.entities)?.id;
      const was = snapshot.organisation.entities.find((e) => e.id === id)?.numbering;
      const sample = `${change.prefix}${String(change.start).padStart(change.digits, '0')}`;
      return {
        title: 'Set employee numbering',
        subject: entityName(change.legalEntity),
        before: was ? `${was.prefix}${String(was.next).padStart(was.digits, '0')} next` : null,
        after: `Starts at ${sample}`,
      };
    }
    case 'set_default_time_zone':
      return {
        title: 'Change the default time zone',
        subject: 'Company',
        before: snapshot.organisation.defaultTimeZone,
        after: change.timeZone,
      };
    case 'set_cohort_minimum':
      return {
        title: 'Raise the smallest group reported',
        subject: 'Completeness and reporting',
        before: String(snapshot.organisation.cohortMinimum),
        after: String(change.minimum),
      };
    case 'add_country_pack':
      return {
        title: 'Add a country pack',
        subject: change.country,
        before: null,
        after: `${change.country}’s identifiers and fields, in the draft`,
      };
    case 'grant_role':
    case 'revoke_role': {
      const who = personIn(change.person, snapshot.people);
      const name = typeof who === 'string' ? change.person : who.name;
      const role = ROLE_WORDS[change.role] ?? change.role;
      return {
        title: change.kind === 'grant_role' ? 'Grant a role' : 'Remove a role',
        subject: `${role} for ${name}`,
        before:
          typeof who === 'string'
            ? null
            : joined(who.roles.map((r) => ROLE_WORDS[r] ?? r)) || 'No role',
        after: change.kind === 'grant_role' ? `${name} is ${role}` : `${name} is no longer ${role}`,
      };
    }
  }
}

/* ------------------------------------------------------- confirmation -- */

const CLASSIFICATION_RANK = {
  public: 0,
  internal: 1,
  confidential: 2,
  'special-category': 3,
} as const;

/** Why a field needs ticking on purpose, or null for an ordinary one. */
export function sensitivity(
  f: Pick<FieldSpec, 'classification' | 'piiKind' | 'dataType'>,
): string | null {
  if (
    f.classification === 'special-category' ||
    f.piiKind === 'health' ||
    f.piiKind === 'biometric'
  ) {
    return 'Special-category data (GDPR Article 9): check who sees it before you apply it.';
  }
  if (f.piiKind === 'financial' || f.dataType === 'bank_account') {
    return 'Financial data: stored encrypted; check who sees it before you apply it.';
  }
  if (f.dataType === 'national_id') {
    return 'A national identifier: stored encrypted; check who sees it before you apply it.';
  }
  return null;
}

/** Why a change must be ticked on purpose: sensitive data, a loosening, a role. Null otherwise. */
export function confirmOf(change: Change, world: Pick<World, 'fields'>): string | null {
  switch (change.kind) {
    case 'add_field':
      return sensitivity(change.field);
    case 'edit_field': {
      const was = world.fields.get(change.key);
      if (!was) return null;
      const next = patched(was, change.changes);
      if (CLASSIFICATION_RANK[next.classification] < CLASSIFICATION_RANK[was.classification]) {
        return `Makes ${was.label} less protected (${was.classification} → ${next.classification}).`;
      }
      const touchesAccess = [
        'visibility',
        'ownership',
        'classification',
        'piiKind',
        'dataType',
      ].some((k) => Object.hasOwn(change.changes, k));
      return touchesAccess ? sensitivity(next) : null;
    }
    case 'grant_role':
    case 'revoke_role':
      return 'A change to who holds a role: it takes effect for them straight away.';
    default:
      return null;
  }
}

/* ------------------------------------------------------------ problems -- */

function problemOf(change: Change, world: World, snapshot: SettingsSnapshot): string | null {
  const noSection = (named: string): string | null =>
    sectionKeyIn(named, world.sections) === null ? `There is no section called ${named}` : null;
  switch (change.kind) {
    case 'add_section':
      return sectionKeyIn(change.label, world.sections) === null
        ? null
        : `A section called ${change.label} already exists`;
    case 'rename_section':
    case 'remove_section':
      return noSection(change.sectionKey);
    case 'reorder_sections': {
      const keys = change.order.map((k) => sectionKeyIn(k, world.sections));
      return keys.includes(null) ? 'It names a section that does not exist' : null;
    }
    case 'add_field': {
      const key = change.field.key ?? keyFrom(change.field.label);
      if (world.fields.has(key)) return `A field called ${key} already exists`;
      return noSection(change.field.sectionKey);
    }
    case 'edit_field':
    case 'remove_field':
      return world.fields.has(change.key) ? null : `There is no field called ${change.key}`;
    case 'reorder_fields':
      return (
        noSection(change.sectionKey) ??
        (change.order.every((k) => world.fields.has(k))
          ? null
          : 'It names a field that does not exist')
      );
    case 'edit_legal_entity':
    case 'set_numbering':
    case 'add_location':
      return entityIn(change.legalEntity, world.entities) === null
        ? `There is no legal entity called ${change.legalEntity}`
        : null;
    case 'edit_location':
      return world.locations.has(change.location) || world.locations.has(lower(change.location))
        ? null
        : `There is no work location called ${change.location}`;
    case 'set_cohort_minimum':
      return change.minimum < snapshot.organisation.cohortMinimum
        ? `It can be raised, never lowered below ${String(snapshot.organisation.cohortMinimum)}`
        : null;
    case 'grant_role':
    case 'revoke_role': {
      const who = personIn(change.person, snapshot.people);
      if (typeof who === 'string') return who;
      if (who.accountId === snapshot.viewerAccountId) {
        return 'Nobody changes their own roles: another administrator has to';
      }
      if (
        change.kind === 'revoke_role' &&
        change.role === 'people_admin' &&
        snapshot.people.filter((p) => p.roles.includes('people_admin')).length <= 1
      ) {
        return 'The last People administrator keeps the role';
      }
      return null;
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------- fields -- */

/** A field with a patch laid over it: what the patch leaves out, the field keeps. */
export function patched(field: FieldSpec, changes: FieldPatch): FieldSpec {
  const given = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
  return { ...field, ...given };
}

/** A stored field as the plan describes one: the same words back. */
export function specOf(a: AttributeDefinition): FieldSpec {
  const config = a.typeConfig as {
    kind: string;
    options?: { label: { default: string }; retiredAt: string | null }[];
    country?: string;
    scheme?: string;
  };
  return {
    key: a.key,
    sectionKey: a.sectionKey,
    label: a.label.default,
    description: a.description?.default ?? null,
    dataType: a.dataType,
    options: (config.options ?? []).filter((o) => o.retiredAt === null).map((o) => o.label.default),
    country: config.country ?? null,
    scheme: config.scheme ?? null,
    requiredness: a.requiredness.mode,
    requiredWhen: a.requiredness.mode === 'conditional' ? a.requiredness.when : null,
    ownership: [...a.ownership],
    visibility: [...a.visibility],
    visibilityRules: [...(a.visibilityRules ?? [])],
    collectAt: a.collectAt,
    classification: a.classification.classification,
    piiKind: a.classification.piiKind,
    encrypted: a.encrypted,
    aiEligible: a.classification.aiEligible,
  };
}

/* ---------------------------------------------------------- the budget -- */

/**
 * How many plans a company may ask for: `limit` in any `windowMs`, per tenant.
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
