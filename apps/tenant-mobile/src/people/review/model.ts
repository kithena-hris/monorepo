import type { Entry, Value } from '../api';

/**
 * Review's shapes and rules, as the web's (`people/src/review/review.tsx`,
 * `approvals/approvals.tsx`): one queue, whose turn on top (the tab), what
 * kind as chips, a row for each item, newest first.
 */

export type ReviewTab = 'waiting' | 'flagged' | 'asked' | 'decided';
export type ReviewKind = 'changes' | 'ids' | 'duplicates' | 'access' | 'exports' | 'missing';

export interface Finding {
  readonly level: string;
  readonly code: string;
  readonly message: string;
}

export interface ApprovalItem {
  readonly id: string;
  readonly personId: string;
  readonly name: string;
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly readable: boolean;
  readonly effectiveFrom: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly requestedBy: string;
  readonly reason: string | null;
  readonly mine: boolean;
  readonly canDecide: boolean;
  readonly canSelfApprove: boolean | null;
  readonly awaitingReview: boolean | null;
  readonly findings: readonly Finding[] | null;
  readonly flags: readonly { code: string; title: string; detail: string }[] | null;
  readonly comparisons: readonly { label: string; percent: string; highlight: boolean }[] | null;
  readonly flagNote: string | null;
  readonly flagSummary: string | null;
  readonly canAsk: boolean | null;
  readonly canMark: boolean | null;
  readonly state: 'pending' | 'approved' | 'rejected' | 'lapsed' | 'withdrawn' | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly note: string | null;
  readonly questions:
    | readonly {
        id: string;
        question: string;
        askedBy: string;
        askedAt: string;
        answer: string | null;
        answeredAt: string | null;
        canAnswer: boolean;
      }[]
    | null;
  readonly value: Value;
  readonly current: Value;
  readonly before?: Value;
}

/** An approval as People sends it: values still entries. */
export type ApprovalWire = Omit<ApprovalItem, 'value' | 'current' | 'before'> & {
  readonly value: Entry;
  readonly current: Entry;
  readonly before?: Entry | null;
};

export interface ApprovalsState {
  readonly isHr: boolean;
  readonly canTune: boolean | null;
  readonly items: readonly ApprovalItem[];
  readonly itemsNext: string | null;
  readonly decided: readonly ApprovalItem[];
  readonly decidedNext: string | null;
  readonly checks: readonly { code: string; title: string; detail: string; on: boolean }[] | null;
  readonly last90: { flagged: number; rejected: number; marked: number } | null;
}

export interface IdItem {
  readonly personId: string;
  readonly name: string;
  readonly attributeKey: string;
  readonly label: string;
  readonly last4: string | null;
  readonly findings: readonly Finding[];
  readonly enteredAt: string;
  readonly held: boolean | null;
  readonly enteredBy: string | null;
}

export interface DecidedId {
  readonly personId: string;
  readonly name: string;
  readonly label: string;
  readonly outcome: 'accepted' | 'sent_back';
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly note: string | null;
}

export interface IdState {
  readonly items: readonly IdItem[];
  readonly next: string | null;
  readonly decided: readonly DecidedId[] | null;
}

export interface DuplicatePair {
  readonly personIds: readonly string[];
  readonly names: readonly string[];
  readonly reasons: readonly string[];
  readonly match: 'strong' | 'likely' | 'possible' | null;
  readonly flaggedBy: string | null;
}

export interface MergedPair {
  readonly absorbedId: string;
  readonly survivorId: string;
  readonly absorbedName: string;
  readonly survivorName: string;
  readonly mergedAt: string;
  readonly reversed: readonly string[];
  readonly kept: readonly string[];
  readonly account: string | null;
  readonly refusal: string | null;
}

export interface DuplicatesState {
  readonly items: readonly DuplicatePair[];
  readonly next: string | null;
  readonly merges: readonly MergedPair[] | null;
  readonly mergesNext: string | null;
  readonly comparison: {
    readonly people: readonly {
      id: string;
      name: string;
      status: string;
      refusal: string | null;
    }[];
    readonly rows: readonly {
      key: string;
      label: string;
      values: readonly (string | null)[];
      same: boolean;
      takeable: readonly boolean[];
    }[];
  } | null;
}

export interface AccessRequest {
  readonly id: string;
  readonly state: string;
  readonly mine: boolean;
  readonly requestedBy: string | null;
  readonly reason: string;
  readonly fields: readonly string[];
  readonly people: string | null;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly note: string | null;
  readonly link: string | null;
}

export interface AccessState {
  readonly canRequest: boolean;
  readonly canDecide: boolean;
  readonly fields: readonly { key: string; label: string }[];
  readonly requests: readonly AccessRequest[];
  readonly next: string | null;
}

export interface Share {
  readonly id: string;
  readonly state: 'pending' | 'approved' | 'rejected' | 'expired' | 'withdrawn';
  readonly requestedBy: { readonly name: string | null };
  readonly recipient: { readonly name: string | null };
  readonly reason: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly decidedBy: { readonly name: string | null } | null;
  readonly decidedAt: string | null;
  readonly note: string | null;
  readonly fields: readonly string[];
  readonly gap: {
    readonly fields: readonly { key: string; label: string; people: number }[];
    readonly unlisted: number;
  } | null;
  readonly asOf: string | null;
  readonly format: string;
  readonly audience: string | null;
  readonly people: number | null;
  readonly mine: boolean;
  readonly canDecide: boolean;
}

export interface GapField {
  readonly key: string;
  readonly label: string;
  readonly dataType: string | null;
  readonly currency: string | null;
  readonly options: readonly { value: string; label: string }[];
  readonly person: boolean;
  readonly sensitive: boolean | null;
}

export interface GapRow {
  readonly personId: string;
  readonly name: string;
  readonly department: string | null;
  readonly manager: string | null;
  readonly missing: readonly string[];
  readonly owner: 'hr' | 'employee';
  readonly remindedAt: string | null;
}

export interface CompletenessState {
  readonly waiting: { people: number; lastReminded: string | null; due: number | null };
  readonly completedThisWeek: number;
  readonly toFill: number;
  readonly listed: number | null;
  readonly blocking: number | null;
  readonly fields: readonly GapField[];
  readonly rows: readonly GapRow[];
  readonly next: string | null;
}

export interface Counts {
  readonly changes: number | null;
  readonly identifiers: number | null;
  readonly duplicates: number | null;
  readonly accessRequests: number | null;
  readonly exports: number | null;
}

/** Everything the queue is drawn from: one read per queue, as the viewer. */
export interface ReviewData {
  readonly roles: { readonly hr: boolean; readonly admin: boolean; readonly finance: boolean };
  readonly approvals: ApprovalsState | null;
  readonly identifiers: IdState | null;
  readonly duplicates: DuplicatesState | null;
  readonly access: AccessState | null;
  readonly completeness: CompletenessState | null;
  readonly complete: { percent: number; incomplete: number } | null;
  readonly shares: readonly Share[] | null;
  readonly ownDecided: {
    changes: readonly ApprovalItem[];
    identifiers: readonly DecidedId[];
  } | null;
  readonly counts: Counts | null;
}

/** One row of the queue, whatever its kind. */
export interface Row {
  /** `change-…`, `id-<person>~<key>`, `dup-<a>~<b>`, `access-…`, `export-…`. */
  readonly id: string;
  readonly kind: Exclude<ReviewKind, 'missing'>;
  readonly name: string;
  readonly summary: string;
  readonly by: string | null;
  readonly at: string | null;
  readonly flag: string | null;
  readonly badge: { readonly tone: 'danger' | 'warning'; readonly text: string } | null;
}

export const CHIP: Readonly<Record<ReviewKind, string>> = {
  changes: 'Changes',
  ids: 'ID checks',
  duplicates: 'Duplicates',
  access: 'Full values',
  exports: 'Exports',
  missing: 'Missing details',
};

export const CHIPS: Readonly<Record<ReviewTab, readonly ReviewKind[]>> = {
  waiting: ['changes', 'ids', 'duplicates', 'access', 'exports', 'missing'],
  flagged: [],
  asked: ['changes', 'access'],
  decided: ['changes', 'ids', 'duplicates', 'access'],
};

export const isClosed = (item: ApprovalItem): boolean =>
  item.state === 'approved' ||
  item.state === 'rejected' ||
  item.state === 'lapsed' ||
  item.state === 'withdrawn';

export const isFlagged = (item: ApprovalItem): boolean => (item.flags ?? []).length > 0;

/** "12m", "3h", "Yesterday", "4 days": how long ago it was asked for. */
export function ago(at: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
  if (minutes < 60) return `${String(Math.max(minutes, 1))}m`;
  if (minutes < 24 * 60) return `${String(Math.floor(minutes / 60))}h`;
  const days = Math.floor(minutes / (24 * 60));
  return days === 1 ? 'Yesterday' : `${String(days)} days`;
}

/** How long until it lapses: "2 days left", "Expires today". */
export function daysLeft(expiresAt: string, now: number): string {
  const days = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 86_400_000));
  return days === 0 ? 'Expires today' : `${String(days)} ${days === 1 ? 'day' : 'days'} left`;
}

/** "Nora" from "Nora Becker"; "the requester" when it is not a name. */
export const firstName = (name: string): string =>
  name === 'You' || name.startsWith('A ') || name.startsWith('An ')
    ? 'the requester'
    : (name.split(' ')[0] ?? name);

const shortDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** "Salary · from 1 Oct": the field and when it takes effect, for a row. */
export const summaryOf = (item: ApprovalItem): string =>
  `${item.label} · from ${shortDate.format(Date.parse(`${item.effectiveFrom}T00:00:00Z`))}`;

export const pairId = (pair: DuplicatePair): string => pair.personIds.join('~');

const peopleCount = (n: number): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? 'person' : 'people'}`;

export const changeRow = (item: ApprovalItem): Row => ({
  id: `change-${item.id}`,
  kind: 'changes',
  name: item.name,
  summary: summaryOf(item),
  by: `Asked by ${item.requestedBy === 'You' ? 'you' : item.requestedBy}`,
  at: item.requestedAt,
  flag: isClosed(item) ? null : item.flagSummary,
  badge: null,
});

export const idRow = (item: IdItem): Row => ({
  id: `id-${item.personId}~${item.attributeKey}`,
  kind: 'ids',
  name: item.name,
  summary: `${item.label} · ${item.findings[0]?.message ?? ''}`,
  by:
    item.enteredBy === null
      ? null
      : `Entered by ${item.enteredBy === 'You' ? 'you' : item.enteredBy}`,
  at: item.enteredAt,
  flag: null,
  badge: item.findings.some((f) => f.level === 'mismatch')
    ? { tone: 'danger', text: 'Failed' }
    : { tone: 'warning', text: 'Unverifiable' },
});

const BAND = { strong: 'Strong', likely: 'Likely', possible: 'Possible' } as const;

export const pairRow = (pair: DuplicatePair): Row => ({
  id: `dup-${pairId(pair)}`,
  kind: 'duplicates',
  name: pair.names[0] ?? '',
  summary: `Possible duplicate of ${pair.names[1] ?? ''} · ${pair.reasons.join(', ')}`,
  by: pair.flaggedBy === null || pair.flaggedBy === '' ? null : `Flagged by ${pair.flaggedBy}`,
  at: null,
  flag: null,
  badge: pair.match === null ? null : { tone: 'warning', text: BAND[pair.match] },
});

export const accessRow = (r: AccessRequest): Row => ({
  id: `access-${r.id}`,
  kind: 'access',
  name: r.mine ? 'You' : (r.requestedBy ?? 'Somebody'),
  summary: `${r.fields.join(', ')} · ${r.reason}`,
  by: null,
  at: r.requestedAt,
  flag: null,
  badge: null,
});

export const shareRow = (share: Share): Row => ({
  id: `export-${share.id}`,
  kind: 'exports',
  name: share.requestedBy.name ?? 'A colleague',
  summary: `Export to ${share.recipient.name ?? 'a colleague'} · ${
    share.people === null ? share.reason : peopleCount(share.people)
  }`,
  by: null,
  at: share.requestedAt,
  flag: null,
  badge: null,
});

/** Newest first; a pair, undated, after everything dated. */
export const newestFirst = (rows: readonly Row[]): Row[] =>
  [...rows].sort((a, b) =>
    a.at === null
      ? b.at === null
        ? 0
        : 1
      : b.at === null
        ? -1
        : Date.parse(b.at) - Date.parse(a.at),
  );

/** Whose Review it is: HR's queue, an employee's own changes, or finance's requests. */
export type Viewer = 'hr' | 'finance' | 'employee';

export const viewerOf = (data: ReviewData): Viewer =>
  data.roles.hr || data.approvals?.isHr === true
    ? 'hr'
    : data.roles.finance && data.access?.canRequest === true
      ? 'finance'
      : 'employee';

/** The rows of a tab, before a chip narrows them: the web's `rowsOf`. */
export function rowsOf(data: ReviewData, tab: ReviewTab): Row[] {
  const items = data.approvals?.items ?? [];
  const forMe = items.filter((i) => i.canDecide || i.canSelfApprove === true);
  const asked = items.filter((i) => i.mine && !forMe.includes(i));
  const rest = items.filter((i) => !forMe.includes(i) && !asked.includes(i));
  const requests = data.access?.requests ?? [];
  if (viewerOf(data) !== 'hr') {
    return tab === 'decided'
      ? newestFirst((data.ownDecided?.changes ?? data.approvals?.decided ?? []).map(changeRow))
      : newestFirst(items.map(changeRow));
  }
  switch (tab) {
    case 'waiting':
      return newestFirst([
        ...[...forMe, ...rest].map(changeRow),
        ...(data.identifiers?.items ?? []).map(idRow),
        ...(data.duplicates?.items ?? []).map(pairRow),
        ...requests
          .filter((r) => r.state === 'pending' && !r.mine && data.access?.canDecide === true)
          .map(accessRow),
        ...(data.shares ?? []).filter((s) => s.state === 'pending').map(shareRow),
      ]);
    case 'flagged':
      return newestFirst(forMe.filter(isFlagged).map(changeRow));
    case 'asked':
      return newestFirst([
        ...asked.map(changeRow),
        ...requests.filter((r) => r.mine && r.state === 'pending').map(accessRow),
      ]);
    case 'decided':
      return newestFirst([
        ...(data.approvals?.decided ?? []).map(changeRow),
        ...requests.filter((r) => r.state !== 'pending').map(accessRow),
      ]);
  }
}
