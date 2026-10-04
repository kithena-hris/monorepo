import { ok, type Result } from '@kithena/domain-kit';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { rowSummary } from '../../domain/approval/unusual.js';
import { sharesToDecide, type ShareDeps } from '../export/share.js';
import { fullValuesScreen, type FullValuesDeps } from '../export/full-values.js';
import { flagChange, looking } from '../person/approval-flags.js';
import { approvalsInbox, type PendingChangeDeps } from '../person/pending-changes.js';
import type { Asking, PersonAccess } from '../person/person-access.js';
import { actors, duplicateSource } from './people.js';
import type { ScreenDeps } from './record.js';

/**
 * How many decisions wait for this viewer, counted, for the shell's bell and
 * badges: doubted identifiers and suspected duplicates (HR's), access
 * requests (HR decides them), and requests to send an export (a People
 * administrator's). Beside them, Review's other two tabs: the changes the
 * checks flag, and what HR asked for that waits on somebody else. Null where
 * the viewer has no such queue.
 *
 * The same queues their screens list, so a badge and its screen agree, but
 * without naming anybody on them: the shell drew every page after reading
 * three whole screens for their lengths, and only once the roles had said
 * whose they were.
 */
export interface WaitingView {
  readonly identifiers: number | null;
  readonly duplicates: number | null;
  readonly accessRequests: number | null;
  /** Changes waiting for this viewer's decision that People's checks flag: Review's Flagged. */
  readonly flagged: number | null;
  /** HR's own changes and requests for full values, waiting on somebody else: Review's I asked. */
  readonly asked: number | null;
  /** Requests to send an export this viewer may decide (E5). */
  readonly exports: number | null;
  /**
   * Who asked, beside each count, as the viewer may name them: whoever
   * entered each doubted identifier, asked for full values, or wants to send
   * an export. Distinct, oldest first; null beside a null count.
   */
  readonly identifiersBy: readonly string[] | null;
  /** What flagged the suspected duplicates: Kithena's check, SCIM provisioning, or both. */
  readonly duplicatesBy: readonly string[] | null;
  readonly accessRequestsBy: readonly string[] | null;
  readonly exportsBy: readonly string[] | null;
}

const distinct = (names: readonly (string | null)[]): string[] => [
  ...new Set(names.filter((n): n is string => n !== null)),
];

export async function waitingView(
  tx: PostgresJsDatabase,
  deps: {
    readonly access: PersonAccess;
    readonly fullValues?: FullValuesDeps;
    readonly pending?: PendingChangeDeps;
    readonly shares?: ShareDeps;
    /** Which person signs in as an account, to name who entered an identifier. Absent, nobody is. */
    readonly personOf?: ScreenDeps['personOf'];
  },
  asking: Asking,
): Promise<Result<WaitingView>> {
  const { roles } = asking.viewer;
  const shares = deps.shares === undefined ? null : await sharesToDecide(tx, deps.shares, asking);
  const decidable = shares?.ok === true && roles.has('people_admin') ? shares.value : null;
  const exports = decidable === null ? null : decidable.length;
  const exportsBy = decidable === null ? null : distinct(decidable.map((s) => s.requestedBy.name));
  if (!roles.has('hr') && !roles.has('finance')) {
    return ok({
      identifiers: null,
      duplicates: null,
      accessRequests: null,
      flagged: null,
      asked: null,
      exports,
      identifiersBy: null,
      duplicatesBy: null,
      accessRequestsBy: null,
      exportsBy,
    });
  }
  const identifiers = await deps.access.identifierReviews(tx, asking);
  const duplicates = await deps.access.duplicates(tx, asking);
  const full =
    deps.fullValues === undefined ? null : await fullValuesScreen(tx, deps.fullValues, asking);
  const hr = roles.has('hr');
  const inbox =
    hr && deps.pending !== undefined ? await approvalsInbox(tx, deps.pending, asking) : null;
  const mine =
    inbox?.ok === true
      ? inbox.value.items.filter((c) => c.mine && !c.canDecide && !c.canSelfApprove).length
      : null;
  const fullMine =
    full?.ok === true
      ? full.value.requests.filter((r) => r.mine && r.state === 'pending').length
      : 0;
  // Only a decision waits on somebody who can make it; a request of one's own is not one.
  const toDecide =
    full?.ok === true && full.value.canDecide
      ? full.value.requests.filter((r) => r.state === 'pending')
      : null;
  const entered = identifiers.ok
    ? identifiers.value.flatMap((r) => (r.enteredBy == null ? [] : [r.enteredBy]))
    : [];
  const named =
    deps.personOf === undefined
      ? null
      : await actors({ personOf: deps.personOf, service: deps }, tx, asking, entered);
  return ok({
    identifiers: identifiers.ok ? identifiers.value.length : null,
    duplicates: duplicates.ok ? duplicates.value.length : null,
    accessRequests: toDecide === null ? null : toDecide.length,
    identifiersBy: identifiers.ok ? distinct(named === null ? [] : entered.map(named)) : null,
    duplicatesBy: duplicates.ok
      ? distinct(duplicates.value.map((c) => duplicateSource(c.signals)))
      : null,
    accessRequestsBy: toDecide === null ? null : distinct(toDecide.map((r) => r.requestedBy)),
    exportsBy,
    flagged:
      hr && deps.pending !== undefined
        ? (await flaggedToDecide(tx, deps.pending, asking)).count
        : null,
    asked: mine === null ? null : mine + fullMine,
    exports,
  });
}

/**
 * The changes waiting for this viewer's decision that People's checks flag
 * (design AI7): how many, and the newest one's reasons in a line ("A 38%
 * raise"), as Review's Flagged tab lists them. Nobody's but whoever decides.
 */
export async function flaggedToDecide(
  tx: PostgresJsDatabase,
  pending: PendingChangeDeps,
  asking: Asking,
): Promise<{ readonly count: number; readonly latest: string | null }> {
  const inbox = await approvalsInbox(tx, pending, asking);
  if (!inbox.ok || !inbox.value.isHr) return { count: 0, latest: null };
  const deciding = inbox.value.items.filter((c) => c.canDecide || c.canSelfApprove);
  if (deciding.length === 0) return { count: 0, latest: null };
  const look = await looking(tx, pending, asking);
  let count = 0;
  let latest: string | null = null;
  // Oldest first, as the inbox is: the last flagged is the newest.
  for (const c of deciding) {
    const change = await pending.store.find(tx, asking.tenantId, c.id);
    if (change === null) continue;
    const found = await flagChange(tx, pending, look, {
      change,
      readable: c.readable,
      requesterName: 'the requester',
    });
    if (found.reasons.length === 0) continue;
    count += 1;
    latest = rowSummary(found.reasons);
  }
  return { count, latest };
}
