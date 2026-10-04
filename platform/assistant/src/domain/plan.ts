import {
  allCapabilities,
  AssistantPlan,
  StepId,
  type Capability,
  type CapabilityFilter,
  type CapabilitySort,
  type CatalogueField,
  type DateOn,
  type FilterMatch,
  type FilterOp,
  type ModuleKey,
  type PlanAnswer,
  type PlanStep,
  type RuntimeCatalogue,
} from '@kithena/contracts';
import { err, ok, type Result } from '@kithena/domain-kit';

/**
 * What the model planned, read against what this asker was offered
 * (assistant PRD §9.2). Pure.
 *
 * The contract's `AssistantPlan` is shape only; this is meaning: every step
 * names a capability offered, writes only inputs it accepts, filters only by
 * fields its module offered this asker, and narrows only to an earlier step's
 * people. Refusal is whole — one broken rule and nothing runs — and carries a
 * reason code for telemetry, never the words.
 *
 * Each module validates its input again when called. Two locks; the module's
 * is the one that counts.
 */

/* ------------------------------------------------------------ the offer -- */

/** One capability as offered to this asker: pinned, not yielded, with its runtime fields. */
export interface Offered {
  readonly capability: Capability;
  /** The fields its filters may name, as its module offered them this asker. */
  readonly fields: readonly CatalogueField[];
  /** What it may be sorted by besides a field: its module's metrics. */
  readonly metrics: readonly string[];
}

/** By capability name. */
export type Offer = ReadonlyMap<string, Offered>;

const PINNED = new Map<string, Capability>(allCapabilities.map((c) => [c.name, c]));

/**
 * What the model may plan with, from the catalogues the asker's modules
 * returned (§8.4–§8.6).
 *
 * A capability is offered only at the major version the assistant was built
 * against, and only by the module it belongs to. Where its owner is present,
 * what yields gives way: a capability that yields is dropped, a filter that
 * yields loses its field.
 */
export function offer(
  catalogues: readonly RuntimeCatalogue[],
  pinned: ReadonlyMap<string, Capability> = PINNED,
): Offer {
  const served = catalogues.flatMap((catalogue) =>
    catalogue.serves.flatMap(({ name, version }) => {
      const capability = pinned.get(name);
      return capability?.version === version && capability.module === catalogue.module
        ? [
            {
              capability,
              fields: catalogue.fields[name] ?? [],
              metrics: catalogue.metrics.map((m) => m.key),
            },
          ]
        : [];
    }),
  );
  const present = new Set(served.map((o) => o.capability.name));
  const offered = new Map<string, Offered>();
  for (const o of served) {
    const yielding = Object.entries(o.capability.yields).filter(([, to]) => present.has(to));
    if (yielding.some(([what]) => what === o.capability.name)) continue;
    const gone = new Set(yielding.map(([what]) => what));
    offered.set(o.capability.name, { ...o, fields: o.fields.filter((f) => !gone.has(f.key)) });
  }
  return offered;
}

/* ------------------------------------------------------------- the plan -- */

/** A step's input as a plan may write it: dates still references, nothing only the assistant sets. */
export interface StepInput {
  readonly filters?: readonly CapabilityFilter[];
  readonly match?: FilterMatch;
  readonly on?: DateOn;
  readonly name?: string;
  readonly sort?: CapabilitySort;
}

export interface ValidStep {
  readonly id: StepId;
  readonly capability: Capability;
  readonly input: StepInput;
  readonly within?: StepId;
}

export type ValidPlan =
  | {
      readonly kind: 'plan';
      readonly steps: readonly ValidStep[];
      readonly answer: PlanAnswer;
      /** The model's opening, kept only when it is plain words (`saying`). */
      readonly say?: string;
    }
  /** No `reply` when the model gave none: the template's own sentence stands. */
  | { readonly kind: 'unclear'; readonly reply?: string }
  | { readonly kind: 'unavailable'; readonly module: ModuleKey };

export type PlanRefusalCode =
  | 'SHAPE'
  | 'DUPLICATE_STEP'
  | 'NOT_OFFERED'
  | 'INPUT'
  | 'ASSISTANT_ONLY'
  | 'FILTER_FIELD'
  | 'FILTER_OP'
  | 'FILTER_OPTION'
  | 'SORT'
  | 'GROUP'
  | 'WITHIN'
  | 'ANSWER_STEP'
  | 'ANSWER_KIND';

export interface PlanRefusal {
  readonly code: PlanRefusalCode;
}

/** The first `{…}` in what the model wrote: a model sometimes talks around its JSON. Copied from People's `intent.ts`. */
export function firstObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * An opening that is only words: no number, no markup, no placeholder but
 * `{n}`. Copied from People's `intent.ts`, which a platform service cannot
 * import.
 */
export function saying(raw: string | undefined): string | undefined {
  const say = raw?.replace(/\s+/g, ' ').trim() ?? '';
  const bare = say.replaceAll('{n}', '');
  if (say.length < 3 || /\d|[<>*_`|[\]{}\\#@]/.test(bare)) return undefined;
  return say;
}

/** Which operators each kind of field takes: People's directory's (`selection.ts`, `FITS`). */
const FITS: Readonly<Record<CatalogueField['kind'], readonly FilterOp[]>> = {
  text: ['contains', 'is', 'empty', 'not_empty'],
  select: ['in', 'not_in', 'empty', 'not_empty'],
  status: ['in', 'not_in'],
  date: ['between', 'before', 'after', 'empty', 'not_empty'],
  number: ['is', 'before', 'after', 'empty', 'not_empty'],
  person: ['empty', 'not_empty'],
};

/** Only the assistant sets these (§9.3); a plan that writes one is refused. */
const ASSISTANT_ONLY = ['personIds', 'limit', 'ids'] as const;

const refuse = (code: PlanRefusalCode) => err({ code });

/** A filter on a field offered, with an option read by its label, as People's `checked()`. */
function checked(
  filter: CapabilityFilter,
  fields: readonly CatalogueField[],
): Result<CapabilityFilter, PlanRefusal> {
  const field = fields.find((f) => f.key === filter.key);
  if (field === undefined) return refuse('FILTER_FIELD');
  // A choice is asked as "any of", whichever of the two the model wrote.
  const op = field.options.length > 0 && filter.op === 'is' ? 'in' : filter.op;
  if (!FITS[field.kind].includes(op)) return refuse('FILTER_OP');
  if (field.options.length === 0) return ok({ ...filter, op });
  const values = filter.values.map(
    (v) =>
      field.options.find((o) => o.value === v || o.label.toLowerCase() === v.toLowerCase())?.value,
  );
  if (values.some((v) => v === undefined)) return refuse('FILTER_OPTION');
  return ok({ key: filter.key, op, values: values as string[] });
}

/** A group key the capability declares: by name, or any select field where it declares `field:*`. */
const groupable = (o: Offered, key: string): boolean =>
  o.capability.groups.includes(key) ||
  (o.capability.groups.includes('field:*') &&
    o.fields.some((f) => f.key === key && f.kind === 'select'));

function readStep(
  step: PlanStep,
  earlier: readonly ValidStep[],
  offered: Offer,
): Result<ValidStep, PlanRefusal> {
  const o = offered.get(step.capability);
  if (o === undefined) return refuse('NOT_OFFERED');
  const { accepts } = o.capability;

  if (ASSISTANT_ONLY.some((key) => key in step.input)) return refuse('ASSISTANT_ONLY');
  const parsed = o.capability.schemas.step.safeParse(step.input);
  if (!parsed.success) return refuse('INPUT');
  // The step schema is built from `accepts`, so every key it lets through is one of these.
  const input = parsed.data as StepInput;

  if (step.within === undefined) {
    if (accepts.within === 'required') return refuse('WITHIN');
  } else {
    const target = earlier.find((s) => s.id === step.within);
    // Not found among the steps before it: a later step, or itself.
    if (accepts.within === undefined || target?.capability.output !== 'people') {
      return refuse('WITHIN');
    }
  }

  const filters: CapabilityFilter[] = [];
  for (const filter of input.filters ?? []) {
    const read = checked(filter, o.fields);
    if (!read.ok) return read;
    filters.push(read.value);
  }
  if (
    input.sort !== undefined &&
    !o.fields.some((f) => f.key === input.sort?.key) &&
    !o.metrics.includes(input.sort.key)
  ) {
    return refuse('SORT');
  }
  return ok({
    id: step.id,
    capability: o.capability,
    input: input.filters === undefined ? input : { ...input, filters },
    ...(step.within === undefined ? {} : { within: step.within }),
  });
}

/**
 * The model's answer, read against what was offered to this asker. Read it
 * against the catalogue the model was shown — masked references included —
 * and unmask what comes back.
 */
export function readPlan(text: string, offered: Offer): Result<ValidPlan, PlanRefusal> {
  const parsed = AssistantPlan.safeParse(firstObject(text));
  if (!parsed.success) return refuse('SHAPE');
  const plan = parsed.data;
  switch (plan.kind) {
    case 'unavailable':
      return ok(plan);
    case 'unclear': {
      const reply = plan.reply.trim();
      return ok(reply === '' ? { kind: 'unclear' } : { kind: 'unclear', reply });
    }
    case 'plan':
      break;
  }

  if (new Set(plan.steps.map((s) => s.id)).size !== plan.steps.length) {
    return refuse('DUPLICATE_STEP');
  }
  // Two slips a model makes with the right meaning, put where they belong:
  // "within" written inside the input, and a count's group written as an input.
  let by = plan.answer.kind === 'count' ? plan.answer.by : undefined;
  const written = plan.steps.map((step) => {
    const { within, groupBy, ...input } = step.input;
    if (by === undefined && step.id === plan.answer.step && typeof groupBy === 'string') {
      by = groupBy;
    }
    const lifted = step.within ?? StepId.safeParse(within).data;
    return { ...step, input, ...(lifted === undefined ? {} : { within: lifted }) };
  });
  const answer =
    plan.answer.kind === 'count' && by !== undefined ? { ...plan.answer, by } : plan.answer;

  const steps: ValidStep[] = [];
  for (const step of written) {
    const read = readStep(step, steps, offered);
    if (!read.ok) return read;
    steps.push(read.value);
  }

  const answered = steps.find((s) => s.id === answer.step);
  if (answered === undefined) return refuse('ANSWER_STEP');
  const people = answered.capability.output === 'people';
  // A list of what waits for approval is written the same as "one": read it so.
  const kind = answer.kind === 'list' && !people ? 'one' : answer.kind;
  if (kind !== 'one' && !people) return refuse('ANSWER_KIND');
  if (answer.kind === 'count' && answer.by !== undefined) {
    const o = offered.get(answered.capability.name);
    if (o === undefined || !groupable(o, answer.by)) return refuse('GROUP');
  }

  const say = saying(plan.say);
  return ok({
    kind: 'plan',
    steps,
    answer: kind === answer.kind ? answer : { kind: 'one', step: answer.step },
    ...(say === undefined ? {} : { say }),
  });
}
