import type { CalendarDate, FormDefinition } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Learning (PRD §15, PRF-105, PRF-106): items and paths, assignments with a
 * due date, acknowledgement, recurrence and expiry, sessions with attendance
 * by QR, by hand or from the meeting, and quizzes on the form kit.
 */

export type ItemKind = 'course' | 'path' | 'session' | 'document' | 'link' | 'quiz' | 'recording';

export interface Part {
  readonly id: string;
  readonly title: string;
  readonly minutes: number;
}

export interface Session {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly place: string | null;
  readonly online: string | null;
  /** The code shown at the door; a learner's scan of it is attendance. */
  readonly qr: string;
}

export interface LearningItem {
  readonly id: string;
  readonly title: string;
  readonly kind: ItemKind;
  readonly provider: string;
  readonly minutes: number;
  readonly parts: readonly Part[];
  /** "I've read and understood…": a sentence the learner confirms, when the item asks. */
  readonly acknowledgement: string | null;
  readonly quiz: { readonly definition: FormDefinition; readonly passMark: number } | null;
  readonly recursMonths: number | null;
  readonly certificateYears: number | null;
  readonly sessions: readonly Session[];
  readonly skills: readonly string[];
  readonly url: string | null;
  readonly createdAt: string;
}

export interface Attendance {
  readonly sessionId: string;
  readonly invitation: 'invited' | 'accepted' | 'tentative' | 'declined';
  readonly attended: {
    readonly how: 'qr' | 'hand' | 'meet' | 'teams';
    readonly at: string;
    readonly minutes: number | null;
  } | null;
}

export interface Assignment {
  readonly id: string;
  readonly itemId: string;
  readonly personId: string;
  readonly by: string;
  /** "Required", "From your manager", "Everyone in H2 2026". */
  readonly why: string;
  readonly due: CalendarDate | null;
  readonly cycleId: string | null;
  readonly done: readonly string[];
  readonly acknowledgedAt: string | null;
  readonly quiz: {
    readonly correct: number;
    readonly of: number;
    readonly passed: boolean;
    readonly at: string;
  } | null;
  readonly attendance: readonly Attendance[];
  readonly completedAt: string | null;
  readonly expiresOn: CalendarDate | null;
  readonly at: string;
}

export type AssignmentState = 'not_started' | 'in_progress' | 'done' | 'going';

export function stateOf(a: Assignment, item: LearningItem): AssignmentState {
  if (a.completedAt !== null) return 'done';
  if (item.kind === 'session' && a.attendance.some((x) => x.invitation === 'accepted'))
    return 'going';
  if (a.done.length > 0 || a.acknowledgedAt !== null || a.quiz !== null) return 'in_progress';
  return 'not_started';
}

/** Complete when every part is done, the acknowledgement given and the quiz passed (§15.2). */
export function complete(a: Assignment, item: LearningItem, at: string): Assignment {
  if (a.completedAt !== null) return a;
  const parts = item.parts.every((p) => a.done.includes(p.id));
  const ack = item.acknowledgement === null || a.acknowledgedAt !== null;
  const quiz = item.quiz === null || a.quiz?.passed === true;
  const session = item.kind !== 'session' || a.attendance.some((x) => x.attended !== null);
  if (!(parts && ack && quiz && session)) return a;
  const expires =
    item.certificateYears === null
      ? null
      : (`${String(Number(at.slice(0, 4)) + item.certificateYears)}${at.slice(4, 10)}` as CalendarDate);
  return { ...a, completedAt: at, expiresOn: expires };
}

export function markPart(
  a: Assignment,
  item: LearningItem,
  partId: string,
  at: string,
): Result<Assignment> {
  if (!item.parts.some((p) => p.id === partId)) return err(failure('UNKNOWN_PART', 'No such part'));
  return ok(complete({ ...a, done: [...new Set([...a.done, partId])] }, item, at));
}

/** Attendance from a scan of the door's code (§15.5). */
export function scan(
  a: Assignment,
  item: LearningItem,
  code: string,
  at: string,
): Result<Assignment> {
  const session = item.sessions.find((s) => s.qr === code);
  if (session === undefined)
    return err(failure('BAD_CODE', 'That code is not for a session of this item'));
  const rest = a.attendance.filter((x) => x.sessionId !== session.id);
  return ok(
    complete(
      {
        ...a,
        attendance: [
          ...rest,
          {
            sessionId: session.id,
            invitation: 'accepted',
            attended: { how: 'qr', at, minutes: null },
          },
        ],
      },
      item,
      at,
    ),
  );
}
