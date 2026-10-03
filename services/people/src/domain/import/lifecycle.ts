import type { LeavingReason } from '../person/person.js';

/**
 * An HR export's employment lifecycle columns, read onto People's own
 * lifecycle rather than kept as fields beside it (docs/ai-settings.md).
 *
 * "Employment Status" says where somebody is; "Termination Date", "Leave
 * Start Date" and the start date say when. The import runs the moves People
 * already has — offboarding from a last working day, notice until one ahead,
 * leave from a day — so the status is the lifecycle's and never a column
 * written to. Where the word and the dates disagree, **the dates decide**,
 * and the plan says so in one line per kind of disagreement. Pure.
 */

/** A status as the file says it, in People's words. */
export type FileStatus = 'active' | 'pre_hire' | 'on_leave' | 'notice' | 'terminated';

const normal = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[\s_\-–—/]+/gu, ' ')
    .trim();

const STATUS_NAMES: Readonly<Record<FileStatus, readonly string[]>> = {
  active: ['active', 'employed', 'current', 'working'],
  pre_hire: ['pre hire', 'prehire', 'pending start', 'not started', 'onboarding'],
  on_leave: ['on leave', 'leave', 'leave of absence', 'loa', 'on loa', 'absent'],
  notice: ['notice period', 'on notice', 'notice', 'serving notice', 'leaving'],
  terminated: [
    'terminated',
    'inactive',
    'former',
    'former employee',
    'ex employee',
    'left',
    'leaver',
    'separated',
    'departed',
    'offboarded',
  ],
};
const STATUS_BY_NAME = new Map(
  Object.entries(STATUS_NAMES).flatMap(([status, names]) =>
    names.map((n) => [n, status as FileStatus] as const),
  ),
);

/** The status a cell says, or null for an empty or unknown one. */
export const statusOf = (cell: string): FileStatus | null => STATUS_BY_NAME.get(normal(cell)) ?? null;

const ENDED_CONTRACT = /contract|fixed term|temporary assignment/u;
const BY_EMPLOYER =
  /involuntary|dismiss|terminat|fired|redundan|lay ?off|laid off|restructur|for cause|misconduct|performance|eliminated|reduction in force/u;

/**
 * A termination reason onto People's three (a closed set, because a report
 * counts them): the employer ended it, a contract ran out, or else the person
 * did — retirement among them. The file's own words are kept beside it.
 */
export function leavingReasonOf(cell: string): LeavingReason {
  const said = normal(cell);
  if (ENDED_CONTRACT.test(said) && /end|expir|complet|ran out/u.test(said)) return 'end_of_contract';
  if (BY_EMPLOYER.test(said)) return 'dismissed';
  return 'resigned';
}

/** "Eligible for Rehire": yes, no, or not said. */
export function rehireOf(cell: string): boolean | null {
  const said = normal(cell);
  if (['yes', 'y', 'true', '1', 'eligible'].includes(said)) return true;
  if (['no', 'n', 'false', '0', 'not eligible', 'ineligible'].includes(said)) return false;
  return null;
}

const LEAVE_START = new Set([
  'leave start date',
  'leave start',
  'leave from',
  'start of leave',
  'leave begin date',
  'leave began',
]);

/**
 * The column a leave's first day is in. It stays a field of its own too —
 * People keeps no leave record — and dates the move onto leave.
 */
export const isLeaveStart = (header: string): boolean => LEAVE_START.has(normal(header));

export type LifecycleMove =
  | {
      readonly kind: 'left';
      readonly lastWorkingDay: string;
      readonly reason: LeavingReason;
      /** The file's own words, kept as HR's note on the termination. */
      readonly note: string | null;
      readonly eligibleForRehire: boolean | null;
    }
  | { readonly kind: 'notice'; readonly lastWorkingDay: string; readonly reason: LeavingReason }
  | { readonly kind: 'leave'; readonly from: string };

/** Where the status word and the dates disagree, and the dates won. */
export type LifecycleConflict =
  | 'starts_later'
  | 'started'
  | 'left_by_date'
  | 'notice_by_date'
  | 'no_last_day'
  | 'last_day_before_hire'
  | 'leave_later'
  | 'no_start';

export interface LifecycleRead {
  /** What to run once the person is hired; null leaves the hire's own status. */
  readonly move: LifecycleMove | null;
  readonly conflict: LifecycleConflict | null;
}

/**
 * One row's lifecycle. The start date makes somebody pre-hire or active, as
 * it always has; a termination date on or before today has them leave on it,
 * one ahead puts them on notice until it; "On leave" puts them on leave from
 * its start. All days are the person's own.
 */
export function lifecycleOf(input: {
  readonly status: FileStatus | null;
  readonly hireDate: string | null;
  readonly lastWorkingDay: string | null;
  readonly reason: string;
  readonly rehire: string;
  readonly leaveStart: string | null;
  readonly today: string;
}): LifecycleRead {
  const { status, hireDate, lastWorkingDay, today } = input;
  const moving =
    lastWorkingDay !== null ||
    status === 'terminated' ||
    status === 'notice' ||
    status === 'on_leave';
  const none = (conflict: LifecycleConflict | null): LifecycleRead => ({ move: null, conflict });

  if (hireDate === null) return none(moving ? 'no_start' : null);
  if (hireDate > today) return none(moving || (status !== null && status !== 'pre_hire') ? 'starts_later' : null);

  if (lastWorkingDay !== null) {
    if (lastWorkingDay < hireDate) return none('last_day_before_hire');
    const reason = leavingReasonOf(input.reason);
    if (lastWorkingDay <= today) {
      const note = input.reason.trim();
      return {
        move: {
          kind: 'left',
          lastWorkingDay,
          reason,
          note: note === '' ? null : note,
          eligibleForRehire: rehireOf(input.rehire),
        },
        conflict: status === null || status === 'terminated' ? null : 'left_by_date',
      };
    }
    return {
      move: { kind: 'notice', lastWorkingDay, reason },
      conflict: status === 'terminated' ? 'notice_by_date' : null,
    };
  }

  if (status === 'terminated' || status === 'notice') return none('no_last_day');
  if (status === 'on_leave') {
    const asked = input.leaveStart ?? today;
    const from = asked < hireDate ? hireDate : asked;
    return from > today ? none('leave_later') : { move: { kind: 'leave', from }, conflict: null };
  }
  return none(status === 'pre_hire' ? 'started' : null);
}

const people = (n: number): string => `${String(n)} ${n === 1 ? 'person' : 'people'}`;

/** One line of the plan for one kind of disagreement. */
export function lifecycleNote(conflict: LifecycleConflict, n: number): string {
  const one = n === 1;
  switch (conflict) {
    case 'starts_later':
      return `${people(n)} with a start date ahead ${one ? 'is' : 'are'} pre-hire until then, whatever the status says.`;
    case 'started':
      return `${people(n)} marked pre-hire ${one ? 'has' : 'have'} started: active from their start date.`;
    case 'left_by_date':
      return `${people(n)} with a termination date behind them ${one ? 'is' : 'are'} offboarded from it, whatever the status says.`;
    case 'notice_by_date':
      return `${people(n)} marked terminated ${one ? 'leaves' : 'leave'} on a day ahead, so ${one ? 'is' : 'are'} serving notice until then.`;
    case 'no_last_day':
      return `${people(n)} marked as leaving ${one ? 'has' : 'have'} no termination date: active, for HR to offboard from their record.`;
    case 'last_day_before_hire':
      return `${people(n)} ${one ? 'has' : 'have'} a termination date before their start date: active, for HR to check.`;
    case 'leave_later':
      return `${one ? '1 person’s leave starts' : `${String(n)} people’s leave starts`} later: active until then.`;
    case 'no_start':
      return `${people(n)} ${one ? 'has' : 'have'} no start date, so their status waits until HR hires them.`;
  }
}
