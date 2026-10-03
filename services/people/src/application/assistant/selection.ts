import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { Prompt } from '@kithena/telemetry';
import * as z from 'zod';

import { sift, type Topic } from '../../domain/assistant/clarify.js';
import type { IntentCondition } from '../../domain/assistant/intent.js';
import { REPORTS_TO } from '../person/person-access.js';
import type { PlanBudget } from '../../domain/import/new-fields.js';
import {
  DIRECTORY_INSTRUCTION,
  EXPORT_INSTRUCTION,
  aboutPayroll,
  directoryByRules,
  directoryContext,
  draftedReason,
  exportByRules,
  exportContext,
  forModel,
  isEmail,
  isPlainSearch,
  readDirectoryAnswer,
  readExportAnswer,
  type ExportCatalogue,
  type ExportPlan,
} from '../../domain/assistant/selection.js';
import type { Asking, PersonView } from '../person/person-access.js';
import { run } from '../person/service.js';
import type { Condition } from '../person/ports.js';
import { exportBuilderView, type ExportBuilderView } from '../screens/operations.js';
import { requestDetailsOfMany } from '../screens/requests.js';
import { nameOf, type ScreenDeps } from '../screens/record.js';
import { describe, filterFields, metricsFor } from './ask.js';
import type { AssistantPort } from './assistant-port.js';

/**
 * Search and export in words (docs/ai-settings.md, "Search and export in
 * words"): a sentence becomes the directory's filters or the export
 * builder's choices, and nothing else.
 *
 * The model is shown the sentence, today's date and the names of the fields
 * the person may filter by or export — options only where they are
 * configuration and the field is the assistant's — through the AI gateway,
 * as a prompt about configuration: the key check runs, and anything shaped
 * like somebody's value (an email address, a long number) is refused before
 * it leaves. Its answer is read strictly (`domain/assistant/selection.ts`).
 * With no model, a spent hourly budget, a refusal, a timeout or an answer
 * that cannot be read, People's own rules read the sentence instead, and say
 * so. Either way the result is a selection the person sees and changes
 * before anything runs, and the directory and the export then authorize it
 * as they always do.
 */

export interface SelectionDeps extends ScreenDeps {
  /** The model behind the AI gateway, with a short timeout; absent, People's own rules. */
  readonly selectionPlanner?: AssistantPort;
  readonly searchBudget: PlanBudget;
  readonly exportBudget: PlanBudget;
}

export const PlanAsk = z.strictObject({ sentence: z.string().trim().min(1).max(300) });
export type PlanAsk = z.infer<typeof PlanAsk>;

/** The directory's sentence, with the readings this person chose before (topic → label). */
export const DirectoryAsk = PlanAsk.extend({
  remembered: z
    .partialRecord(z.enum(['leaving', 'new', 'starting']), z.string().max(80))
    .optional(),
});
export type DirectoryAsk = z.infer<typeof DirectoryAsk>;

/** Who read the sentence: a name search, the assistant, or People's own rules. */
export type ReadBy = 'search' | 'assistant' | 'rules';

export interface DirectoryPlanView {
  readonly search: string | null;
  readonly conditions: readonly IntentCondition[];
  readonly match: 'all' | 'any';
  /** `key:asc` or `key:desc`, as the directory's address carries it; null for its own order. */
  readonly sort: string | null;
  /** At most this many people ("top 5", "the person with…"); null for everybody found. */
  readonly top: number | null;
  /** A field to group the people found by, for "which department has the most…". */
  readonly group: string | null;
  /** What was read and how, and what was not, in words: said, never hidden. */
  readonly notes: readonly string[];
  /** Words nothing was made of, to say so. */
  readonly unused: readonly string[];
  readonly by: ReadBy;
  /** Why the assistant did not read it, when it did not; null otherwise. */
  readonly note: string | null;
  /** The one person a name or an email found: the screen goes straight to them. */
  readonly person: { readonly id: string; readonly name: string } | null;
  /**
   * A phrase read more than one way, asked rather than guessed: each reading
   * as the whole selection it would be, and how many people it finds.
   */
  readonly ask: {
    readonly topic: Topic | null;
    readonly phrase: string;
    readonly readings: readonly {
      readonly label: string;
      readonly conditions: readonly IntentCondition[];
      readonly match: 'all' | 'any';
      readonly count: number | null;
    }[];
  } | null;
  /** Judgements left out, why, and a field that records something close. */
  readonly refused: readonly {
    readonly text: string;
    readonly why: string;
    readonly instead: {
      readonly label: string;
      readonly subject: string;
      readonly condition: IntentCondition;
      readonly count: number | null;
    } | null;
  }[];
  /** A reading taken because this person chose it before. */
  readonly remembered: {
    readonly topic: Topic;
    readonly phrase: string;
    readonly label: string;
  } | null;
}

export interface ExportPlanView {
  /** The builder's audience: `everyone`, `segment:<id>`, or `conditions`. */
  readonly who: string;
  readonly conditions: readonly IntentCondition[];
  readonly match: 'all' | 'any';
  /** The audience in words, and how many people it is as this person may list them. */
  readonly audience: string;
  readonly count: number | null;
  readonly fields: readonly string[];
  readonly asOf: string;
  readonly format: ExportPlan['format'];
  readonly photos: boolean;
  readonly reason: string;
  readonly by: ReadBy;
  readonly note: string | null;
  /** What was changed from what was asked ("1 November is still to come"). */
  readonly notes: readonly string[];
}

type Consulted = { readonly answer: string } | { readonly note: string };

const WITHOUT = 'so People read it without the assistant.';

/** The model's answer, or why there is none. Never throws: an interactive screen is waiting. */
async function consult(
  deps: SelectionDeps,
  asking: Asking,
  budget: PlanBudget,
  prompt: Prompt,
): Promise<Consulted> {
  const planner = deps.selectionPlanner;
  if (planner === undefined) return { note: `The assistant isn’t set up here, ${WITHOUT}` };
  if (!budget.take(asking.tenantId, deps.clock.instant()).ok) {
    return { note: `The assistant has answered enough for this hour, ${WITHOUT}` };
  }
  try {
    const loaded = await run(deps.service, asking.tenantId, async (tx) => {
      await planner.loadPolicies(tx, asking.tenantId);
      return ok(null);
    });
    if (!loaded.ok) return { note: `The assistant couldn’t be reached, ${WITHOUT}` };
    const answered = await planner.complete(asking.tenantId, prompt);
    if (!answered.ok) {
      return {
        note:
          answered.error.code === 'AI_VALUE_SHAPED'
            ? `It holds what looks like somebody’s details, which never go to the assistant, ${WITHOUT}`
            : `The assistant may not be asked this, ${WITHOUT}`,
      };
    }
    return { answer: answered.value };
  } catch {
    return { note: `The assistant didn’t answer in time, ${WITHOUT}` };
  }
}

const UNREADABLE = `The assistant’s answer couldn’t be used, ${WITHOUT}`;

const sortOf = (sort: { key: string; direction: 'asc' | 'desc' } | null): string | null =>
  sort === null ? null : `${sort.key}:${sort.direction}`;

/** How many people a selection finds, as this person may list them; null when they may not. */
async function counted(
  deps: SelectionDeps,
  asking: Asking,
  conditions: readonly IntentCondition[],
  match: 'all' | 'any',
): Promise<number | null> {
  const n = await run(deps.service, asking.tenantId, (tx) =>
    deps.service.access.count(tx, { ...asking, refine: { conditions, match } }),
  );
  return n.ok ? n.value.all : null;
}

/**
 * The manager a sentence named, as this person may find people: one is their
 * team (direct reports, or everybody below them); several are asked about,
 * each with how many it finds; none is said. Exact full names win over
 * partial ones, so "Ana Lopez" is not also "Ana Lopez-Garcia".
 */
async function managerOf(
  deps: SelectionDeps,
  asking: Asking,
  manager: { readonly name: string; readonly scope: 'direct' | 'all' },
): Promise<
  | { readonly condition: IntentCondition }
  | {
      readonly phrase: string;
      readonly readings: readonly {
        label: string;
        conditions: readonly IntentCondition[];
        match: 'all';
      }[];
    }
  | { readonly note: string }
> {
  const found = await run(deps.service, asking.tenantId, (tx) =>
    deps.service.access.list(tx, { ...asking, search: manager.name, limit: 5 }),
  );
  if (!found.ok) {
    return { note: `You can’t search people by name here, so “${manager.name}” was left out.` };
  }
  const people = found.value.items.map((p) => ({ id: p.id, name: nameOf(p.attributes) ?? '' }));
  const exact = people.filter((p) => p.name.toLowerCase() === manager.name.toLowerCase());
  const candidates = exact.length > 0 ? exact : people;
  const op = manager.scope === 'all' ? ('under' as const) : ('is' as const);
  const condition = (id: string): IntentCondition => ({ key: REPORTS_TO, op, values: [id] });
  const [one] = candidates;
  if (one === undefined) {
    return { note: `Nobody called “${manager.name}” is in the directory for you.` };
  }
  if (candidates.length === 1) return { condition: condition(one.id) };
  return {
    phrase: manager.name,
    readings: candidates.map((p) => ({
      label: p.name,
      conditions: [condition(p.id)],
      match: 'all' as const,
    })),
  };
}

/** Two selections as one: all of both, or the second alone when the first is empty. */
const joined = (
  base: readonly IntentCondition[],
  more: readonly IntentCondition[],
  match: 'all' | 'any',
): { conditions: readonly IntentCondition[]; match: 'all' | 'any' } =>
  base.length === 0
    ? { conditions: more, match }
    : { conditions: [...base, ...more], match: 'all' };

/**
 * The directory's filters from a sentence (smart search, docs/ai-settings.md).
 *
 * A name or an email that finds one person is that person, with no model.
 * Otherwise judgements are taken out and a phrase with several readings is
 * asked about (`domain/assistant/clarify.ts`) before anything reads the
 * rest; then the assistant reads it where it can, and People's rules where
 * it cannot. Every count is as this person may list people.
 */
export async function planDirectory(
  deps: SelectionDeps,
  asking: Asking,
  input: DirectoryAsk,
): Promise<Result<DirectoryPlanView>> {
  const sentence = input.sentence.trim();
  const loaded = await run(deps.service, asking.tenantId, async (tx) =>
    ok({
      fields: await filterFields(deps, tx, asking),
      metrics: await metricsFor(deps, tx, asking),
    }),
  );
  if (!loaded.ok) return loaded;
  const fields = { value: loaded.value.fields };
  const metrics = loaded.value.metrics;
  if (isEmail(sentence) || isPlainSearch(sentence, fields.value)) {
    // One match is that person; none or several, the names to choose from.
    const found = await run(deps.service, asking.tenantId, (tx) =>
      deps.service.access.list(tx, { ...asking, search: sentence, limit: 2 }),
    );
    const one = found.ok && found.value.items.length === 1 ? found.value.items[0] : undefined;
    return ok({
      search: sentence,
      conditions: [],
      match: 'all',
      sort: null,
      top: null,
      group: null,
      notes: [],
      unused: [],
      by: 'search',
      note: null,
      person: one === undefined ? null : { id: one.id, name: nameOf(one.attributes) ?? sentence },
      ask: null,
      refused: [],
      remembered: null,
    });
  }
  const today = deps.clock.instant().slice(0, 10);
  const sifted = sift(sentence, fields.value, today, input.remembered ?? {});
  const rest = sifted.rest;
  const rules = directoryByRules(rest, fields.value, today, metrics);
  const shown = forModel(fields.value);
  // Already asking, or nothing left to read: the model is not asked to guess.
  const consulted: Consulted | null =
    sifted.clarify !== null || rest === ''
      ? null
      : await consult(deps, asking, deps.searchBudget, {
          instruction: DIRECTORY_INSTRUCTION,
          context: directoryContext(rest, shown, today, metrics),
          about: 'configuration',
        });
  const heard =
    consulted !== null && 'answer' in consulted
      ? readDirectoryAnswer(consulted.answer, shown, metrics)
      : null;
  const plan = heard ?? rules;
  const notes = [...plan.notes];
  const unused = [...plan.unused];

  // A manager by name: found as this person may find people, never by the model.
  const byManager = fields.value.some((f) => f.key === REPORTS_TO);
  const boss =
    plan.manager === null
      ? null
      : byManager
        ? await managerOf(deps, asking, plan.manager)
        : { note: 'You can’t narrow the directory by manager, so the team was left out.' };
  if (plan.manager !== null && boss !== null && 'note' in boss) {
    notes.push(boss.note);
    unused.push(plan.manager.name);
  }
  const own =
    boss !== null && 'condition' in boss ? [...plan.conditions, boss.condition] : plan.conditions;
  const chosen = sifted.reading;
  const selection =
    chosen === null
      ? { conditions: own, match: plan.match }
      : joined(own, chosen.conditions, chosen.match);

  const asked = sifted.clarify ?? (boss !== null && 'readings' in boss ? boss : null) ?? plan.ask;
  const readings: NonNullable<DirectoryPlanView['ask']>['readings'][number][] = [];
  for (const r of asked?.readings ?? []) {
    const whole = joined(selection.conditions, r.conditions, r.match);
    readings.push({
      label: r.label,
      ...whole,
      count: await counted(deps, asking, whole.conditions, whole.match),
    });
  }
  const refused: DirectoryPlanView['refused'][number][] = [];
  for (const r of sifted.refused) {
    refused.push({
      text: r.text,
      why: r.why,
      instead:
        r.instead === null
          ? null
          : {
              label: r.instead.label,
              subject: r.instead.subject,
              condition: r.instead.condition,
              count: await counted(deps, asking, [r.instead.condition], 'all'),
            },
    });
  }
  if (unused.length > 0) notes.push(`Not understood: ${unused.map((u) => `“${u}”`).join(', ')}.`);
  const understood =
    selection.conditions.length > 0 ||
    plan.sort !== null ||
    plan.group !== null ||
    plan.limit !== null ||
    plan.search !== null ||
    asked !== null ||
    refused.length > 0;
  if (!understood) {
    notes.push('None of it is a field or an order People knows, so this is everybody you can see.');
  }
  return ok({
    search: plan.search,
    conditions: selection.conditions,
    match: selection.match,
    sort: sortOf(plan.sort),
    top: plan.limit,
    group: plan.group,
    notes,
    unused,
    by: heard === null ? 'rules' : 'assistant',
    note:
      heard !== null || consulted === null
        ? null
        : 'note' in consulted
          ? consulted.note
          : UNREADABLE,
    person: null,
    ask:
      asked === null
        ? null
        : { topic: sifted.clarify?.topic ?? null, phrase: asked.phrase, readings },
    refused,
    remembered: sifted.remembered,
  });
}

export const DirectoryRemind = z.strictObject({
  conditions: z
    .array(
      z.strictObject({
        key: z.string().max(64),
        op: z.enum([
          'is',
          'in',
          'not_in',
          'contains',
          'before',
          'after',
          'between',
          'empty',
          'not_empty',
          'under',
        ]),
        values: z.array(z.string().max(200)).max(50),
      }),
    )
    .min(1)
    .max(20),
  match: z.enum(['all', 'any']).default('all'),
  search: z.string().trim().max(120).optional(),
});
export type DirectoryRemind = z.infer<typeof DirectoryRemind>;

/** At most this many people are asked by one press; the rest are said, and asked by pressing again. */
export const REMIND_AT_MOST = 500;

/**
 * "Remind all": everybody a search found missing a detail they fill in
 * themselves is asked for it, as the profile's "Ask them for it" asks one
 * person. The details are the conditions' "is empty" ones; the people are
 * those the directory lists for this person, with the same authorization,
 * and each request is checked as that one would be.
 */
export async function remindDirectory(
  deps: SelectionDeps,
  asking: Asking,
  input: DirectoryRemind,
): Promise<
  Result<{
    readonly asked: number;
    readonly emailed: number;
    readonly skipped: number;
    readonly more: boolean;
  }>
> {
  const keys = [...new Set(input.conditions.filter((c) => c.op === 'empty').map((c) => c.key))];
  if (keys.length === 0) {
    return err(
      failure('FIELD_NOT_REQUESTABLE', 'Nothing here is missing to ask for', ['conditions']),
    );
  }
  const ids: string[] = [];
  let after: string | null = null;
  do {
    const from: string | null = after;
    const page: Result<{ items: readonly PersonView[]; next: string | null }> = await run(
      deps.service,
      asking.tenantId,
      (tx) =>
        deps.service.access.list(tx, {
          ...asking,
          after: from,
          limit: 100,
          refine: { conditions: input.conditions, match: input.match },
          ...(input.search === undefined || input.search === '' ? {} : { search: input.search }),
        }),
    );
    if (!page.ok) return page;
    ids.push(...page.value.items.map((p) => p.id));
    after = page.value.next;
  } while (after !== null && ids.length < REMIND_AT_MOST);
  const asked = await requestDetailsOfMany(deps, asking, ids.slice(0, REMIND_AT_MOST), keys);
  return asked.ok
    ? ok({ ...asked.value, more: after !== null || ids.length > REMIND_AT_MOST })
    : asked;
}

/**
 * The export builder with the directory's own conditions as one more
 * audience, counted as this person may list them: from the directory's
 * Export button, or an export described in words. Conditions they may not
 * run are refused, as the directory refuses them.
 */
export async function exportViewWith(
  deps: ScreenDeps,
  asking: Asking,
  narrowed?: { readonly conditions: readonly Condition[]; readonly match: 'all' | 'any' },
): Promise<Result<ExportBuilderView>> {
  const view = await exportBuilderView(deps, asking);
  if (!view.ok || narrowed === undefined || narrowed.conditions.length === 0) return view;
  const described = await run(deps.service, asking.tenantId, async (tx) => {
    const counted = await deps.service.access.count(tx, { ...asking, refine: narrowed });
    if (!counted.ok) return counted;
    const fields = await filterFields(deps, tx, asking);
    return ok({
      value: 'conditions',
      label: `Everybody ${describe(narrowed.conditions, fields, narrowed.match)}`,
      count: counted.value.all,
    });
  });
  if (!described.ok) return described;
  return ok({ ...view.value, who: [...view.value.who, described.value] });
}

/**
 * The export builder's choices from a sentence: only fields the builder
 * offers this person, an audience it offers (or the directory's own
 * conditions, counted as this person may list them), a date no later than
 * today, and a reason drafted for them to change. Nothing is exported: the
 * person reviews it and presses Export, which runs as it always does.
 */
export async function planExport(
  deps: SelectionDeps,
  asking: Asking,
  input: PlanAsk,
): Promise<Result<ExportPlanView>> {
  const sentence = input.sentence.trim();
  const builder = await exportBuilderView(deps, asking);
  if (!builder.ok) return builder;
  const filters = await run(deps.service, asking.tenantId, async (tx) =>
    ok(await filterFields(deps, tx, asking)),
  );
  if (!filters.ok) return filters;
  const cat: ExportCatalogue = {
    today: builder.value.today,
    fields: builder.value.sections.flatMap((s) =>
      s.fields.map((f) => ({ key: f.key, label: f.label, section: s.label })),
    ),
    audiences: builder.value.who.map((w) => ({ value: w.value, label: w.label })),
    filters: filters.value,
  };
  const rules = exportByRules(sentence, cat);
  const consulted = await consult(deps, asking, deps.exportBudget, {
    instruction: EXPORT_INSTRUCTION,
    context: exportContext(sentence, cat),
    about: 'configuration',
  });
  const heard = 'answer' in consulted ? readExportAnswer(consulted.answer, cat) : null;
  const plan = heard ?? rules;
  const reason = plan.reason ?? draftedReason(plan, cat, aboutPayroll(sentence));
  const notes = [...plan.notes];

  // The audience, counted as the export will read it; conditions this
  // person may not run are dropped, and said.
  let who = 'everyone';
  let conditions: readonly IntentCondition[] = [];
  let match: 'all' | 'any' = 'all';
  let audience = builder.value.who.find((w) => w.value === 'everyone');
  let count = audience?.count ?? null;
  if (plan.audience.kind === 'segment') {
    const value = plan.audience.value;
    const segment = builder.value.who.find((w) => w.value === value);
    if (segment !== undefined) {
      who = segment.value;
      audience = segment;
      count = segment.count;
    }
  } else if (plan.audience.kind === 'conditions') {
    const refine = { conditions: plan.audience.conditions, match: plan.audience.match };
    const counted = await run(deps.service, asking.tenantId, (tx) =>
      deps.service.access.count(tx, { ...asking, refine }),
    );
    if (counted.ok) {
      who = 'conditions';
      conditions = refine.conditions;
      match = refine.match;
      count = counted.value.all;
    } else {
      notes.push('You can’t narrow an export by what was described, so it is everybody.');
    }
  }
  return ok({
    who,
    conditions,
    match,
    audience:
      who === 'conditions'
        ? `Everybody ${describe(conditions, filters.value, match)}`
        : (audience?.label ?? 'Everybody you can see'),
    count,
    fields: plan.fields,
    asOf: plan.asOf,
    format: plan.format,
    photos: plan.photos,
    reason,
    by: heard === null ? 'rules' : 'assistant',
    note: heard !== null ? null : 'note' in consulted ? consulted.note : UNREADABLE,
    notes,
  });
}
