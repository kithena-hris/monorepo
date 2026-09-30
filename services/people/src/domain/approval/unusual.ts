import { Decimal } from '../pay/pay.js';

/**
 * Unusual changes waiting for approval, flagged for whoever decides them.
 *
 * Deterministic rules decide every flag; nothing here asks a model. A flag
 * never blocks: it tells the decider what to look at twice, in words, and the
 * decision is theirs as before. The rules are the patterns a payroll or HR
 * auditor looks for — a large pay change, a date that rewrites months of
 * payroll, an identifier that fails its checks, bank details changed twice in
 * quick succession or by somebody other than the employee, a batch of
 * sensitive fields changed together, and a change made out of hours by
 * somebody other than the employee.
 *
 * The thresholds are constants here, deliberately conservative, so a flag is
 * worth reading rather than wallpaper:
 *
 * - `PAY_CHANGE_PERCENT` (20): more than a fifth up or down on the pay in
 *   force. A typical merit rise is 2–10 %, a promotion 10–20 %.
 * - `BACKDATED_DAYS` (31): effective more than a month before it was asked
 *   for. Dating a change to the start of the month is ordinary; more means
 *   payroll recomputes past months.
 * - `FAR_FUTURE_DAYS` (183): effective more than six months ahead, which is
 *   usually a mistyped year.
 * - `BANK_REPEAT_DAYS` (30): a second change to bank details within a month
 *   of another, the classic payroll-diversion pattern.
 * - `AT_ONCE_FIELDS` (3) within `AT_ONCE_MINUTES` (10): several sensitive
 *   fields on one person changed together by one requester.
 * - `WORKING_HOURS` (07:00 to 20:00, Monday to Friday) in the person's own
 *   zone: outside them, a change by somebody other than the employee.
 *
 * Pure: what the change is, what else was asked about the same person, and
 * the zone its working day is judged in. The caller decides who may see the
 * flags — those who decide the change, never the requester — and passes pay
 * only where the decider may read both amounts, so a flag says nothing about
 * a field they could not read themselves.
 */

export const PAY_CHANGE_PERCENT = 20;
export const BACKDATED_DAYS = 31;
export const FAR_FUTURE_DAYS = 183;
export const BANK_REPEAT_DAYS = 30;
export const AT_ONCE_FIELDS = 3;
export const AT_ONCE_MINUTES = 10;
export const WORKING_HOURS = { from: 7, until: 20 } as const;

export type FlagCode =
  | 'pay_change_large'
  | 'backdated'
  | 'far_future'
  | 'identifier_checks'
  | 'bank_repeat'
  | 'bank_by_other'
  | 'many_at_once'
  | 'outside_hours';

export interface Flag {
  readonly code: FlagCode;
  /** Plain words for the decider. Never a value they could not read. */
  readonly reason: string;
}

export interface Money {
  readonly amountMinor: string;
  readonly currency: string;
}

export interface ChangeSeen {
  readonly id: string;
  readonly label: string;
  readonly dataType: string;
  /** An instant. */
  readonly requestedAt: string;
  readonly requestedBy: string;
  /** The account the changed record signs in as; null for nobody yet. */
  readonly subjectAccountId: string | null;
  /** A calendar date. */
  readonly effectiveFrom: string;
  /** Both amounts, when the decider may read them in clear; null otherwise. */
  readonly pay: { readonly before: Money; readonly after: Money } | null;
  /** What the identifier checks found. Never the value. */
  readonly findings: readonly { readonly level: string; readonly message: string }[];
}

/** Another change asked for the same person, whatever it became. */
export interface OtherChange {
  readonly id: string;
  readonly dataType: string;
  readonly requestedAt: string;
  readonly requestedBy: string;
  readonly state: 'pending' | 'approved' | 'rejected' | 'expired' | 'withdrawn';
}

const DAY_MS = 86_400_000;

/** The calendar date an instant falls on in a zone. */
function localDate(at: string, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

function payFlag(pay: NonNullable<ChangeSeen['pay']>): Flag | null {
  if (pay.before.currency !== pay.after.currency) return null;
  const before = new Decimal(pay.before.amountMinor);
  if (before.lte(0)) return null;
  const change = new Decimal(pay.after.amountMinor).minus(before).div(before).times(100);
  if (change.abs().lte(PAY_CHANGE_PERCENT)) return null;
  const percent = change.abs().toDecimalPlaces(0).toString();
  return {
    code: 'pay_change_large',
    reason: `Pay goes ${change.isPositive() ? 'up' : 'down'} ${percent}% on what is in force.`,
  };
}

function hoursFlag(change: ChangeSeen, zone: string): Flag | null {
  if (change.subjectAccountId !== null && change.requestedBy === change.subjectAccountId) {
    return null;
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(change.requestedAt));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(part('hour'));
  const weekday = part('weekday');
  const weekend = weekday === 'Saturday' || weekday === 'Sunday';
  if (!weekend && hour >= WORKING_HOURS.from && hour < WORKING_HOURS.until) return null;
  return {
    code: 'outside_hours',
    reason: `Asked for at ${part('hour')}:${part('minute')} on a ${weekday}, ${zone} time, outside working hours, by someone other than the employee.`,
  };
}

export function unusual(
  change: ChangeSeen,
  around: { readonly others: readonly OtherChange[]; readonly zone: string },
): Flag[] {
  const flags: Flag[] = [];
  const add = (flag: Flag | null) => {
    if (flag !== null) flags.push(flag);
  };

  if (change.pay !== null) add(payFlag(change.pay));

  const asked = localDate(change.requestedAt, around.zone);
  const ahead = daysBetween(asked, change.effectiveFrom);
  if (-ahead > BACKDATED_DAYS) {
    add({
      code: 'backdated',
      reason: `Takes effect ${String(-ahead)} days before it was asked for, so payroll corrects the months between.`,
    });
  }
  if (ahead > FAR_FUTURE_DAYS) {
    add({
      code: 'far_future',
      reason: `Takes effect ${String(ahead)} days after it was asked for. Check the year.`,
    });
  }

  const doubted = change.findings.filter((f) => f.level !== 'ok');
  if (doubted.length > 0) {
    add({
      code: 'identifier_checks',
      reason: `${change.label} fails its checks: ${doubted.map((f) => f.message.replace(/\.$/u, '')).join('; ')}.`,
    });
  }

  const others = around.others.filter((o) => o.id !== change.id);
  const at = Date.parse(change.requestedAt);
  const apart = (o: OtherChange) => Math.abs(Date.parse(o.requestedAt) - at);

  if (change.dataType === 'bank_account') {
    const again = others.some(
      (o) =>
        o.dataType === 'bank_account' &&
        o.state !== 'withdrawn' &&
        apart(o) <= BANK_REPEAT_DAYS * DAY_MS,
    );
    if (again) {
      add({
        code: 'bank_repeat',
        reason: `Bank details were changed more than once within ${String(BANK_REPEAT_DAYS)} days.`,
      });
    }
    if (change.subjectAccountId !== null && change.requestedBy !== change.subjectAccountId) {
      add({
        code: 'bank_by_other',
        reason: 'Bank details were changed by someone other than the employee.',
      });
    }
  }

  const together =
    1 +
    others.filter(
      (o) =>
        o.requestedBy === change.requestedBy &&
        o.state !== 'withdrawn' &&
        apart(o) <= AT_ONCE_MINUTES * 60_000,
    ).length;
  if (together >= AT_ONCE_FIELDS) {
    add({
      code: 'many_at_once',
      reason: `${String(together)} sensitive fields were changed together for this person.`,
    });
  }

  add(hoursFlag(change, around.zone));
  return flags;
}
