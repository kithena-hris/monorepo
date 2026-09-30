import { ok, type Result } from '@kithena/domain-kit';
import type { Prompt } from '@kithena/telemetry';
import * as z from 'zod';

import type { IntentCondition } from '../../domain/assistant/intent.js';
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
  isPlainSearch,
  readDirectoryAnswer,
  readExportAnswer,
  type ExportCatalogue,
  type ExportPlan,
} from '../../domain/assistant/selection.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { exportBuilderView } from '../screens/operations.js';
import type { ScreenDeps } from '../screens/record.js';
import { describe, filterFields } from './ask.js';
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

/** Who read the sentence: a name search, the assistant, or People's own rules. */
export type ReadBy = 'search' | 'assistant' | 'rules';

export interface DirectoryPlanView {
  readonly search: string | null;
  readonly conditions: readonly IntentCondition[];
  readonly match: 'all' | 'any';
  /** `key:asc` or `key:desc`, as the directory's address carries it; null for its own order. */
  readonly sort: string | null;
  /** Words nothing was made of, to say so. */
  readonly unused: readonly string[];
  readonly by: ReadBy;
  /** Why the assistant did not read it, when it did not; null otherwise. */
  readonly note: string | null;
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

/**
 * The directory's filters from a sentence. A name alone is a name search,
 * with no model; anything else is read by the assistant where it can, and
 * by People's rules where it cannot.
 */
export async function planDirectory(
  deps: SelectionDeps,
  asking: Asking,
  input: PlanAsk,
): Promise<Result<DirectoryPlanView>> {
  const sentence = input.sentence.trim();
  const fields = await run(deps.service, asking.tenantId, async (tx) =>
    ok(await filterFields(deps, tx, asking)),
  );
  if (!fields.ok) return fields;
  if (isPlainSearch(sentence, fields.value)) {
    return ok({
      search: sentence,
      conditions: [],
      match: 'all',
      sort: null,
      unused: [],
      by: 'search',
      note: null,
    });
  }
  const today = deps.clock.instant().slice(0, 10);
  const rules = directoryByRules(sentence, fields.value, today);
  const shown = forModel(fields.value);
  const consulted = await consult(deps, asking, deps.searchBudget, {
    instruction: DIRECTORY_INSTRUCTION,
    context: directoryContext(sentence, shown, today),
    about: 'configuration',
  });
  const heard = 'answer' in consulted ? readDirectoryAnswer(consulted.answer, shown) : null;
  const plan = heard ?? rules;
  return ok({
    search: plan.search,
    conditions: plan.conditions,
    match: plan.match,
    sort: sortOf(plan.sort),
    unused: plan.unused,
    by: heard === null ? 'rules' : 'assistant',
    note: heard !== null ? null : 'note' in consulted ? consulted.note : UNREADABLE,
  });
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
