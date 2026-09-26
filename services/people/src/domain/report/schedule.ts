import { err, failure, localDate, ok, type Result } from '@kithena/domain-kit';

import { checkSegment } from '../segment/segment.js';

/**
 * A scheduled report (PRD §16.3, PEO-069): who it is about, what it is, when
 * it goes, and to whom.
 *
 * **A schedule holds no result and no person.** The audience is a saved
 * segment or a filter, the recipients are accounts, and each run builds the
 * report again *as each recipient*, at send time — so a recipient gets what
 * they could have exported or charted themselves that morning, and a
 * recipient who has since lost the right gets nothing.
 *
 * **Periods, not timers.** A period is the calendar date an occurrence falls
 * on, in the schedule's zone. The backend sleeps when idle (docs/
 * environments.md), so the question every run asks is not "is it 07:00" but
 * "has a period come that has not run": one hourly sweep on wake answers it.
 * Only the latest period is sent — a report is built from today's data
 * whichever period it is for, so five copies of it are not five reports — and
 * the ones it covers are counted, so the run history says what was missed.
 *
 * Pure.
 */

export type Cadence =
  | { readonly every: 'day'; readonly hour: number }
  /** ISO weekday: 1 is Monday, 7 is Sunday. */
  | { readonly every: 'week'; readonly weekday: number; readonly hour: number }
  /** At most the 28th, so every month has the day. */
  | { readonly every: 'month'; readonly day: number; readonly hour: number };

export type ReportKind =
  /** A file, as the export builder makes one; `fields` null is every readable field. */
  | {
      readonly kind: 'export';
      readonly format: 'xlsx' | 'pdf';
      readonly fields: readonly string[] | null;
      /** Required for a financial field, as for any export; recorded with each file. */
      readonly reason: string | null;
    }
  /** The analytics screen — the headcount, movement and completeness numbers — by link. */
  | { readonly kind: 'summary' };

export type Audience =
  | { readonly segmentId: string }
  /** `{}` is everybody the recipient may list. */
  | { readonly filter: Readonly<Record<string, string>> };

export interface ScheduleInput {
  readonly name: string;
  readonly audience: Audience;
  readonly report: ReportKind;
  readonly cadence: Cadence;
  /** Whose clock the hour is read on; null is the tenant's default zone. */
  readonly legalEntityId: string | null;
  readonly recipients: readonly string[];
}

export interface Schedule extends ScheduleInput {
  readonly id: string;
  readonly ownerAccountId: string;
  readonly paused: boolean;
  /** The last period run, or the one current when it was made or resumed. */
  readonly lastPeriod: string;
}

export const MAX_RECIPIENTS = 25;
const MAX_FIELDS = 500;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;

const refuse = (code: string, message: string, path: string) => err(failure(code, message, [path]));

export function checkSchedule(input: ScheduleInput): Result<ScheduleInput> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) {
    return refuse('SCHEDULE_NAME', 'A schedule needs a name of up to 80 characters', 'name');
  }

  const recipients = [...new Set(input.recipients)];
  if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS) {
    return refuse(
      'SCHEDULE_RECIPIENTS',
      `A schedule goes to 1 to ${String(MAX_RECIPIENTS)} people`,
      'recipients',
    );
  }

  const c = input.cadence;
  const whole = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (
    !whole(c.hour, 0, 23) ||
    (c.every === 'week' && !whole(c.weekday, 1, 7)) ||
    (c.every === 'month' && !whole(c.day, 1, 28))
  ) {
    return refuse(
      'SCHEDULE_CADENCE',
      'An hour is 0–23, a weekday 1–7 and a day of the month 1–28',
      'cadence',
    );
  }

  if ('filter' in input.audience) {
    const keys = Object.keys(input.audience.filter);
    if (input.report.kind === 'summary' && keys.length > 0) {
      return refuse(
        'SCHEDULE_AUDIENCE',
        'A summary is filtered by a saved segment, or not at all',
        'audience',
      );
    }
    // The segment's own rules for a filter, when there is one.
    if (keys.length > 0) {
      const checked = checkSegment({ name, filter: input.audience.filter, shared: false });
      if (!checked.ok) return refuse('SCHEDULE_AUDIENCE', checked.error.message, 'audience');
    }
  }

  let report = input.report;
  if (report.kind === 'export') {
    const fields = report.fields;
    if (
      fields !== null &&
      (fields.length === 0 || fields.length > MAX_FIELDS || !fields.every((k) => KEY.test(k)))
    ) {
      return refuse('SCHEDULE_FIELDS', `Pick 1 to ${String(MAX_FIELDS)} fields, or all`, 'fields');
    }
    const reason = report.reason?.trim() ?? '';
    if (reason.length > 500)
      return refuse('VALUE_INVALID', 'A reason is at most 500 characters', 'reason');
    report = { ...report, reason: reason === '' ? null : reason };
  }

  return ok({ ...input, name, recipients, report });
}

/** Who may make, pause, resume or delete a schedule: it is the tenant's cadence, not a person's. */
export function mayManage(roles: ReadonlySet<string>): boolean {
  return roles.has('hr') || roles.has('people_admin');
}

/* ------------------------------------------------------------ periods -- */

const DAY_MS = 86_400_000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function hourIn(at: string, zone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(at),
    ),
  );
}

/** The most recent period whose hour has come, on `zone`'s clock at `at`. */
export function latestPeriod(cadence: Cadence, zone: string, at: string): string {
  const today = toMs(localDate(at, zone));
  // Before the hour, today's occurrence has not happened: count from yesterday.
  const from = hourIn(at, zone) >= cadence.hour ? today : today - DAY_MS;
  switch (cadence.every) {
    case 'day':
      return toDate(from);
    case 'week': {
      const iso = ((new Date(from).getUTCDay() + 6) % 7) + 1;
      return toDate(from - ((iso - cadence.weekday + 7) % 7) * DAY_MS);
    }
    case 'month': {
      const d = new Date(from);
      const back = d.getUTCDate() >= cadence.day ? 0 : 1;
      return toDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, cadence.day));
    }
  }
}

/** Whole periods strictly between two periods of the same cadence. */
function between(cadence: Cadence, earlier: string, later: string): number {
  if (cadence.every === 'month') {
    const [ly = 0, lm = 0] = later.split('-').map(Number);
    const [ey = 0, em = 0] = earlier.split('-').map(Number);
    return Math.max(0, ly * 12 + lm - (ey * 12 + em) - 1);
  }
  const step = cadence.every === 'week' ? 7 : 1;
  return Math.max(0, Math.round((toMs(later) - toMs(earlier)) / DAY_MS / step) - 1);
}

/**
 * The period to run now, and how many earlier ones it covers; null when
 * paused or when the latest has run.
 */
export function duePeriod(
  schedule: Schedule,
  zone: string,
  at: string,
): { readonly period: string; readonly missed: number } | null {
  if (schedule.paused) return null;
  const period = latestPeriod(schedule.cadence, zone, at);
  if (period <= schedule.lastPeriod) return null;
  return { period, missed: between(schedule.cadence, schedule.lastPeriod, period) };
}
