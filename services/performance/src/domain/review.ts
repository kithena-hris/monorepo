import type {
  ActivityKind,
  AnswerValue,
  CalendarDate,
  FormAnswers,
  ReviewStatus,
} from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * A review (PRD §10, PRF-022 to PRF-026): its statuses, autosave against a
 * revision, submit, unlocks that only HR decides, detaching, release and
 * acknowledgement, and the hold calibration puts on a scored review.
 */

export interface Suggestion {
  readonly value: AnswerValue;
  readonly reason: string;
  readonly confirmed: boolean;
}

export interface Submission {
  readonly revision: number;
  readonly answers: FormAnswers;
  readonly at: string;
  readonly scoreHundredths: number | null;
}

export interface Review {
  readonly id: string;
  readonly cycleId: string | null;
  readonly kind: ActivityKind;
  readonly subjectId: string;
  readonly authorId: string;
  readonly templateId: string;
  readonly version: number;
  readonly status: ReviewStatus;
  readonly answers: FormAnswers;
  readonly revision: number;
  readonly savedAt: string | null;
  readonly due: CalendarDate;
  /** Every submission kept (§10.5); the last is the one that stands. */
  readonly submitted: readonly Submission[];
  /** AI suggestions by question, marked until a person confirms each (§13.4). */
  readonly suggestions: Readonly<Record<string, Suggestion>>;
  /** Text answers drafted by AI and not yet edited. */
  readonly drafted: readonly string[];
  /** The writer's tools an AI draft drew on (§22.3): the subject is told which. */
  readonly toolHelp?: readonly string[];
  readonly unlock: {
    readonly reason: string;
    readonly at: string;
    readonly decided: {
      readonly approved: boolean;
      readonly by: string;
      readonly at: string;
      readonly note: string;
    } | null;
  } | null;
  readonly released: { readonly at: string; readonly by: string } | null;
  readonly acknowledged: { readonly at: string; readonly comment: string | null } | null;
  /** The writer's name hidden from the subject (§8.5). */
  readonly confidential: boolean;
  /** Shown to the subject at all. */
  readonly shared: boolean;
  /** Out of the cycle because its subject was removed (§10.7); `keep` is the author's word. */
  readonly detached: { readonly at: string; readonly keep: boolean | null } | null;
  /** A peer who declined to write it, with why. */
  readonly declined: { readonly reason: string; readonly at: string } | null;
  readonly handover: { readonly from: string; readonly note: string | null } | null;
  /**
   * Its writer stopped being the subject's manager while it was in progress
   * (§8.8): kept for them to read or delete, never submitted. `to` is the new
   * manager, who has a review of their own.
   */
  readonly formerManager?: { readonly at: string; readonly to: string | null } | null;
  /** Created hidden while the cycle launches, shown together at in progress (§8.7). */
  readonly hidden: boolean;
  /** A score changed in calibration, beside the reviewer's (§17). */
  readonly calibrated: {
    readonly hundredths: number;
    readonly was: number | null;
    readonly reason: string;
    readonly by: string;
    readonly at: string;
    readonly sessionId: string;
  } | null;
  /** Goals attached at launch, rated in a generated section when the cycle scores them (§14.6). */
  readonly goals: readonly string[];
  readonly createdAt: string;
}

/** A review as a launch, a late joiner or an approved nomination creates it. */
export function newReview(input: {
  readonly id: string;
  readonly cycleId: string;
  readonly kind: ActivityKind;
  readonly subjectId: string;
  readonly authorId: string;
  readonly templateId: string;
  readonly version: number;
  readonly due: CalendarDate;
  readonly confidential: boolean;
  readonly hidden: boolean;
  readonly goals: readonly string[];
  readonly at: string;
}): Review {
  return {
    ...input,
    status: 'not_started',
    answers: {},
    revision: 0,
    savedAt: null,
    submitted: [],
    suggestions: {},
    drafted: [],
    unlock: null,
    released: null,
    acknowledged: null,
    shared: true,
    detached: null,
    declined: null,
    handover: null,
    calibrated: null,
    createdAt: input.at,
  };
}

/**
 * What a subject's manager changing does to one of their manager reviews in a
 * running cycle (§8.8). A submitted one is kept beside the new manager's; one
 * not started is removed; one in progress stays its writer's to read or
 * delete, and can no longer be submitted. Anything else is left alone.
 */
export type ManagerChange = 'keep' | 'remove' | 'outdate';
export function onManagerChange(r: Review, managerId: string | null): ManagerChange {
  if (r.kind !== 'manager' || r.authorId === managerId) return 'keep';
  if (r.detached !== null || r.status === 'cancelled' || isSubmitted(r)) return 'keep';
  if (r.status === 'not_started') return 'remove';
  return r.status === 'in_progress' ? 'outdate' : 'keep';
}

/** The key that makes creating a review idempotent (§8.7). */
export const reviewKey = (
  cycleId: string,
  kind: string,
  subjectId: string,
  authorId: string,
): string => `${cycleId}:${kind}:${subjectId}:${authorId}`;

const WRITABLE: readonly ReviewStatus[] = ['not_started', 'in_progress', 'unlocked'];
const SUBMITTED: readonly ReviewStatus[] = ['locked', 'unlock_requested', 'unlocked', 'in_review'];

export const writable = (r: Review): boolean => WRITABLE.includes(r.status) && r.detached === null;
export const isSubmitted = (r: Review): boolean =>
  SUBMITTED.includes(r.status) || (r.status === 'completed' && r.submitted.length > 0);

/** The answers that stand: the last submission once there is one, the draft before. */
export const standing = (r: Review): FormAnswers => r.submitted.at(-1)?.answers ?? r.answers;

/** An autosave (§10.2): a patch over the revision it was based on; a stale one is refused. */
export function save(r: Review, patch: FormAnswers, basedOn: number, at: string): Result<Review> {
  if (!writable(r)) return err(failure('LOCKED', 'This review is submitted; ask HR to unlock it'));
  if (basedOn !== r.revision)
    return err(failure('STALE_REVISION', `Revision ${String(r.revision)} is newer`));
  const edited = new Set(Object.keys(patch));
  return ok({
    ...r,
    answers: { ...r.answers, ...patch },
    revision: r.revision + 1,
    savedAt: at,
    status: r.status === 'not_started' ? 'in_progress' : r.status,
    drafted: r.drafted.filter((q) => !edited.has(q)),
    // Changing a suggested answer is deciding it.
    suggestions: Object.fromEntries(
      Object.entries(r.suggestions).map(([q, s]) => [
        q,
        edited.has(q) ? { ...s, confirmed: true } : s,
      ]),
    ),
  });
}

/** Suggested numbers still waiting for a person (§13.7): submit waits on these. */
export const unconfirmed = (r: Review): string[] =>
  Object.entries(r.suggestions)
    .filter(([, s]) => !s.confirmed)
    .map(([q]) => q);

export function submit(r: Review, at: string, scoreHundredths: number | null): Result<Review> {
  if (!writable(r)) return err(failure('LOCKED', 'This review is already submitted'));
  if (r.formerManager !== undefined && r.formerManager !== null)
    return err(
      failure(
        'NOT_THE_MANAGER',
        'You are no longer their manager, so this review cannot be submitted. Their new manager writes theirs.',
      ),
    );
  const waiting = unconfirmed(r);
  if (waiting.length > 0)
    return err(
      failure(
        'UNCONFIRMED',
        `Confirm or change ${String(waiting.length)} suggested answers first`,
        waiting,
      ),
    );
  return ok({
    ...r,
    status: 'locked',
    unlock: r.unlock === null ? null : { ...r.unlock },
    submitted: [...r.submitted, { revision: r.revision, answers: r.answers, at, scoreHundredths }],
  });
}

/** §10.4: a reason of at least 10 characters, from a locked review, for HR. */
export function requestUnlock(r: Review, reason: string, at: string): Result<Review> {
  if (r.status === 'in_review')
    return err(failure('IN_CALIBRATION', 'Wait until calibration is finalised to ask'));
  if (r.status !== 'locked')
    return err(failure('NOT_LOCKED', 'Only a submitted review can be unlocked'));
  if (reason.trim().length < 10)
    return err(failure('REASON', 'Say why, in at least 10 characters'));
  return ok({
    ...r,
    status: 'unlock_requested',
    unlock: { reason: reason.trim(), at, decided: null },
  });
}

export function withdrawUnlock(r: Review): Result<Review> {
  if (r.status !== 'unlock_requested') return err(failure('NO_REQUEST', 'No request is waiting'));
  return ok({ ...r, status: 'locked', unlock: null });
}

/** Only HR decides (§10.4); the caller has checked who is asking. */
export function decideUnlock(
  r: Review,
  decision: {
    readonly approved: boolean;
    readonly by: string;
    readonly at: string;
    readonly note: string;
  },
): Result<Review> {
  if (r.status !== 'unlock_requested' && !(r.status === 'locked' && decision.approved))
    return err(failure('NO_REQUEST', 'No unlock request is waiting on this review'));
  const unlock = r.unlock ?? { reason: decision.note, at: decision.at, decided: null };
  return ok({
    ...r,
    status: decision.approved ? 'unlocked' : 'locked',
    unlock: { ...unlock, decided: decision },
  });
}

/**
 * Closing a cycle (§10.1, §10.5): what each review becomes. An unlocked
 * review completes on its last submitted revision; edits since are kept as a
 * draft HR can see and never shared.
 */
export function closeStatus(r: Review): ReviewStatus {
  switch (r.status) {
    case 'not_started':
      return r.submitted.length > 0 ? 'completed' : 'abandoned';
    case 'in_progress':
      return 'withdrawn';
    case 'locked':
    case 'unlock_requested':
    case 'in_review':
      return 'completed';
    case 'unlocked':
      return r.submitted.length > 0 ? 'completed' : 'withdrawn';
    default:
      return r.status;
  }
}

/** Calibration takes a scored, submitted review (§10.1); finalising gives it back. */
export function hold(r: Review): Result<Review> {
  if (r.status !== 'locked')
    return err(failure('NOT_LOCKED', 'Only a submitted review can be calibrated'));
  return ok({ ...r, status: 'in_review' });
}

export const releaseHold = (r: Review): Review =>
  r.status === 'in_review' ? { ...r, status: 'locked' } : r;

/** A subject leaves the cycle (§8.8): unsubmitted reviews are cancelled, submitted ones detached. */
export function detach(r: Review, at: string): Review {
  if (isSubmitted(r) && r.status !== 'completed') return { ...r, detached: { at, keep: null } };
  if (writable(r)) return { ...r, status: 'cancelled' };
  return r;
}

/** Back in the cycle: a kept detached review reattaches. */
export function reattach(r: Review): Review {
  if (r.detached !== null && r.detached.keep !== false) return { ...r, detached: null };
  if (r.status === 'cancelled')
    return { ...r, status: Object.keys(r.answers).length === 0 ? 'not_started' : 'in_progress' };
  return r;
}

/** The score that stands: calibration's, else the last submission's. */
export const scoreOf = (r: Review): number | null =>
  r.calibrated?.hundredths ?? r.submitted.at(-1)?.scoreHundredths ?? null;

/* -------------------------------------------------------------- reading -- */

export interface Reader {
  readonly personId: string | null;
  readonly hr: boolean;
  /** People this reader manages, directly. */
  readonly reports: ReadonlySet<string>;
  /** Subjects in an open calibration session this reader calibrates. */
  readonly calibrating: ReadonlySet<string>;
}

export type Access = 'full' | 'subject' | null;

/**
 * Who reads a review, and how (§24): the author and HR fully; the subject's
 * manager fully, with names; a calibrator a scored review in their session;
 * the subject only once released, shared, and — for a confidential kind —
 * when enough of that kind are in (`enough`), through the subject's view.
 */
export function access(r: Review, reader: Reader, enough: boolean): Access {
  if (reader.personId === null && !reader.hr) return null;
  if (r.detached?.keep === false) return null;
  if (r.authorId === reader.personId && r.kind !== 'self') return 'full';
  if (reader.hr) return 'full';
  if (r.kind === 'self' && r.authorId === reader.personId) return 'full';
  if (reader.reports.has(r.subjectId)) return 'full';
  if (reader.calibrating.has(r.subjectId) && isSubmitted(r)) return 'full';
  if (r.subjectId === reader.personId) {
    if (r.released === null || !r.shared) return null;
    if ((r.kind === 'peer' || r.kind === 'upward') && !enough) return null;
    return 'subject';
  }
  return null;
}

/* ---------------------------------------------------------- nominations -- */

export interface Nominee {
  readonly personId: string;
  readonly state: 'proposed' | 'approved' | 'declined';
  readonly reason: string | null;
}

export interface Nomination {
  readonly id: string;
  readonly cycleId: string;
  readonly subjectId: string;
  readonly kind: 'peer' | 'upward';
  readonly by: string;
  readonly approverId: string | null;
  readonly nominees: readonly Nominee[];
  readonly state: 'draft' | 'waiting' | 'approved';
  readonly note: string | null;
  readonly at: string;
}

/** §9.3: anyone but the subject, between the minimum and maximum. */
export function nominate(
  n: Nomination,
  picked: readonly string[],
  bounds: { readonly min: number; readonly max: number; readonly approval: boolean },
  note: string | null,
  at: string,
): Result<Nomination> {
  const unique = [...new Set(picked)];
  if (unique.includes(n.subjectId)) return err(failure('SELF', 'You can’t pick yourself'));
  if (unique.length < bounds.min || unique.length > bounds.max)
    return err(failure('COUNT', `Pick ${String(bounds.min)} to ${String(bounds.max)} people`));
  const state = bounds.approval ? 'waiting' : 'approved';
  return ok({
    ...n,
    nominees: unique.map((personId) => ({
      personId,
      state: bounds.approval ? 'proposed' : 'approved',
      reason: null,
    })),
    state,
    note,
    at,
  });
}

/** The approver keeps some, declines some with a reason, and may name a replacement. */
export function decide(
  n: Nomination,
  decisions: readonly {
    readonly personId: string;
    readonly approve: boolean;
    readonly reason: string | null;
  }[],
  replacements: readonly string[],
): Result<Nomination> {
  if (n.state !== 'waiting')
    return err(failure('NOT_WAITING', 'These nominations are not waiting for approval'));
  const by = new Map(decisions.map((d) => [d.personId, d]));
  for (const d of decisions)
    if (!d.approve && (d.reason ?? '').trim() === '')
      return err(failure('REASON', 'Say why you decline someone'));
  const kept: Nominee[] = n.nominees.map((x) => {
    const d = by.get(x.personId);
    return d === undefined
      ? { ...x, state: 'approved' }
      : { ...x, state: d.approve ? 'approved' : 'declined', reason: d.reason };
  });
  const added = replacements
    .filter((p) => p !== n.subjectId && !kept.some((k) => k.personId === p))
    .map((personId): Nominee => ({ personId, state: 'approved', reason: null }));
  return ok({ ...n, nominees: [...kept, ...added], state: 'approved' });
}

/* --------------------------------------------------------- calibration -- */

export interface CalibrationChange {
  readonly personId: string;
  readonly reviewId: string;
  readonly was: number | null;
  readonly now: number;
  readonly reason: string;
  readonly by: string;
  readonly at: string;
}

export interface CalibrationSession {
  readonly id: string;
  readonly name: string;
  readonly cycleId: string;
  readonly calibrators: readonly string[];
  readonly subjects: readonly string[];
  readonly meetsOn: CalendarDate | null;
  readonly state: 'not_started' | 'open' | 'finalised';
  readonly changes: readonly CalibrationChange[];
  /** A question in the manager review read as potential, for the grid's other axis. */
  readonly potentialQuestionId: string | null;
  readonly at: string;
}

export function changeScore(
  s: CalibrationSession,
  change: CalibrationChange,
): Result<CalibrationSession> {
  if (s.state === 'finalised') return err(failure('FINALISED', 'This session is finalised'));
  if (change.reason.trim().length < 5) return err(failure('REASON', 'A change needs a reason'));
  if (!s.subjects.includes(change.personId))
    return err(failure('NOT_IN_SESSION', 'That person is not in this session'));
  return ok({
    ...s,
    state: 'open',
    changes: [...s.changes.filter((c) => c.personId !== change.personId), change],
  });
}

/** Where a score falls on a 3-band axis: low, medium or high (§18.3). */
export function band(value: number, lo: number, hi: number): 0 | 1 | 2 {
  const third = (hi - lo) / 3;
  if (value < lo + third) return 0;
  if (value < lo + 2 * third) return 1;
  return 2;
}
