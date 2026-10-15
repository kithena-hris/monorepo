import type {
  CalendarDate,
  LaunchCountry,
  PublicationTarget,
  TargetState,
  WorkMode,
} from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * A job and where it is published (Recruiting PRD §8.1, §9.1, REC-016).
 *
 * `draft → open → on_hold → closed`, or `filled`. Published is not a state of
 * the job: each target has its own, `pending → live → paused → expired |
 * failed`, its own URL and its own error.
 */

export type JobState = 'draft' | 'open' | 'on_hold' | 'closed' | 'filled';

export interface Job {
  readonly id: string;
  readonly internalTitle: string;
  readonly title: string;
  readonly requisitionIds: readonly string[];
  readonly department: string | null;
  readonly countries: readonly LaunchCountry[];
  readonly workMode: WorkMode;
  readonly salaryShown: boolean;
  readonly languages: readonly string[];
  readonly internalOnly: boolean;
  readonly confidential: boolean;
  readonly openings: number;
  readonly hired: number;
  readonly targetHireDate: CalendarDate | null;
  readonly state: JobState;
}

const MOVES: Readonly<Record<JobState, readonly JobState[]>> = {
  draft: ['open', 'closed'],
  open: ['on_hold', 'closed', 'filled'],
  on_hold: ['open', 'closed'],
  closed: ['open'],
  filled: ['open'],
};

export function moveJob(job: Job, to: JobState): Result<Job> {
  if (!MOVES[job.state].includes(to)) {
    return err(
      failure(
        'JOB_STATE',
        `A ${job.state.replace('_', ' ')} job cannot become ${to.replace('_', ' ')}`,
      ),
    );
  }
  if (to === 'open' && job.title.trim() === '')
    return err(failure('TITLE_REQUIRED', 'Give the ad a title first', ['title']));
  return ok({ ...job, state: to });
}

/** One hire against the job; the last opening fills it (PRD §21.5). */
export function hireInto(job: Job): Result<Job> {
  if (job.state !== 'open' && job.state !== 'on_hold')
    return err(failure('JOB_STATE', 'Only an open job is hired into'));
  const hired = job.hired + 1;
  return ok({ ...job, hired, state: hired >= job.openings ? 'filled' : job.state });
}

/** Whether a job takes applications: open, and live somewhere. */
export const acceptsApplications = (job: Job): boolean => job.state === 'open';

/* ------------------------------------------------------------- targets -- */

export interface Target {
  readonly target: PublicationTarget;
  readonly state: TargetState;
  readonly url: string | null;
  readonly error: string | null;
  readonly liveSince: string | null;
  readonly expiresOn: CalendarDate | null;
}

/** Targets Phase 1 can publish to itself; the rest wait for an adapter (PRD §26.1). */
export const SELF_PUBLISHED: ReadonlySet<PublicationTarget> = new Set([
  'careers_page',
  'kithena_jobs',
  'google_for_jobs',
  'xml_feed',
  'internal_board',
  'share_link',
]);

/** Targets that need the job public: everything but the internal board. */
const PUBLIC_TARGETS: ReadonlySet<PublicationTarget> = new Set([
  'careers_page',
  'kithena_jobs',
  'google_for_jobs',
  'xml_feed',
  'share_link',
  'indeed',
  'glassdoor',
  'linkedin',
]);

const TARGET_MOVES: Readonly<Record<TargetState, readonly TargetState[]>> = {
  pending: ['live', 'failed'],
  live: ['paused', 'expired', 'failed'],
  paused: ['live', 'expired'],
  expired: ['pending'],
  failed: ['pending'],
};

export function moveTarget(
  target: Target,
  to: TargetState,
  at: string,
  detail: { url?: string; error?: string } = {},
): Result<Target> {
  if (!TARGET_MOVES[target.state].includes(to)) {
    return err(failure('TARGET_STATE', `A ${target.state} listing cannot become ${to}`));
  }
  return ok({
    ...target,
    state: to,
    url: detail.url ?? target.url,
    error: to === 'failed' ? (detail.error ?? 'The board refused the listing') : null,
    liveSince:
      to === 'live' ? (target.state === 'paused' ? target.liveSince : at) : target.liveSince,
  });
}

/**
 * Ask to publish a job to a target. Refused for a job that is not open, a
 * public target on an internal-only job, and Google for Jobs or the feed
 * without the careers page (they read that page).
 */
export function requestPublication(
  job: Job,
  current: readonly Target[],
  target: PublicationTarget,
  adChecksPassed: boolean,
): Result<Target> {
  if (job.state !== 'open')
    return err(failure('JOB_NOT_OPEN', 'Open the job before publishing it'));
  if (!adChecksPassed && target !== 'internal_board') {
    return err(failure('AD_CHECKS', 'The ad has checks to fix before it can be published'));
  }
  if (job.internalOnly && PUBLIC_TARGETS.has(target)) {
    return err(failure('INTERNAL_ONLY', 'This job is internal only'));
  }
  if (
    (target === 'google_for_jobs' || target === 'xml_feed' || target === 'glassdoor') &&
    !current.some((t) => t.target === 'careers_page' && t.state !== 'failed')
  ) {
    return err(
      failure(
        'NEEDS_CAREERS_PAGE',
        'This target reads the job’s page on the careers site; publish there first',
      ),
    );
  }
  if (target === 'glassdoor' && !current.some((t) => t.target === 'indeed' && t.state === 'live')) {
    return err(
      failure(
        'THROUGH_INDEED',
        'Glassdoor lists jobs it receives from Indeed; publish to Indeed first',
      ),
    );
  }
  const existing = current.find((t) => t.target === target);
  if (existing !== undefined && existing.state !== 'expired' && existing.state !== 'failed') {
    return err(failure('ALREADY', 'Already published there'));
  }
  return ok({ target, state: 'pending', url: null, error: null, liveSince: null, expiresOn: null });
}

/** Unpublishing takes the job down everywhere at once (PRD §9.1). */
export function unpublishAll(targets: readonly Target[]): Target[] {
  return targets.map((t) =>
    t.state === 'live' || t.state === 'paused' || t.state === 'pending'
      ? { ...t, state: 'expired', error: null }
      : t,
  );
}

/** A job slug for a URL: lowercase ASCII words joined by hyphens, with a short id. */
export function slugFor(title: string, id: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\)/gu, ' ')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
    .replace(/-+$/u, '');
  return `${words || 'job'}-${id.replace(/-/gu, '').slice(0, 8)}`;
}
