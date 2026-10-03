import * as z from 'zod';

import {
  asContact,
  asFreeText,
  asIdentity,
  asInternal,
  asPublic,
  asSpecialCategory,
  policy,
} from '../classification.js';
import type { ModuleKey } from '../module.js';
import { keySchema } from '../people/primitives.js';
import { CalendarDate, PersonId, TenantId } from '../primitives.js';

/**
 * The vocabulary every module's capabilities are built from (assistant PRD
 * §8.1, §8.3), so the assistant can validate and join any of them without
 * knowing the module.
 *
 * A capability is a named, versioned, read-only query a module serves to the
 * assistant. `capability()` turns its declaration into three schemas:
 *
 *   - `step`, what a plan step may write: the inputs `accepts` lists, dates as
 *     references, and never `personIds` or `limit` (§9.2);
 *   - `input`, what the module is called with: dates resolved to calendar
 *     days, and the `limit`, `ids` and `personIds` only the assistant sets;
 *   - `output`, the declared result kind, plus `ambiguous` and `not_found`
 *     for a capability that takes a name.
 *
 * Every result carries a `kind`, which §8.3's table leaves implicit: a
 * profile and a not-found both hold a name, and a parser that tells them
 * apart by which other keys happen to be present is one renamed field away
 * from reading one as the other.
 */

/* ---------------------------------------------------------------- limits -- */

/** §9.3. */
export const ASSISTANT_LIMITS = {
  /** Filters per step and values per filter: People's `Intent` limits. */
  filters: 10,
  values: 20,
  /** Names listed in an answer; "the directory has the rest" beyond it. */
  listed: 25,
  /** `personIds` passed to a later step, and rows a count by group reads (§9.6). */
  ids: 5000,
  /** People's chat route's limit. */
  question: 500,
  /** Steps in a plan: every example needs at most two. */
  steps: 4,
} as const;
const {
  filters: MAX_FILTERS,
  values: MAX_VALUES,
  listed: MAX_LISTED,
  ids: MAX_IDS,
} = ASSISTANT_LIMITS;

/* ---------------------------------------------------------------- inputs -- */

/** People's operators (`domain/assistant/intent.ts`). */
export const FILTER_OPS = [
  'is',
  'in',
  'not_in',
  'contains',
  'before',
  'after',
  'between',
  'empty',
  'not_empty',
] as const;
export const FilterOp = z.enum(FILTER_OPS).register(policy, asPublic());
export type FilterOp = z.infer<typeof FilterOp>;

/** A field, metric or group key. Configuration, never a value. */
export const FieldKey = keySchema('field').register(policy, asPublic());

/** `<module>.<verb>`. */
const NAME = /^([a-z]+)\.[a-z][a-z_]*$/u;
export const CapabilityName = z.string().max(64).regex(NAME).register(policy, asPublic());

/**
 * What a filter compares with. Words from the question, which can be a name,
 * so they are free text: never logged, never sent back to a model.
 */
const filterValues = z
  .array(z.string().max(200))
  .max(MAX_VALUES)
  .default([])
  .register(policy, asFreeText());

const filterOf = (keys: true | readonly [string, ...string[]]) =>
  z.strictObject({
    key: keys === true ? FieldKey : z.enum(keys).register(policy, asPublic()),
    op: FilterOp,
    values: filterValues,
  });

export const CapabilityFilter = filterOf(true);
export type CapabilityFilter = z.infer<typeof CapabilityFilter>;

export const FilterMatch = z.enum(['all', 'any']).register(policy, asPublic());
export type FilterMatch = z.infer<typeof FilterMatch>;

/** A period stands for its whole range; weeks run Monday to Sunday (§9.4). */
export const DATE_WORDS = [
  'today',
  'tomorrow',
  'yesterday',
  'this_week',
  'next_week',
  'last_week',
  'this_month',
  'next_month',
  'last_month',
] as const;
export const DateWord = z.enum(DATE_WORDS);
export type DateWord = z.infer<typeof DateWord>;

/** A calendar date or a reference, as a plan writes it. */
export const DateRef = z.union([CalendarDate, DateWord]).register(policy, asInternal());
export type DateRef = z.infer<typeof DateRef>;

/** A plan's `on`: one reference, or a range of them. */
export const DateOn = z
  .union([DateRef, z.strictObject({ from: DateRef, to: DateRef })])
  .register(policy, asInternal());
export type DateOn = z.infer<typeof DateOn>;

/** What a module receives for `on`: resolved by the assistant, in the asker's zone. */
export const DateRange = z
  .strictObject({ from: CalendarDate, to: CalendarDate })
  .refine((r) => r.from <= r.to, { message: 'A range cannot end before it starts', path: ['to'] });
export type DateRange = z.infer<typeof DateRange>;

/** The asker, wherever a name is taken. Resolved by the module, never by the model. */
export const SELF_NAME = '@me';

/** A name as typed. Resolved by the module, as the asker may search. */
export const NameAsTyped = z.string().trim().min(1).max(120).register(policy, asIdentity());

export const CapabilitySort = z.strictObject({
  key: FieldKey,
  direction: z.enum(['asc', 'desc']).register(policy, asPublic()),
});
export type CapabilitySort = z.infer<typeof CapabilitySort>;

/** 0 for a count, 25 for a list, up to 5,000 for a count by group (§9.3, §9.6). */
const Limit = z.int().min(0).max(MAX_IDS).register(policy, asPublic());

/** Set by the assistant only, from the step's `within`. */
export const PersonIds = z.array(PersonId).max(MAX_IDS).register(policy, asIdentity());

/* --------------------------------------------------------------- outputs -- */

/** A person's id in a result: identity here, beside the name it is returned with. */
const personRef = () => z.uuid().brand<'PersonId'>().register(policy, asIdentity());
const personName = () => z.string().min(1).max(200).register(policy, asIdentity());
const title = () => z.string().max(200).register(policy, asIdentity());

/**
 * One person in a result.
 *
 * `detail` is the module's own short text for the row ("Mon 12 to Wed 14 ·
 * Vacation"). It can hold a leave type, which for sick or parental leave is
 * health data, and the schema cannot know which type a row holds, so it is
 * special-category whatever it says (§8.2).
 */
export const PersonRow = z.strictObject({
  personId: personRef(),
  name: personName(),
  title: title().optional(),
  detail: z.string().max(200).optional().register(policy, asSpecialCategory('health')),
  /** Group key to the row's value's label, for the groups the capability declares. */
  groups: z.record(FieldKey, z.string().max(200)).default({}).register(policy, asInternal()),
});
export type PersonRow = z.infer<typeof PersonRow>;

export const PeopleResult = z.strictObject({
  kind: z.literal('people').register(policy, asPublic()),
  rows: z.array(PersonRow).max(MAX_IDS),
  /** Every matching id, only when the assistant asked because a later step needs it. */
  ids: PersonIds.optional(),
  total: z.int().min(0).register(policy, asInternal()),
  /** `visible` when the asker sees only part of the company. Never implied otherwise. */
  scope: z.enum(['everyone', 'visible']).register(policy, asPublic()),
  /** The module's phrase for what the step selected. */
  described: z.string().max(240).register(policy, asInternal()),
  /** The module's deterministic sentences about the result. */
  notes: z.array(z.string().max(240)).max(5).default([]).register(policy, asInternal()),
});
export type PeopleResult = z.infer<typeof PeopleResult>;

export const ProfileResult = z.strictObject({
  kind: z.literal('profile').register(policy, asPublic()),
  personId: personRef(),
  name: personName(),
  title: title().optional(),
  /** The manager's name. */
  manager: personName().optional(),
  hireDate: CalendarDate.optional(),
  email: z.email().optional().register(policy, asContact()),
  /** The asker asked about themselves. */
  self: z.boolean().register(policy, asPublic()),
});
export type ProfileResult = z.infer<typeof ProfileResult>;

export const ItemsResult = z.strictObject({
  kind: z.literal('items').register(policy, asPublic()),
  items: z
    .array(
      z.strictObject({
        name: personName(),
        label: z.string().max(200).register(policy, asInternal()),
      }),
    )
    .max(MAX_LISTED),
  total: z.int().min(0).register(policy, asInternal()),
});
export type ItemsResult = z.infer<typeof ItemsResult>;

export const AmbiguousResult = z.strictObject({
  kind: z.literal('ambiguous').register(policy, asPublic()),
  name: NameAsTyped,
  candidates: z
    .array(z.strictObject({ personId: personRef(), name: personName(), title: title().optional() }))
    .max(MAX_LISTED),
});
export type AmbiguousResult = z.infer<typeof AmbiguousResult>;

/** Nobody by that name, or `self` when the asker has no record. */
export const NotFoundResult = z
  .strictObject({
    kind: z.literal('not_found').register(policy, asPublic()),
    name: NameAsTyped.optional(),
    self: z.literal(true).optional().register(policy, asPublic()),
  })
  .refine((r) => (r.name === undefined) !== (r.self === undefined), {
    message: 'Not found is a name or the asker, never both',
  });
export type NotFoundResult = z.infer<typeof NotFoundResult>;

export const CapabilityOutput = z.discriminatedUnion('kind', [
  PeopleResult,
  ProfileResult,
  ItemsResult,
  AmbiguousResult,
  NotFoundResult,
]);
export type CapabilityOutput = z.infer<typeof CapabilityOutput>;

const RESULTS = { people: PeopleResult, profile: ProfileResult, items: ItemsResult } as const;
export type OutputKind = keyof typeof RESULTS;

/* ------------------------------------------------------------ capability -- */

/** Which shared inputs a capability takes (§8.3). Absent means not accepted. */
export interface Accepts {
  /** `true` for any field the runtime catalogue offers; a list for exactly these keys. */
  readonly filters?: true | readonly [string, ...string[]];
  readonly match?: true;
  readonly on?: true | 'required';
  readonly name?: true | 'required';
  readonly sort?: true;
  readonly groupBy?: true;
  /** The step may be narrowed to an earlier step's people; `required` when it means nothing alone. */
  readonly within?: true | 'required';
}

export interface CapabilityDefinition {
  /** `<module>.<verb>`. */
  readonly name: string;
  /** A major version (§8.6). */
  readonly version: number;
  readonly module: ModuleKey;
  /** One plain sentence the model is shown. */
  readonly about: string;
  readonly accepts: Accepts;
  /** Keys its rows may be grouped by. `field:*` is any select or location field. */
  readonly groups?: readonly string[];
  readonly output: OutputKind;
  /** What gives way, filter key or capability, to which capability, when its owner is present (§8.4). */
  readonly yields?: Readonly<Record<string, string>>;
}

/** Every input any capability may take, all optional: what a module's handler reads. */
export const AnyInput = z.strictObject({
  filters: z.array(CapabilityFilter).max(MAX_FILTERS).optional(),
  match: FilterMatch.optional(),
  on: DateRange.optional(),
  name: NameAsTyped.optional(),
  sort: CapabilitySort.optional(),
  groupBy: FieldKey.optional(),
  limit: Limit.optional(),
  ids: z.boolean().optional().register(policy, asPublic()),
  personIds: PersonIds.optional(),
});
export type CapabilityInput = z.infer<typeof AnyInput>;

export interface Capability extends Required<CapabilityDefinition> {
  readonly schemas: {
    /** What a plan step may write. */
    readonly step: z.ZodType<Record<string, unknown>>;
    /** What the module is called with. */
    readonly input: z.ZodType<CapabilityInput>;
    readonly output: z.ZodType<CapabilityOutput>;
  };
}

const optionalUnless = (flag: true | 'required', schema: z.ZodType): z.ZodType =>
  flag === 'required' ? schema : schema.optional();

/**
 * A capability from its declaration. Throws on a malformed one: these are
 * static, so a mistake fails the first test that imports it.
 */
export function capability(definition: CapabilityDefinition): Capability {
  const { name, module, accepts, output } = definition;
  if (NAME.exec(name)?.[1] !== module) {
    throw new Error(`capability ${name}: the name is <module>.<verb>, and the module is ${module}`);
  }

  const step: Record<string, z.ZodType> = {};
  const input: Record<string, z.ZodType> = {};
  if (accepts.filters !== undefined) {
    const filters = z.array(filterOf(accepts.filters)).max(MAX_FILTERS).optional();
    step['filters'] = filters;
    input['filters'] = filters;
  }
  if (accepts.match) step['match'] = input['match'] = FilterMatch.optional();
  if (accepts.on !== undefined) {
    step['on'] = optionalUnless(accepts.on, DateOn);
    input['on'] = optionalUnless(accepts.on, DateRange);
  }
  if (accepts.name !== undefined)
    step['name'] = input['name'] = optionalUnless(accepts.name, NameAsTyped);
  if (accepts.sort) step['sort'] = input['sort'] = CapabilitySort.optional();
  if (accepts.groupBy) step['groupBy'] = input['groupBy'] = FieldKey.optional();
  if (output !== 'profile') input['limit'] = Limit;
  if (output === 'people') input['ids'] = AnyInput.shape.ids;
  if (accepts.within !== undefined) input['personIds'] = optionalUnless(accepts.within, PersonIds);

  const result = RESULTS[output];
  return {
    groups: [],
    yields: {},
    ...definition,
    schemas: {
      step: z.strictObject(step),
      // Built from `accepts`, so its static type is a record; every key in it is
      // one of `AnyInput`'s, with the same schema or a stricter one.
      input: z.strictObject(input),
      output:
        accepts.name === undefined
          ? result
          : z.discriminatedUnion('kind', [result, AmbiguousResult, NotFoundResult]),
    },
  };
}

/* ------------------------------------------------------ question, answer -- */

export const AssistantChannel = z.enum(['slack', 'teams', 'web']).register(policy, asPublic());
export type AssistantChannel = z.infer<typeof AssistantChannel>;

/** What a channel sends the assistant: `POST /internal/ask`. */
export const AssistantQuestion = z.strictObject({
  tenantId: TenantId,
  email: z.email().register(policy, asContact()),
  question: z.string().trim().min(1).max(ASSISTANT_LIMITS.question).register(policy, asFreeText()),
  channel: AssistantChannel,
  /** Earlier questions in the same conversation, oldest first: never their answers. */
  earlier: z
    .array(z.string().max(ASSISTANT_LIMITS.question))
    .max(5)
    .optional()
    .register(policy, asFreeText()),
});
export type AssistantQuestion = z.infer<typeof AssistantQuestion>;

/** What the assistant answers, ready to post. People's `ask.ts` shape, unchanged. */
export const AssistantAnswer = z.strictObject({
  text: z.string().register(policy, asIdentity()),
  /** How the question was read, for somebody checking the answer. */
  understood: z.string().register(policy, asIdentity()),
  /** The people it names, to link to. */
  people: z
    .array(
      z.strictObject({
        id: z.string().register(policy, asIdentity()),
        name: personName(),
        title: title().nullable(),
      }),
    )
    .register(policy, asIdentity()),
  /** The question was understood and answered, even with "nobody". */
  answered: z.boolean().register(policy, asPublic()),
});
export type AssistantAnswer = z.infer<typeof AssistantAnswer>;
