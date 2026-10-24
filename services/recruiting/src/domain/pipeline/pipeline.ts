import type { StageCategory } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Pipelines (Recruiting PRD §12.1): an ordered list of stages, each with a
 * category analytics reads, the hiring team's name and the candidate's name
 * (or none, to hide it). A job copies its template; changing the template
 * does not touch open jobs.
 */

export interface Stage {
  readonly id: string;
  readonly name: string;
  /** What the candidate sees on their page; null hides the stage from them. */
  readonly candidateName: string | null;
  readonly category: StageCategory;
  readonly automations: readonly Automation[];
}

export type Automation =
  | { readonly kind: 'email'; readonly templateId: string; readonly delayMinutes: number }
  | { readonly kind: 'request_scorecards' }
  | { readonly kind: 'send_questionnaire'; readonly questionnaireId: string }
  | { readonly kind: 'self_schedule'; readonly interviewKey: string }
  | { readonly kind: 'assign_thread'; readonly recruiterId: string };

const ORDER: readonly StageCategory[] = [
  'applied',
  'screening',
  'interview',
  'assessment',
  'works_council',
  'offer',
  'contract',
  'hired',
];
export const categoryRank = (category: StageCategory): number => ORDER.indexOf(category);

/** A pipeline starts at `applied`, ends at `hired`, never goes back a category, and has an `offer`. */
export function validatePipeline(stages: readonly Stage[]): Result<readonly Stage[]> {
  if (stages.length < 2)
    return err(failure('PIPELINE_SHORT', 'A pipeline needs at least an applied and a hired stage'));
  if (stages[0]?.category !== 'applied')
    return err(failure('PIPELINE_START', 'The first stage is an applied stage'));
  if (
    stages.at(-1)?.category !== 'hired' ||
    stages.filter((s) => s.category === 'hired').length !== 1
  ) {
    return err(failure('PIPELINE_END', 'The last stage, and only the last, is the hired stage'));
  }
  if (!stages.some((s) => s.category === 'offer'))
    return err(failure('PIPELINE_OFFER', 'A pipeline has an offer stage'));
  for (const [index, stage] of stages.entries()) {
    const before = stages[index - 1];
    if (before !== undefined && categoryRank(stage.category) < categoryRank(before.category)) {
      return err(
        failure(
          'PIPELINE_ORDER',
          `“${stage.name}” is a ${stage.category} stage after a ${before.category} one`,
        ),
      );
    }
    if (stage.name.trim() === '') return err(failure('STAGE_NAME', 'Every stage has a name'));
  }
  if (new Set(stages.map((s) => s.id)).size !== stages.length)
    return err(failure('STAGE_IDS', 'Stage ids repeat'));
  return ok(stages);
}

/**
 * A German entity with a works council gains the § 99 BetrVG stage before
 * the first offer stage (PRD §19.9), added by the domain, not the template.
 */
export function withWorksCouncil(stages: readonly Stage[], newId: () => string): Stage[] {
  if (stages.some((s) => s.category === 'works_council')) return [...stages];
  const at = stages.findIndex((s) => s.category === 'offer');
  const council: Stage = {
    id: newId(),
    name: 'Works council',
    candidateName: null,
    category: 'works_council',
    automations: [],
  };
  return at === -1 ? [...stages] : [...stages.slice(0, at), council, ...stages.slice(at)];
}

/**
 * The contract stage between the accepted offer and the hire, for a pipeline
 * made before it existed: an accepted offer moves there, and the signature
 * moves on to the hired stage. A pipeline that has one is left as it is.
 */
export function withContractStage(stages: readonly Stage[], newId: () => string): Stage[] {
  if (stages.some((s) => s.category === 'contract')) return [...stages];
  const at = stages.findIndex((s) => s.category === 'hired');
  const contract: Stage = {
    id: newId(),
    name: 'Contract',
    candidateName: 'Contract',
    category: 'contract',
    automations: [],
  };
  return at === -1 ? [...stages] : [...stages.slice(0, at), contract, ...stages.slice(at)];
}

/** The template every company starts with. */
export function defaultPipeline(newId: () => string): Stage[] {
  const stage = (
    name: string,
    category: StageCategory,
    candidateName: string | null,
    automations: Automation[] = [],
  ): Stage => ({
    id: newId(),
    name,
    candidateName,
    category,
    automations,
  });
  return [
    stage('Applied', 'applied', 'Application received'),
    stage('Screening', 'screening', 'In review'),
    stage('Interview', 'interview', 'Interviews', [{ kind: 'request_scorecards' }]),
    stage('Assessment', 'assessment', 'Assessment'),
    stage('Offer', 'offer', 'Offer'),
    stage('Contract', 'contract', 'Contract'),
    stage('Hired', 'hired', 'Hired'),
  ];
}

const DAY_MS = 86_400_000;

/** The wall clock in a zone: year, month, day, hour and minute as numbers. */
function wallClock(at: Date, timeZone: string): readonly [number, number, number, number, number] {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const n = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return [n('year'), n('month'), n('day'), n('hour'), n('minute')];
}

/**
 * When a knockout's rejection is told (PRD §15.2): the next working day,
 * Monday to Friday, at 09:00 in the candidate's zone. Never the moment they
 * apply, which reads as a machine's answer to a person's application.
 *
 * ponytail: weekends only; the workplace's public holidays when Time Off's
 * calendar reaches the intake.
 */
export function nextWorkingMorning(at: Date, timeZone: string): Date {
  const [y, m, d] = wallClock(at, timeZone);
  let day = Date.UTC(y, m - 1, d) + DAY_MS;
  while ([0, 6].includes(new Date(day).getUTCDay())) day += DAY_MS;
  // 09:00 on that day as if the zone were UTC, then moved by the zone's offset at that moment.
  const naive = day + 9 * 3_600_000;
  const [ly, lm, ld, lh, lmin] = wallClock(new Date(naive), timeZone);
  const offset = Date.UTC(ly, lm - 1, ld, lh, lmin) - naive;
  return new Date(naive - offset);
}

/**
 * When an automated email may go (PRD §12.1): after its delay, and never
 * between 21:00 and 08:00 in the candidate's time zone — then at 08:00.
 */
export function sendAt(due: Date, timeZone: string): Date {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(due),
  );
  if (hour >= 8 && hour < 21) return due;
  const minute = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, minute: '2-digit' }).format(due),
  );
  const hoursToEight = (hour >= 21 ? 24 - hour + 8 : 8 - hour) * 60 - minute;
  return new Date(
    due.getTime() + hoursToEight * 60_000 - due.getUTCSeconds() * 1000 - due.getUTCMilliseconds(),
  );
}
