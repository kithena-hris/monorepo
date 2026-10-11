import {
  ASSISTANT_LIMITS,
  type CapabilityInput,
  type CapabilityOutput,
  type ModuleKey,
  type PersonRow,
  type StepId,
} from '@kithena/contracts';
import { err, ok, type Result } from '@kithena/domain-kit';

import { resolve, type Today } from './dates.js';
import type { ValidPlan, ValidStep } from './plan.js';

/**
 * Running a valid plan (assistant PRD §9.3, §9.5, §9.6).
 *
 * Scheduling and folding only: the call to a module is passed in, so this
 * holds no client, no timeout and no clock, and is tested with a fake. The
 * application wraps `call` with the deadlines and the abort.
 *
 * `within` is the only join: a step is called with the `ids` of the step it
 * narrows to as its `personIds`, and the module restricts its own query to
 * them, still as the asker. A later step can narrow, never widen. A failed
 * step fails every step after it, and the answer is never built from a
 * partial join.
 */

type Plan = Extract<ValidPlan, { kind: 'plan' }>;

/** Why a module's answer was not had: unreachable, slow or off-contract, or a refusal in its words. */
export type CallFailure =
  { readonly code: 'UNREACHABLE' } | { readonly code: 'REFUSED'; readonly message: string };
export type CallOutcome = Result<CapabilityOutput, CallFailure>;
/** One capability call as the asker. The application's: it holds the client and the deadline. */
export type Call = (step: ValidStep, input: CapabilityInput) => Promise<CallOutcome>;

export type ExecutionFailure =
  | { readonly code: 'UNREACHABLE'; readonly module: ModuleKey }
  | { readonly code: 'REFUSED'; readonly module: ModuleKey; readonly message: string }
  /** More people than one request can carry to the next step, or than a count by group can read. */
  | { readonly code: 'TOO_BROAD' }
  /** A range that ends before it starts. */
  | { readonly code: 'DATES' };

/** One group of a count by group; `label` null for the rows with no value for it. */
export interface Group {
  readonly label: string | null;
  readonly count: number;
}

export interface Executed {
  /** The step whose result answers: the answer's, or an earlier one where a name matched nobody or several. */
  readonly answered: ValidStep;
  readonly output: CapabilityOutput;
  /** Every step that returned, in plan order: their `described` make the "understood" line. */
  readonly outputs: ReadonlyMap<StepId, CapabilityOutput>;
  /** For a count by group. */
  readonly groups?: readonly Group[];
}

/** Waves of steps that can run at once: each step one wave after the step it narrows to. */
export function order(plan: Plan): ValidStep[][] {
  const waves: ValidStep[][] = [];
  const depth = new Map<StepId, number>();
  for (const step of plan.steps) {
    // `within` always names an earlier step: `readPlan` refused anything else.
    const d = step.within === undefined ? 0 : (depth.get(step.within) ?? 0) + 1;
    depth.set(step.id, d);
    (waves[d] ??= []).push(step);
  }
  return waves;
}

/**
 * How much a call asks for, set by the assistant and never by the model
 * (§9.3): the total alone for a count, 25 rows for a list, every row for a
 * count by group, and the ids alone for a step another narrows to.
 */
export function limitFor(step: ValidStep, plan: Plan): Pick<CapabilityInput, 'limit' | 'ids'> {
  const { output } = step.capability;
  if (output === 'profile') return {};
  const feeds = output === 'people' && plan.steps.some((s) => s.within === step.id);
  const { answer } = plan;
  const answers =
    answer.step === step.id || (answer.kind === 'one' && answer.also?.includes(step.id) === true);
  const limit = !answers
    ? 0
    : answer.kind === 'count'
      ? answer.by === undefined
        ? 0
        : ASSISTANT_LIMITS.ids
      : ASSISTANT_LIMITS.listed;
  return feeds ? { limit, ids: true } : { limit };
}

/** The rows of a count by group, counted per value: largest first, then by name. */
export function grouped(rows: readonly PersonRow[], by: string): Group[] {
  const counts = new Map<string | null, number>();
  for (const row of rows) {
    const label = row.groups[by] ?? null;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .toSorted(
      (a, b) =>
        b.count - a.count ||
        (a.label === null ? 1 : b.label === null ? -1 : a.label.localeCompare(b.label)),
    );
}

/** What a step ended as: a result, a failure, or stopped by an earlier step that answers instead. */
type Ended =
  | { readonly kind: 'done'; readonly output: CapabilityOutput }
  | { readonly kind: 'failed'; readonly failure: ExecutionFailure }
  | { readonly kind: 'stopped'; readonly by: ValidStep };

const failed = (failure: ExecutionFailure): Ended => ({ kind: 'failed', failure });

async function run(
  step: ValidStep,
  plan: Plan,
  today: Today,
  ended: ReadonlyMap<StepId, Ended>,
  call: Call,
): Promise<Ended> {
  const { module } = step.capability;
  let personIds: CapabilityInput['personIds'];
  if (step.within !== undefined) {
    const before = ended.get(step.within);
    const source = plan.steps.find((s) => s.id === step.within);
    if (before === undefined || source === undefined)
      throw new Error('a step ran before the one it narrows to');
    if (before.kind !== 'done') return before;
    const found = before.output;
    // A name that matched nobody or several: that is the answer, not something to narrow to.
    if (found.kind !== 'people') return { kind: 'stopped', by: source };
    if (found.ids === undefined)
      return failed({ code: 'UNREACHABLE', module: source.capability.module });
    if (found.total > found.ids.length) return failed({ code: 'TOO_BROAD' });
    personIds = found.ids;
  }

  const { on, filters, ...rest } = step.input;
  const range = on === undefined ? undefined : resolve(on, today);
  if (range === null) return failed({ code: 'DATES' });
  const input: CapabilityInput = {
    ...rest,
    ...(filters === undefined ? {} : { filters: [...filters] }),
    ...(range === undefined ? {} : { on: range }),
    ...limitFor(step, plan),
    ...(personIds === undefined ? {} : { personIds }),
  };

  const outcome = await call(step, input);
  if (!outcome.ok) {
    return failed(
      outcome.error.code === 'REFUSED'
        ? { code: 'REFUSED', module, message: outcome.error.message }
        : { code: 'UNREACHABLE', module },
    );
  }
  return { kind: 'done', output: outcome.value };
}

/** The plan run wave by wave through `call`, folded into what answers it. */
export async function execute(
  plan: Plan,
  today: Today,
  call: Call,
): Promise<Result<Executed, ExecutionFailure>> {
  const ended = new Map<StepId, Ended>();
  for (const wave of order(plan)) {
    // oxlint-disable-next-line no-await-in-loop -- a wave needs the one before it
    const results = await Promise.all(wave.map((step) => run(step, plan, today, ended, call)));
    wave.forEach((step, i) => ended.set(step.id, results[i] as Ended));
  }

  const outputs = new Map<StepId, CapabilityOutput>();
  for (const step of plan.steps) {
    const e = ended.get(step.id);
    if (e?.kind === 'done') outputs.set(step.id, e.output);
  }

  const answerStep = plan.steps.find((s) => s.id === plan.answer.step);
  const end = answerStep === undefined ? undefined : ended.get(answerStep.id);
  if (answerStep === undefined || end === undefined) throw new Error('the answer names no step');
  if (end.kind === 'failed') return err(end.failure);
  // An answer over several queues is never written from some of them.
  for (const id of plan.answer.kind === 'one' ? (plan.answer.also ?? []) : []) {
    const queue = ended.get(id);
    if (queue?.kind === 'failed') return err(queue.failure);
  }
  if (end.kind === 'stopped') {
    const output = outputs.get(end.by.id);
    if (output === undefined) throw new Error('a step was stopped by one that did not return');
    return ok({ answered: end.by, output, outputs });
  }

  const { output } = end;
  if (plan.answer.kind === 'count' && plan.answer.by !== undefined && output.kind === 'people') {
    if (output.total > output.rows.length) return err({ code: 'TOO_BROAD' });
    return ok({
      answered: answerStep,
      output,
      outputs,
      groups: grouped(output.rows, plan.answer.by),
    });
  }
  return ok({ answered: answerStep, output, outputs });
}
