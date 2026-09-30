import { ok, type Result } from '@kithena/domain-kit';

import type { PlanBudget } from '../../domain/import/new-fields.js';
import {
  factsFor,
  filled,
  phrasedFrom,
  WHAT_CHANGED_INSTRUCTION,
  whatChangedContext,
} from '../../domain/insights/what-changed.js';
import type { AssistantPort } from '../assistant/assistant-port.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { analyticsView, type InsightsTab } from './analytics.js';
import type { ScreenDeps } from './record.js';

/**
 * "What changed" on one Insights tab, reworded by the assistant where there
 * is one (`domain/insights/what-changed.ts`).
 *
 * The figures are the tab's own, read as `analyticsView` reads them — as this
 * viewer, under the segment in the address, suppressed below the cohort
 * minimum where they were counted — so this can say nothing the tab would
 * not show. The model is shown People's sentences with every figure and
 * every group's name held back as a placeholder, through the AI gateway in
 * its `aggregates` mode, which refuses any number; its answer is checked and
 * filled in here. With no model, no budget left this hour, a refusal, a
 * timeout or an answer that fails the check, People's own sentences stand,
 * and `byModel` says which the viewer is reading.
 */

export interface Phraser {
  readonly assistant: AssistantPort;
  readonly budget: PlanBudget;
}

export interface WhatChanged {
  readonly tab: InsightsTab;
  readonly sentences: readonly string[];
  readonly byModel: boolean;
}

export async function whatChanged(
  deps: ScreenDeps & { readonly phraser?: Phraser },
  asking: Asking,
  request: { readonly tab: InsightsTab; readonly segmentId?: string },
): Promise<Result<WhatChanged>> {
  const view = await analyticsView(
    deps,
    asking,
    request.segmentId === undefined ? {} : { segmentId: request.segmentId },
  );
  if (!view.ok) return view;
  const facts = factsFor(view.value, request.tab);
  const ours: WhatChanged = { tab: request.tab, sentences: filled(facts), byModel: false };
  const phraser = deps.phraser;
  if (facts.sentences.length === 0 || phraser === undefined) return ok(ours);
  if (!phraser.budget.take(asking.tenantId, deps.clock.instant()).ok) return ok(ours);

  const loaded = await run(deps.service, asking.tenantId, async (tx) => {
    await phraser.assistant.loadPolicies(tx, asking.tenantId);
    return ok(null);
  });
  if (!loaded.ok) return ok(ours);
  try {
    const answered = await phraser.assistant.complete(asking.tenantId, {
      instruction: WHAT_CHANGED_INSTRUCTION,
      context: whatChangedContext(request.tab, facts),
      about: 'aggregates',
    });
    if (!answered.ok) return ok(ours);
    const sentences = phrasedFrom(facts, JSON.parse(answered.value) as unknown);
    return ok(sentences === null ? ours : { ...ours, sentences, byModel: true });
  } catch {
    // No answer in time, or not JSON: People's own words stand.
    return ok(ours);
  }
}
