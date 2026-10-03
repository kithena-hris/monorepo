import type { ModuleKey } from '@kithena/contracts';

import { spoken, type Today } from './dates.js';
import type { Offer } from './plan.js';

/**
 * What the planner is told (assistant PRD §12.1, §12.3, §14). Pure.
 *
 * The instruction is fixed text, in the voice of People's `instructionFor()`:
 * the plan's shapes, the inputs, the date words, `@me`, and the rules a model
 * gets wrong. The context is this question's: the masked question, today in
 * words, each capability the asker may use — what it is about, what it takes,
 * the fields its filters may name — and one line per module the company
 * cannot use. Configuration only: never a value from a record, never a
 * person's id, never a result.
 *
 * Worded without any word the AI gateway refuses in a prompt that names
 * nobody (`denied` labels such as a private leave type's), because the
 * instruction is free text the gateway reads too.
 */

export const INSTRUCTION = [
  'You turn a question about the people in a company, and their time off, into ONE JSON object, and nothing else.',
  'You are given the question, today’s date, the capabilities this asker may use — what each is about, the inputs it takes and the fields its filters may name, each with its key, label, kind and options — and the parts of Kithena this company cannot use.',
  'Answer with exactly one of:',
  '{"kind":"plan","steps":[{"id":"s1","capability":"<capability>","input":{}}],"answer":{"kind":"count"|"list"|"one","step":"s1"},"say":"<opening>"}  — to look something up',
  '{"kind":"unavailable","module":"<module>"}  — the question needs a part of Kithena listed as unavailable',
  '{"kind":"unclear","reply":"<one short sentence>"}  — anything else',
  'Steps: at most four, with ids s1 to s4. A step may add "within":"<an earlier step id>" to look only among the people that step found; that is the only way to join two steps, and a capability marked within "required" means nothing without it.',
  'Inputs, only those a capability takes: "filters":[{"key":"<field key>","op":"<op>","values":["..."]}], "match":"all"|"any", "on":<date>, "name":"<a person named in the question>", "sort":{"key":"<field or metric key>","direction":"asc"|"desc"}, "groupBy":"<group key>". Never write personIds, limit or ids: Kithena sets those.',
  'Ops: is, in, not_in, contains, before, after, between, empty, not_empty. For a field with options use in or not_in with the option values. Use only the keys, options and capabilities given; never invent one.',
  'Dates: one of today, tomorrow, yesterday, this_week, next_week, last_week, this_month, next_month, last_month, or a calendar date as YYYY-MM-DD; a span is {"from":<date>,"to":<date>}. Use a word wherever one fits; for a named day, write its date.',
  'The asker is a person here too. When the question is about them (me, my, I, myself), use the name "@me". Never ask who "me" is.',
  'Answer kinds: "count" for how many, with "by":"<group key>" to split by a group the capability lists; "list" to name people; "one" for a single person, for what waits for approval, or for a name that may match several people.',
  'Being off, out or away on a day is time off. A status of "On leave" in the directory is employment status, not who is away today.',
  'A leave type option labelled "a leave type named in the question" stands for words of the question replaced by its value (L1, L2): filter by that value as it is.',
  'Add "say" to a plan: one warm, natural sentence a helpful colleague would open with, in the asker’s language. You have not seen the answer yet, so in "say" never write a number, a name you were not given, or any fact: write {n} where the count goes.',
  'For unclear, "reply" is a friendly sentence saying what you can help with.',
].join('\n');

/** One line each for a module the company cannot use, so the model can say so rather than guess. */
const MODULE_ABOUT: Partial<Record<ModuleKey, string>> = {
  people:
    'People: the directory — who works where, job details, teams, reporting lines and approvals.',
  timeoff: 'Time Off: who is away, when, and on what kind of leave.',
};

export interface PlanPrompt {
  readonly instruction: string;
  readonly context: Readonly<Record<string, unknown>>;
}

export interface PromptInput {
  readonly question: string;
  readonly today: Today;
  readonly offer: Offer;
  readonly unavailable: readonly ModuleKey[];
}

export function promptFor({ question, today, offer, unavailable }: PromptInput): PlanPrompt {
  const day = spoken({ from: today.date, to: today.date }, today);
  // `spoken` leaves out this year; the model is told it.
  const date = day.endsWith(today.date.slice(0, 4)) ? day : `${day} ${today.date.slice(0, 4)}`;
  const capabilities = [...offer.values()].map(({ capability, fields, metrics }) => {
    const { name, about, accepts, groups } = capability;
    const takes = Object.entries(accepts)
      .filter(([input]) => input !== 'within')
      .map(([input, how]) => (how === 'required' ? `${input} (required)` : input));
    const groupKeys = groups.flatMap((g) =>
      g === 'field:*' ? fields.filter((f) => f.kind === 'select').map((f) => f.key) : [g],
    );
    return {
      capability: name,
      about,
      inputs: takes,
      ...(accepts.within === undefined
        ? {}
        : { within: accepts.within === 'required' ? 'required' : 'optional' }),
      ...(accepts.filters === undefined
        ? {}
        : {
            fields: fields.map((f) => ({
              key: f.key,
              label: f.label,
              kind: f.kind,
              ...(f.options.length === 0 ? {} : { options: f.options }),
            })),
          }),
      ...(accepts.sort === undefined || metrics.length === 0 ? {} : { metrics }),
      ...(groupKeys.length === 0 ? {} : { groups: groupKeys }),
    };
  });
  return {
    instruction: INSTRUCTION,
    context: {
      question,
      today: today.utc ? `${date}, in UTC` : date,
      capabilities,
      unavailable: unavailable.flatMap((module) => {
        const about = MODULE_ABOUT[module];
        return about === undefined ? [] : [{ module, about }];
      }),
    },
  };
}
