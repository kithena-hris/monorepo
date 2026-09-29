import type { ActorKind, Area } from './entry.js';

/**
 * The rules of reading the log: who may, what a filter means, and how long an
 * entry is kept.
 */

/** Entries a page holds. */
export const PAGE = 50;

/** The tenant relations that read the log, in People's OpenFGA store. */
export const READING_ROLES = ['people_admin', 'hr'] as const;

/**
 * People administrators and HR, as the People settings log allowed, and
 * Kithena support, a full administrator at the company it signed in to.
 * Finance reads what it asked for through its own requests, not everybody's.
 */
export function mayRead(viewer: {
  readonly roles: ReadonlySet<string>;
  readonly support: boolean;
}): boolean {
  return viewer.support || READING_ROLES.some((r) => viewer.roles.has(r));
}

/**
 * How long a support session can last, which bounds the sign-in an action by
 * support came from. Identity's rule, repeated as its CHECK constraint on
 * `platform.support_access`; a longer session would be refused there first.
 */
export const SUPPORT_SESSION_HOURS = 1;

export interface Filter {
  /** Any of these; empty for all. */
  readonly areas: readonly Area[];
  readonly actorKind: ActorKind | null;
  /** One account's acts. */
  readonly actor: string | null;
  /** Whose record, or what it was done to: a subject's id. */
  readonly subject: string | null;
  /** Inclusive, an instant. */
  readonly from: string | null;
  /** Exclusive, an instant. */
  readonly until: string | null;
  /** Over the action, the detail and the subject's label. */
  readonly search: string | null;
}

/** Milliseconds `zone` is ahead of UTC at `at`. */
function offset(at: number, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const asUtc = Date.UTC(
    parts['year'] ?? 0,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
    parts['hour'] ?? 0,
    parts['minute'] ?? 0,
    parts['second'] ?? 0,
  );
  return asUtc - (at - (at % 1000));
}

/** The instant a calendar day starts on the reader's clock. */
function startOf(day: string, zone: string): number {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Twice, so a day that starts either side of a clock change lands right.
  const first = guess - offset(guess, zone);
  return guess - offset(first, zone);
}

/**
 * A range of calendar days as instants: from the start of the first day to the
 * start of the day after the last, on the reader's clock (UTC when unknown).
 */
export function dayBounds(
  from: string | null,
  to: string | null,
  zone: string | null,
): { readonly from: string | null; readonly until: string | null } {
  const tz = zone ?? 'UTC';
  const next = (day: string): string => {
    const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  };
  return {
    from: from === null ? null : new Date(startOf(from, tz)).toISOString(),
    until: to === null ? null : new Date(startOf(next(to), tz)).toISOString(),
  };
}

/**
 * The one retention rule: entries older than `days` go; `null` keeps
 * everything. No period is decided yet (PEO-129), so it is null today, and
 * `AUDIT_RETENTION_DAYS` is where one will be set.
 */
export function retentionCutoff(days: number | null, now: Date): string | null {
  if (days === null) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
