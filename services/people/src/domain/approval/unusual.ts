import { Decimal } from '../pay/pay.js';

/**
 * Unusual changes waiting for approval, flagged for whoever decides them
 * (design AI7, AI8: "What Kithena checks").
 *
 * Deterministic rules decide every flag; nothing here asks a model. A flag
 * never blocks and never contacts anyone: it tells the decider, in words and
 * with the numbers it compared against, what to look at twice, and says
 * honestly that it might be fine. Approving something flagged asks for a note
 * (`pending-change.ts`); that is all a flag changes.
 *
 * Six checks, each switchable by a People administrator (`CHECKS`):
 *
 * - **raise**: pay moves more than `PAY_CHANGE_PERCENT` (20 %) and more than
 *   any raise in the person's team this calendar year. A typical merit rise
 *   is 2–10 %, a promotion 10–20 %. A cut over the threshold is flagged too.
 * - **band**: the new pay is outside the band of the person's grade, in the
 *   same currency.
 * - **bank_after_contact**: bank details asked for within `CONTACT_DAYS` (14)
 *   after the person's address or email changed — the payroll-diversion
 *   pattern.
 * - **close_colleagues**: the decider and the requester share a manager, and
 *   the decision comes within `COLLEAGUES_MINUTES` (60) of the request.
 * - **payroll_closing**: pay or bank details landing in this month's payroll
 *   with less than `NOTICE_DAYS` (5) days before it closes (a monthly payroll,
 *   closing on the month's last day), or reaching back into a month already
 *   paid. Dating a change to the start of this month, with time left, is
 *   ordinary.
 * - **unusual_time** (off by default): asked for outside `WORKING_HOURS`
 *   (07:00 to 20:00, Monday to Friday) in the requester's zone, by somebody
 *   other than the employee.
 *
 * **Feedback tunes them.** "Not unusual" records a mark per reason (`Mark`).
 * For `MARK_DAYS` (90) after, the same check stays quiet for the same
 * requester — for a raise, only up to the size that was marked. Marks are a
 * company's own: the caller passes only its tenant's.
 *
 * Pure: what the change is and what surrounds it. The caller decides who may
 * see the flags — those who decide the change, never the requester — and
 * passes pay, the team's raises and the band only where the decider may read
 * pay, so a flag says nothing about a value they could not read themselves.
 * Pay opened from a sealed field (`sealed`) is put into percentages and the
 * band's limits only, never an amount.
 */

export const PAY_CHANGE_PERCENT = 20;
export const CONTACT_DAYS = 14;
export const COLLEAGUES_MINUTES = 60;
export const NOTICE_DAYS = 5;
export const WORKING_HOURS = { from: 7, until: 20 } as const;
export const MARK_DAYS = 90;

/** What the settings list, in their words: AI8's "What Kithena checks". */
export const CHECKS = [
  {
    code: 'raise',
    title: 'Raise much bigger than usual',
    detail: 'Compared with the team’s raises this year',
    on: true,
  },
  { code: 'band', title: 'Outside the pay band', detail: 'Compared with the level’s band', on: true },
  {
    code: 'bank_after_contact',
    title: 'Bank change right after an address or email change',
    detail: 'A common pattern in payroll fraud',
    on: true,
  },
  {
    code: 'close_colleagues',
    title: 'Requested and approved by close colleagues',
    detail: 'Same manager, within an hour',
    on: true,
  },
  {
    code: 'payroll_closing',
    title: 'Lands in a payroll that’s already closing',
    detail: 'Less than 5 days’ notice',
    on: true,
  },
  {
    code: 'unusual_time',
    title: 'Requested at an unusual time',
    detail: 'Outside the requester’s working hours',
    on: false,
  },
] as const;

export type CheckCode = (typeof CHECKS)[number]['code'];

export const isCheckCode = (code: string): code is CheckCode => CHECKS.some((c) => c.code === code);

/** Every check on by default: what a company that never changed a switch runs. */
export const DEFAULT_CHECKS: ReadonlySet<CheckCode> = new Set(
  CHECKS.filter((c) => c.on).map((c) => c.code),
);

/** One reason a change is flagged: a short title and the comparison behind it. */
export interface Reason {
  readonly code: CheckCode;
  readonly title: string;
  readonly detail: string;
  /** How big, where a size makes sense (a raise's percentage): what a mark remembers. */
  readonly magnitude: string | null;
}

/** One bar of "the numbers it compared against", as a whole percentage. */
export interface Comparison {
  readonly label: string;
  readonly percent: string;
  readonly highlight: boolean;
}

export interface Flagging {
  readonly reasons: readonly Reason[];
  readonly comparisons: readonly Comparison[];
  /** "This might be fine: …", or null with nothing flagged. */
  readonly note: string | null;
}

export interface Money {
  readonly amountMinor: string;
  readonly currency: string;
}

export interface ChangeSeen {
  readonly id: string;
  readonly dataType: string;
  /** An instant. */
  readonly requestedAt: string;
  readonly requestedBy: string;
  /** The account the changed record signs in as; null for nobody yet. */
  readonly subjectAccountId: string | null;
  /** A calendar date. */
  readonly effectiveFrom: string;
  /** Both amounts, when the decider may read them in clear; null otherwise. */
  readonly pay: {
    readonly before: Money;
    readonly after: Money;
    /**
     * Opened from a sealed field for this computation only: the reasons give
     * percentages and the band's limits, never the amount itself.
     */
    readonly sealed?: boolean;
  } | null;
}

/** "Not unusual", said about one reason on one change. */
export interface Mark {
  readonly code: CheckCode;
  readonly requestedBy: string;
  readonly magnitude: string | null;
  /** An instant. */
  readonly at: string;
}

export interface Around {
  /** The requester's zone: their working day. */
  readonly zone: string;
  /** When the decider looks: now. */
  readonly at: string;
  /** The person's team and its other raises this year, as whole percentages; null when unknown. */
  readonly team: { readonly name: string; readonly raises: readonly string[] } | null;
  /** The band of the person's grade in force, in minor units; null when none. */
  readonly band: {
    readonly grade: string;
    readonly currency: string;
    readonly minimumMinor: string;
    readonly maximumMinor: string;
    /** The decider may read pay bands (HR or finance): the limits are named. Default true. */
    readonly limitsShown?: boolean;
  } | null;
  /** When the person's address or email last changed, recorded or waiting. */
  readonly contact: readonly { readonly kind: 'address' | 'email'; readonly at: string }[];
  /** The decider shares a manager with the requester, named as the decider may name them. */
  readonly colleagues: { readonly name: string } | null;
  readonly enabled: ReadonlySet<CheckCode>;
  /** The company's marks; older than `MARK_DAYS` are ignored here. */
  readonly marks: readonly Mark[];
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

const days = (n: number): string => `${String(n)} ${n === 1 ? 'day' : 'days'}`;

/** "€84k": short money for a sentence, from minor units. */
export function compactMoney(m: Money): string {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency: m.currency })
    .resolvedOptions().maximumFractionDigits ?? 2;
  const major = new Decimal(m.amountMinor).div(new Decimal(10).pow(digits)).toNumber();
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: m.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  })
    .format(major)
    .replace(/K$/u, 'k');
}

/** The change in pay, as a signed whole percentage; null across currencies or from nothing. */
export function payChangePercent(pay: NonNullable<ChangeSeen['pay']>): Decimal | null {
  if (pay.before.currency !== pay.after.currency) return null;
  const before = new Decimal(pay.before.amountMinor);
  if (before.lte(0)) return null;
  return new Decimal(pay.after.amountMinor)
    .minus(before)
    .div(before)
    .times(100)
    .toDecimalPlaces(0);
}

function median(values: readonly Decimal[]): Decimal {
  const sorted = values.toSorted((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? new Decimal(0))
    : (sorted[mid - 1] ?? new Decimal(0)).plus(sorted[mid] ?? 0).div(2).toDecimalPlaces(0);
}

function raise(
  change: ChangeSeen,
  team: Around['team'],
): { reason: Reason; comparisons: Comparison[] } | null {
  if (change.pay === null) return null;
  const pct = payChangePercent(change.pay);
  if (pct === null || pct.abs().lte(PAY_CHANGE_PERCENT)) return null;
  const size = pct.abs().toString();
  if (pct.isNegative()) {
    return {
      reason: {
        code: 'raise',
        title: `A ${size}% pay cut`,
        detail: `Most pay changes are under ${String(PAY_CHANGE_PERCENT)}%.`,
        magnitude: size,
      },
      comparisons: [],
    };
  }
  const raises = (team?.raises ?? []).map((r) => new Decimal(r));
  const largest = raises.reduce<Decimal | null>((m, r) => (m === null || r.gt(m) ? r : m), null);
  if (largest !== null && pct.lte(largest)) return null;
  const reason = (detail: string): Reason => ({
    code: 'raise',
    title: `A ${size}% raise`,
    detail,
    magnitude: size,
  });
  if (team === null) {
    return { reason: reason(`Most raises are under ${String(PAY_CHANGE_PERCENT)}%.`), comparisons: [] };
  }
  if (largest === null) {
    return {
      reason: reason(
        `Nobody else in ${team.name} has had a raise this year, and most raises are under ${String(PAY_CHANGE_PERCENT)}%.`,
      ),
      comparisons: [],
    };
  }
  const mid = median(raises).toString();
  return {
    reason: reason(
      `${team.name} raises this year had a median of ${mid}%, and the largest was ${largest.toString()}%.`,
    ),
    comparisons: [
      { label: 'This change', percent: size, highlight: true },
      { label: 'Median', percent: mid, highlight: false },
      { label: 'Largest', percent: largest.toString(), highlight: false },
    ],
  };
}

function band(change: ChangeSeen, b: Around['band']): Reason | null {
  if (change.pay === null || b === null || change.pay.after.currency !== b.currency) return null;
  const after = new Decimal(change.pay.after.amountMinor);
  const range =
    b.limitsShown === false
      ? ''
      : ` (${compactMoney({ amountMinor: b.minimumMinor, currency: b.currency })}–${compactMoney({ amountMinor: b.maximumMinor, currency: b.currency })})`;
  // A sealed amount is never put into words: "It is", not "€84k is".
  const amount = change.pay.sealed === true ? 'It' : compactMoney(change.pay.after);
  if (after.gt(b.maximumMinor)) {
    return {
      code: 'band',
      title: 'Above the band',
      detail: `${amount} is over the top of the ${b.grade} band${range}.`,
      magnitude: null,
    };
  }
  if (after.lt(b.minimumMinor)) {
    return {
      code: 'band',
      title: 'Below the band',
      detail: `${amount} is under the bottom of the ${b.grade} band${range}.`,
      magnitude: null,
    };
  }
  return null;
}

function bankAfterContact(change: ChangeSeen, a: Around): Reason | null {
  if (change.dataType !== 'bank_account') return null;
  const at = Date.parse(change.requestedAt);
  const latest = a.contact
    .filter((c) => Date.parse(c.at) <= at && at - Date.parse(c.at) <= CONTACT_DAYS * DAY_MS)
    .toSorted((x, y) => Date.parse(y.at) - Date.parse(x.at))[0];
  if (latest === undefined) return null;
  const n = daysBetween(localDate(latest.at, a.zone), localDate(change.requestedAt, a.zone));
  return {
    code: 'bank_after_contact',
    title: n === 0 ? `The same day as a new ${latest.kind}` : `${days(n)} after a new ${latest.kind}`,
    detail: `The ${latest.kind} changed ${n === 0 ? 'the same day as' : `${days(n)} before`} the bank details. Changing both together is a common pattern in payroll fraud.`,
    magnitude: null,
  };
}

function closeColleagues(change: ChangeSeen, a: Around): Reason | null {
  if (a.colleagues === null) return null;
  const apart = Date.parse(a.at) - Date.parse(change.requestedAt);
  if (apart < 0 || apart > COLLEAGUES_MINUTES * 60_000) return null;
  return {
    code: 'close_colleagues',
    title: `You and ${a.colleagues.name} share a manager`,
    detail:
      'It was asked for less than an hour ago by someone with the same manager as you. Someone further away makes a stronger second check.',
    magnitude: null,
  };
}

const PAYROLL_TYPES: ReadonlySet<string> = new Set(['money', 'bank_account']);

/** The last day of the month a date falls in: when a monthly payroll closes. */
function monthEnd(date: string): string {
  const [y = 0, m = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function payrollClosing(change: ChangeSeen, a: Around): Reason | null {
  if (!PAYROLL_TYPES.has(change.dataType)) return null;
  const asked = localDate(change.requestedAt, a.zone);
  const ahead = daysBetween(asked, change.effectiveFrom);
  if (change.effectiveFrom < `${asked.slice(0, 7)}-01`) {
    return {
      code: 'payroll_closing',
      title: 'Back-dated payroll impact',
      detail: `It took effect ${days(-ahead)} before it was asked for, so payroll corrects what it already paid.`,
      magnitude: null,
    };
  }
  const close = monthEnd(asked);
  if (change.effectiveFrom > close || daysBetween(asked, close) >= NOTICE_DAYS) return null;
  return {
    code: 'payroll_closing',
    title: ahead <= 0 ? 'Back-dated payroll impact' : 'Short notice for payroll',
    detail: `It starts in ${days(Math.max(ahead, 0))}, so it lands in this month’s payroll without the usual ${String(NOTICE_DAYS)}-day notice.`,
    magnitude: null,
  };
}

function unusualTime(change: ChangeSeen, zone: string): Reason | null {
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
    code: 'unusual_time',
    title: 'Asked for at an unusual time',
    detail: `At ${part('hour')}:${part('minute')} on a ${weekday}, ${zone} time, outside the requester’s working hours.`,
    magnitude: null,
  };
}

/** A mark from the same requester on the same check, recent, and no smaller. */
function quietened(reason: Reason, change: ChangeSeen, a: Around): boolean {
  const now = Date.parse(a.at);
  return a.marks.some(
    (m) =>
      m.code === reason.code &&
      m.requestedBy === change.requestedBy &&
      now - Date.parse(m.at) <= MARK_DAYS * DAY_MS &&
      (reason.magnitude === null ||
        m.magnitude === null ||
        new Decimal(reason.magnitude).lte(m.magnitude)),
  );
}

const COUNTED = ['', 'it', 'both', 'all three'] as const;

function mightBeFine(reasons: readonly Reason[]): string | null {
  if (reasons.length === 0) return null;
  const pay = reasons.filter((r) => r.code === 'raise' || r.code === 'band' || r.code === 'payroll_closing');
  const why =
    pay.length > 0 && reasons.some((r) => r.code === 'raise' || r.code === 'band')
      ? `This might be fine: a promotion would explain ${COUNTED[Math.min(pay.length, 3)] ?? 'them'}.`
      : reasons.some((r) => r.code === 'bank_after_contact')
        ? 'This might be fine: people who move often change banks too.'
        : 'This might be fine.';
  return `${why} Check the reason before you decide.`;
}

export function unusual(change: ChangeSeen, a: Around): Flagging {
  const on = (code: CheckCode) => a.enabled.has(code);
  // A sealed field's history keeps no amounts, so there are no team raises to compare.
  const found = on('raise') ? raise(change, change.pay?.sealed === true ? null : a.team) : null;
  const reasons = [
    found?.reason ?? null,
    on('band') ? band(change, a.band) : null,
    on('bank_after_contact') ? bankAfterContact(change, a) : null,
    on('close_colleagues') ? closeColleagues(change, a) : null,
    on('payroll_closing') ? payrollClosing(change, a) : null,
    on('unusual_time') ? unusualTime(change, a.zone) : null,
  ].filter((r): r is Reason => r !== null && !quietened(r, change, a));
  return {
    reasons,
    comparisons: reasons.some((r) => r.code === 'raise') ? (found?.comparisons ?? []) : [],
    note: mightBeFine(reasons),
  };
}

/** The reasons in one line, for a row: "A 38% raise, above the band". */
export function rowSummary(reasons: readonly { readonly title: string }[]): string | null {
  if (reasons.length === 0) return null;
  return reasons
    .map((r, i) => (i === 0 ? r.title : r.title.charAt(0).toLowerCase() + r.title.slice(1)))
    .join(', ');
}
