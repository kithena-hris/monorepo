import {
  allCapabilities,
  type AssistantAnswer,
  type AssistantQuestion,
  type ModuleKey,
  type RuntimeCatalogue,
} from '@kithena/contracts';
import type { Clock } from '@kithena/domain-kit';

import {
  answerOf,
  failedAnswer,
  NOT_ALLOWED,
  NOT_IN_KITHENA,
  NOT_NOW,
  refusedAnswer,
  TOO_SLOW,
  UNAVAILABLE,
  unavailableAnswer,
  unclearAnswer,
  WHO_ARE_YOU,
} from '../domain/answer.js';
import { todayIn } from '../domain/dates.js';
import { execute, type Call } from '../domain/execute.js';
import { mask, maskOffer, refused, unmask } from '../domain/mask.js';
import { offer, readPlan } from '../domain/plan.js';
import type { Identity, Modules, Planner, Principal } from './ports.js';

/**
 * One question, answered across every module the company has (assistant PRD
 * §7, §10).
 *
 * Who is asking, from identity; what each of their modules offers them, in
 * parallel, leaving out one that fails; the question masked and refused where
 * it must be; a plan from the model; the plan unmasked, read and run in
 * waves, each call as the asker; the answer written from what came back. The
 * use case decides nothing about who may see what: every module does that
 * for itself.
 *
 * Deadlines: the client gives each call 4 s, this gives the whole question
 * 15 s and aborts what is still in flight. At most 8 questions run at once;
 * more wait. A company may plan `plansPerHour` questions an hour.
 */

export interface AskDeps {
  readonly identity: Identity;
  readonly modules: Modules;
  /** Null where no model is configured: every question is "not available". */
  readonly planner: Planner | null;
  readonly clock: Clock;
  /** `ASSISTANT_PLANS_PER_HOUR`, 120 by default. */
  readonly plansPerHour?: number;
  /** The company's own app origin from its slug, for links; null where unknown. */
  readonly originOf?: (slug: string) => string | null;
  /** The whole question's deadline; 15 s. */
  readonly questionMs?: number;
}

/** How a question ended, for the counters (§13.1). */
export type Outcome = 'answered' | 'unclear' | 'unavailable' | 'refused' | 'failed' | 'too_broad';

/** The answer, and what the route may log about it: codes and names, never words. */
export interface Asked {
  readonly answer: AssistantAnswer;
  readonly outcome: Outcome;
  /** Why, as a code: a plan refusal, a failure, a refusal's kind. */
  readonly reason?: string;
  /** The capabilities called, in the order they were. */
  readonly called: readonly string[];
  /** The plan's shape, where there was one. */
  readonly steps?: number;
  readonly answerKind?: string;
}

/** Modules that serve the assistant at all. */
const SERVING: readonly ModuleKey[] = [...new Set(allCapabilities.map((c) => c.module))];

const said = (text: string): AssistantAnswer => ({
  text,
  understood: 'Not sent to the assistant',
  people: [],
  answered: false,
});

/**
 * Questions a company has asked in the last hour, in this process's memory.
 * ponytail: one process, one count; move it to Postgres or Valkey if the
 * assistant ever runs more than one.
 */
function hourly(limit: number, clock: Clock): (tenantId: string) => boolean {
  const used = new Map<string, number[]>();
  return (tenantId) => {
    const at = clock.now().getTime();
    const recent = (used.get(tenantId) ?? []).filter((t) => at - t < 3_600_000);
    if (recent.length >= limit) return false;
    used.set(tenantId, [...recent, at]);
    return true;
  };
}

/** At most `max` jobs at once; the rest wait their turn, first come first served. */
function gate(max: number): <T>(job: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async (job) => {
    if (running >= max) await new Promise<void>((go) => waiting.push(go));
    else running += 1;
    try {
      return await job();
    } finally {
      // The slot passes straight to the next in line, so nobody slips in between.
      const next = waiting.shift();
      if (next === undefined) running -= 1;
      else next();
    }
  };
}

export function asker(
  deps: AskDeps,
): (q: AssistantQuestion, correlationId: string) => Promise<Asked> {
  const budget = hourly(deps.plansPerHour ?? 120, deps.clock);
  const queue = gate(8);
  const questionMs = deps.questionMs ?? 15_000;

  async function answer(
    q: AssistantQuestion,
    correlationId: string,
    signal: AbortSignal,
    called: string[],
  ): Promise<Asked> {
    // No model, nothing to plan with: said before anybody is looked up.
    if (deps.planner === null) {
      return { answer: said(UNAVAILABLE), outcome: 'failed', reason: 'NO_MODEL', called };
    }
    const { planner } = deps;
    const who = await deps.identity.asker(q.tenantId, q.email);
    if (!who.ok) {
      return {
        answer: said(who.error === 'NOT_FOUND' ? NOT_IN_KITHENA : WHO_ARE_YOU),
        outcome: 'failed',
        reason: who.error === 'NOT_FOUND' ? 'NOT_IN_KITHENA' : 'IDENTITY',
        called,
      };
    }
    const asking = who.value;
    const as: Principal = {
      userId: asking.accountId,
      tenantId: q.tenantId,
      entitlements: asking.entitlements,
      impersonatedBy: null,
      viewedBy: null,
    };

    // The company's modules this deployment can reach, asked in parallel.
    const entitled = new Set<string>(asking.entitlements);
    const reachable = SERVING.filter(
      (m) => entitled.has(`module.${m}`) && deps.modules.configured.includes(m),
    );
    const fetched = await Promise.all(
      reachable.map(async (m) => ({ m, c: await deps.modules.catalogue(m, as, correlationId) })),
    );
    const catalogues = fetched.flatMap(({ c }) => (c === null ? [] : [c]));
    const down = new Set(fetched.flatMap(({ m, c }) => (c === null ? [m] : [])));
    const present = catalogues.map((c: RuntimeCatalogue) => c.module);
    const offered = offer(catalogues);
    const leaveTypes = catalogues.flatMap((c) => c.leaveTypes);

    const masked = mask(q.question, leaveTypes);
    const refusal = refused(masked.question);
    if (refusal !== null) {
      return { answer: refusedAnswer(refusal), outcome: 'refused', reason: refusal.kind, called };
    }
    if (!budget(q.tenantId)) {
      return { answer: said(UNAVAILABLE), outcome: 'failed', reason: 'BUDGET', called };
    }

    const shown = maskOffer(offered, leaveTypes, masked.refs);
    const today = todayIn(asking.timeZone, deps.clock);
    const planned = await planner.plan(q.tenantId, {
      question: masked.question,
      today,
      offer: shown,
      unavailable: SERVING.filter((m) => !present.includes(m)),
      denied: catalogues.flatMap((c) => c.denied),
    });
    if (!planned.ok) {
      return planned.code === 'NOT_ALLOWED'
        ? { answer: said(NOT_ALLOWED), outcome: 'refused', reason: 'AI_GATEWAY', called }
        : { answer: said(NOT_NOW), outcome: 'failed', reason: 'MODEL', called };
    }
    const read = readPlan(planned.text, shown);
    if (!read.ok) {
      return { answer: unclearAnswer(), outcome: 'unclear', reason: read.error.code, called };
    }
    const plan = unmask(read.value, masked.refs);
    switch (plan.kind) {
      case 'unclear':
        return { answer: unclearAnswer(plan.reply), outcome: 'unclear', called };
      case 'unavailable':
        // Entitled but not answering is not "your company doesn't use it".
        if (down.has(plan.module)) {
          const failed = failedAnswer({ code: 'UNREACHABLE', module: plan.module });
          return { answer: failed, outcome: 'failed', reason: 'UNREACHABLE', called };
        }
        // Present and answering: the model misread the question, not the company.
        if (present.includes(plan.module)) {
          return { answer: unclearAnswer(), outcome: 'unclear', reason: 'UNAVAILABLE', called };
        }
        return { answer: unavailableAnswer(plan.module, present), outcome: 'unavailable', called };
      case 'plan':
        break;
    }

    const shape = { steps: plan.steps.length, answerKind: plan.answer.kind };
    const call: Call = (step, input) => {
      called.push(step.capability.name);
      return deps.modules.call(step.capability, input, as, correlationId, signal);
    };
    const ran = await execute(plan, today, call);
    if (!ran.ok) {
      return {
        answer: failedAnswer(ran.error),
        outcome: ran.error.code === 'TOO_BROAD' ? 'too_broad' : 'failed',
        reason: ran.error.code,
        called,
        ...shape,
      };
    }
    const written = answerOf(plan, ran.value, {
      today,
      channel: q.channel,
      offered,
      leaveTypes,
      origin: deps.originOf?.(asking.slug) ?? null,
      // Time Off's, read with this question's catalogue: switched off, the next question obeys.
      namesPrivateLeave: catalogues.some((c) => c.module === 'timeoff' && c.chatNamesPrivateLeave),
    });
    return { answer: written, outcome: 'answered', called, ...shape };
  }

  return (q, correlationId) =>
    queue(async () => {
      const deadline = new AbortController();
      const called: string[] = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<Asked>((resolve) => {
        timer = setTimeout(() => {
          deadline.abort();
          resolve({ answer: said(TOO_SLOW), outcome: 'failed', reason: 'TOO_SLOW', called });
        }, questionMs);
      });
      try {
        return await Promise.race([answer(q, correlationId, deadline.signal, called), late]);
      } finally {
        clearTimeout(timer);
      }
    });
}
