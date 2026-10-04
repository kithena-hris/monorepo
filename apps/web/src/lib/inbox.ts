import { reviewItem, type ShellData, type ShellNotice } from './shell-data';

/**
 * The Inbox's three views (design MA6): what there is to do, the changes
 * People's checks flagged for the viewer to decide, and updates. Each is its
 * own address (`?view=`), so Back and a shared link land on the same one.
 */

export const INBOX_VIEWS = ['todo', 'flagged', 'updates'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const inboxView = (value: string | undefined): InboxView =>
  INBOX_VIEWS.find((v) => v === value) ?? 'todo';

type Value = unknown;

/** One change waiting for the viewer, flagged, as Approvals answered it. */
export interface FlaggedSource {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly readable: boolean;
  readonly canDecide: boolean;
  readonly flagSummary?: string | null;
  readonly value: Value;
  readonly current: Value;
}

export interface FlaggedRow {
  readonly id: string;
  readonly name: string;
  /** "Base salary €61k → €84k", or the field alone where no amount shows. */
  readonly change: string;
  /** Why, on the row: "A 38% raise, above the band". */
  readonly why: string;
  readonly href: string;
}

const isMoney = (v: Value): v is { readonly amountMinor: string; readonly currency: string } =>
  typeof v === 'object' && v !== null && 'amountMinor' in v && 'currency' in v;

/** "€84k", for a row. Display only: whole units from the digits, never arithmetic on the amount. */
function compact(v: Value): string | null {
  if (!isMoney(v)) return null;
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency: v.currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const whole = Number(v.amountMinor.slice(0, Math.max(0, v.amountMinor.length - digits)) || '0');
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: v.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  })
    .format(whole)
    .replace(/K$/u, 'k');
}

/** The flagged changes the viewer decides, each opening its item in Review. */
export function flaggedRows(items: readonly FlaggedSource[]): FlaggedRow[] {
  return items
    .filter((i) => i.canDecide && (i.flagSummary ?? '') !== '')
    .map((i) => {
      const before = i.readable ? compact(i.current) : null;
      const after = i.readable ? compact(i.value) : null;
      return {
        id: i.id,
        name: i.name,
        change: before !== null && after !== null ? `${i.label} ${before} → ${after}` : i.label,
        why: i.flagSummary ?? '',
        href: reviewItem('flagged', 'changes', `change-${i.id}`),
      };
    });
}

/**
 * One row of the Inbox (design B3, MA B3), on the desk's bell and the
 * phone's tab alike: who or what, how long ago, what kind and what it is,
 * and why it stands out. Each opens where it is done, a Review item for a
 * decision.
 */
export interface InboxRow {
  readonly id: string;
  /** The person, or what it is when nobody is: "Add your bank account". */
  readonly name: string;
  /** Whose face: the name above, or nobody (a glyph instead). */
  readonly person: boolean;
  readonly kind: 'change' | 'id' | 'duplicate' | 'access' | 'missing' | 'import' | 'viewed';
  readonly summary: string;
  /** When, ISO; null for what has always been so. */
  readonly at: string | null;
  readonly href: string;
  /** Why it stands out: a flag's reason. */
  readonly flag?: string;
  /** An import that failed: said as a failure, not as news. */
  readonly failed?: boolean;
}

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** A notice of the shell's as a row: the person first, what it is under. */
function noticeRow(n: ShellNotice): InboxRow {
  const kind = n.kind === 'approval' ? 'change' : n.kind;
  return {
    id: n.id,
    name: n.person ?? n.title,
    person: n.person !== null,
    kind,
    summary: n.person === null ? n.detail : `${n.title} · ${n.detail}`,
    at: n.at,
    href: n.href,
    ...(n.failed === true ? { failed: true } : {}),
  };
}

/**
 * To do: what waits for this person to act on, the same list on the bell and
 * the Inbox tab. Their approvals and asks, their own missing details and
 * imports that finished, then what else waits in Review for HR and finance
 * (ID checks, duplicates, requests for full values), each a row to its chip.
 * Being viewed as is news, under Updates, not something to do.
 */
export function todoRows(shell: ShellData): InboxRow[] {
  const own = shell.notices.filter((n) => n.kind !== 'viewed').map(noticeRow);
  const w = shell.waiting;
  const queue = (
    n: number | null | undefined,
    kind: InboxRow['kind'],
    chip: 'ids' | 'duplicates' | 'access',
    one: string,
    many: string,
    summary: string,
  ): InboxRow[] =>
    n == null || n === 0
      ? []
      : [
          {
            id: `queue:${chip}`,
            name: plural(n, one, many),
            person: false,
            kind,
            summary,
            at: null,
            href: reviewItem('waiting', chip, null),
          },
        ];
  return [
    ...own,
    ...queue(
      w?.identifiers,
      'id',
      'ids',
      'identifier to check',
      'identifiers to check',
      'Failed a check, or couldn’t be verified',
    ),
    ...queue(
      w?.duplicates,
      'duplicate',
      'duplicates',
      'possible duplicate',
      'possible duplicates',
      'Same work email, or name and birth date',
    ),
    ...queue(
      w?.accessRequests,
      'access',
      'access',
      'request for full values',
      'requests for full values',
      'Somebody asked to see unmasked values',
    ),
  ];
}

/** The flagged changes as rows: the change on the row, its reason under it. */
export function flaggedInboxRows(rows: readonly FlaggedRow[]): InboxRow[] {
  return rows.map((f) => ({
    id: `flagged:${f.id}`,
    name: f.name,
    person: true,
    kind: 'change',
    summary: f.change,
    at: null,
    href: f.href,
    flag: f.why,
  }));
}
