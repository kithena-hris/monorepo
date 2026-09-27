import * as z from 'zod';

/**
 * What a question asked of People means, as People will run it.
 *
 * The model reads a question and the names of the fields the asker may
 * filter on, and answers with one of these; it never sees a value on
 * anybody's record. People then runs the query as the person asking, with
 * the same authorization as the directory, and writes the answer itself. So
 * a model can misunderstand a question, and the worst it can do is ask
 * People something the asker could have asked anyway.
 *
 * Read strictly: a field the asker may not filter on, an operator People
 * does not have, or anything that is not this shape is `unclear`, never a
 * guess.
 */

const OPS = ['is', 'in', 'contains', 'before', 'after', 'between', 'empty', 'not_empty'] as const;

export interface CatalogueField {
  readonly key: string;
  readonly label: string;
  /** text, select, date, number, person or status: which operators fit. */
  readonly kind: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export type IntentOp = (typeof OPS)[number];

export interface IntentCondition {
  readonly key: string;
  readonly op: IntentOp;
  readonly values: readonly string[];
}

/**
 * The model's own opening for the answer, in its words — "Sure! Here are the
 * {n} people on Michael's team." — written before anything is looked up, so
 * it states no fact: `{n}` is the one thing People fills in. Kept only when
 * it is plain words with no number, no markup and no other placeholder;
 * otherwise People's own sentence stands.
 */
type Said = { readonly say?: string };

export type Intent = Said &
  (
  | {
      readonly kind: 'people';
      readonly conditions: readonly IntentCondition[];
      readonly match: 'all' | 'any';
      readonly limit: number;
    }
  | {
      readonly kind: 'count';
      readonly conditions: readonly IntentCondition[];
      readonly match: 'all' | 'any';
      readonly groupBy: string | null;
    }
  | { readonly kind: 'person'; readonly name: string }
  | { readonly kind: 'reports'; readonly name: string }
  | { readonly kind: 'approvals' }
  | { readonly kind: 'unclear'; readonly reply: string }
  );


const Condition = z.object({
  key: z.string().max(64),
  op: z.enum(OPS),
  values: z
    .array(z.union([z.string(), z.number()]).transform(String))
    .max(20)
    .default([]),
});

const Say = { say: z.string().max(240).optional() };

const Raw = z.discriminatedUnion('kind', [
  z.object({
    ...Say,
    kind: z.literal('people'),
    conditions: z.array(Condition).max(10).default([]),
    match: z.enum(['all', 'any']).default('all'),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  z.object({
    ...Say,
    kind: z.literal('count'),
    conditions: z.array(Condition).max(10).default([]),
    match: z.enum(['all', 'any']).default('all'),
    groupBy: z.string().max(64).nullable().default(null),
  }),
  z.object({ ...Say, kind: z.literal('person'), name: z.string().trim().min(1).max(120) }),
  z.object({ ...Say, kind: z.literal('reports'), name: z.string().trim().min(1).max(120) }),
  z.object({ ...Say, kind: z.literal('approvals') }),
  z.object({ kind: z.literal('unclear'), reply: z.string().max(500).default('') }),
]);

const UNCLEAR =
  'I’m not sure I followed that. I can help with questions about your people: who is in a team, who reports to whom, how many people work where, or what is waiting for your approval.';

/** The first `{…}` in what the model wrote: a model sometimes talks around its JSON. */
function firstObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** A condition on a field the asker may filter on, with a choice's label read as its value. */
function checked(
  c: z.infer<typeof Condition>,
  fields: ReadonlyMap<string, CatalogueField>,
): IntentCondition | null {
  const field = fields.get(c.key);
  if (field === undefined) return null;
  if (field.options.length === 0) return c;
  const values = c.values.map(
    (v) =>
      field.options.find((o) => o.value === v || o.label.toLowerCase() === v.toLowerCase())?.value,
  );
  if (values.some((v) => v === undefined)) return null;
  // A choice is asked as "any of", whichever of the two the model wrote.
  return { key: c.key, op: c.op === 'is' ? 'in' : c.op, values: values as string[] };
}

/** An opening that is only words: no number, no markup, no placeholder but `{n}`. */
export function saying(raw: string | undefined): string | undefined {
  const say = raw?.replace(/\s+/g, ' ').trim() ?? '';
  const bare = say.replaceAll('{n}', '');
  if (say.length < 3 || /\d|[<>*_`|[\]{}\\#@]/.test(bare)) return undefined;
  return say;
}

export function readIntent(text: string, catalogue: readonly CatalogueField[]): Intent {
  const read = readBare(text, catalogue);
  const parsed = Raw.safeParse(firstObject(text));
  const say = parsed.success && 'say' in parsed.data ? saying(parsed.data.say) : undefined;
  return read.kind === 'unclear' || say === undefined ? read : { ...read, say };
}

function readBare(text: string, catalogue: readonly CatalogueField[]): Intent {
  const parsed = Raw.safeParse(firstObject(text));
  if (!parsed.success) return { kind: 'unclear', reply: UNCLEAR };
  const { say: _say, ...intent } = { say: undefined, ...parsed.data };
  const fields = new Map(catalogue.map((f) => [f.key, f]));
  switch (intent.kind) {
    case 'people':
    case 'count': {
      const conditions = intent.conditions.map((c) => checked(c, fields));
      if (conditions.some((c) => c === null)) return { kind: 'unclear', reply: UNCLEAR };
      const known = conditions as IntentCondition[];
      if (intent.kind === 'people') {
        return { kind: 'people', conditions: known, match: intent.match, limit: intent.limit };
      }
      const group = intent.groupBy === null ? undefined : fields.get(intent.groupBy);
      return {
        kind: 'count',
        conditions: known,
        match: intent.match,
        groupBy: group !== undefined && group.options.length > 0 ? group.key : null,
      };
    }
    case 'unclear':
      return { kind: 'unclear', reply: intent.reply === '' ? UNCLEAR : intent.reply };
    default:
      return intent;
  }
}

/** What the model is told: the shapes it may answer with, and the fields it may name. */
export function instructionFor(): string {
  return [
    'You turn a question about the people in a company into ONE JSON object, and nothing else.',
    'You are given the question and the fields the asker may filter on, each with its key, label, kind and options.',
    'Answer with exactly one of:',
    '{"kind":"people","conditions":[{"key":"<field key>","op":"<op>","values":["..."]}],"match":"all"|"any","limit":1-25}  — to list people',
    '{"kind":"count","conditions":[...],"match":"all","groupBy":"<select field key>"|null}  — how many, optionally per option',
    '{"kind":"person","name":"<full or partial name>"}  — about one named person',
    // Worded without the names of fields: the AI gateway refuses a prompt
    // that names a field not for AI, and the reporting line is one.
    '{"kind":"reports","name":"<their name>"}  — who reports to a named person',
    '{"kind":"approvals"}  — what waits for the asker’s approval',
    '{"kind":"unclear","reply":"<one short sentence>"}  — anything else',
    'Ops: is, in, contains, before, after, between (two dates, either may be ""), empty, not_empty. Dates are YYYY-MM-DD.',
    'For a select field use the option value. Use only the keys given. Never invent a field.',
    'Add "say" to any answer but unclear: one warm, natural sentence a helpful colleague would open with, in the asker’s language, e.g. "Sure! Here are the {n} people on Michael’s team." or "Happy to help, here’s what’s waiting for you."',
    'You have not seen the answer yet, so in "say" never state a number, a name you were not given, or any fact: write {n} where the count goes.',
    'For unclear, "reply" is a friendly sentence saying what you can help with.',
    'Earlier questions from the same conversation, if any, are in "earlier": use them to understand a follow-up such as "and in sales?".',
  ].join('\n');
}
