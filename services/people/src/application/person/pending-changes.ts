import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';
import {
  PersonChangeDecided,
  PersonChangeExpired,
  PersonChangeRequested,
  PersonChangeWithdrawn,
  requiresApproval,
  type Actor,
  type AttributeDefinition,
} from '@kithena/contracts';

import { visibleTo } from '../../domain/access/field-access.js';
import { expire, openApproval, stateAt, type Approval } from '../../domain/approval/approval.js';
import {
  approversOf,
  declineForReview,
  decideChange,
  mayApproveAlone,
  withdrawChange,
  type DecidedAs,
} from '../../domain/approval/pending-change.js';
import type { ReviewFinding } from '../../domain/person/identifier-review.js';
import type { IdentifierReviews } from './identifier-review.js';
import { LIFECYCLE_KEYS } from './core.js';
import type {
  Asking,
  PersonReader,
  RelationsResolver,
  SchemaVersions,
  SealedValue,
} from './ports.js';

/**
 * Changes held for approval (PEO-077; PRD §8.6).
 *
 * A write to a field that requires approval — `requiresApproval` on its
 * definition, on by default for financial or encrypted data — is **recorded
 * here and not applied**. Every writer comes through `PersonAccess.update`
 * or `correct` (a form, the grid, an import, a hire, REST, GraphQL), and
 * that is where the value is taken out of the write and handed to
 * `holdChange`; the rest of the write goes ahead. Nothing is refused for
 * needing approval.
 *
 * - **HR decides**, within seven days, and never the requester nor the person
 *   the change is about (`domain/approval/pending-change.ts`). HR's own change
 *   needs a second HR member — unless no HR member but the requester may
 *   decide (the only one, or one of two changing the other's record): then
 *   the requester approves it alone, once they confirm it (`soleApprover`),
 *   and the decision says `sole_hr`.
 * - **A doubted national identifier is reviewed first** (PEO-125): holding it
 *   opens its review against the held value, nobody approves it until the
 *   review is accepted, and a review that finds errors declines it with the
 *   reviewer's reason (`declineHeldForReview`).
 * - **An approval applies the value** through the same `update` or `correct`,
 *   with the `effectiveFrom` the write asked for — so a raise entered on the
 *   15th and effective on the 1st is still effective on the 1st, however long
 *   HR took — in the transaction that records the decision. The history row
 *   names the requester; its event is caused by `change_decided`.
 * - **The requester may withdraw it** while it waits; undecided, it expires,
 *   and the expiry is recorded and emailed.
 * - **A pending value is never a current value.** It is not in the person's
 *   row, history, secrets, completeness, exports or PDFs; `pendingFor` shows
 *   it apart, to a viewer who may read the field, masked as the field is.
 *
 * System work — the scheduled-values job, a renumbering — is not held: what
 * it writes was already approved or needs none. Neither is the lifecycle's
 * own dates, which have their own HR-only moves. HR may choose to apply
 * without approval (`applySensitiveWithoutApproval` on the asking), and the
 * event says so.
 */

type Tx = PostgresJsDatabase;

export const DECISION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type ChangeKind = 'value' | 'correction';

export interface PendingChange {
  readonly tenantId: string;
  readonly personId: string;
  readonly attributeKey: string;
  readonly kind: ChangeKind;
  readonly approval: Approval;
  /** When it takes effect once approved: what the write asked for, or its day. */
  readonly effectiveFrom: string;
  /** The history row a correction replaces. */
  readonly supersedes: string | null;
  /** Held sealed: `value` is null and `last4` is what may be shown. */
  readonly sealed: boolean;
  /** As the write path took it; null when sealed, or for a value being cleared. */
  readonly value: unknown;
  readonly last4: string | null;
  /** How it was decided, when not by another HR member: null until then, and for them. */
  readonly decidedAs: Exclude<DecidedAs, 'approver'> | null;
}

export interface PendingChangeStore {
  /** `plaintext` for a sealed value only: sealed by the store, never kept as it came. */
  insert(tx: Tx, change: PendingChange, plaintext: string | null): Promise<void>;
  find(tx: Tx, tenantId: string, id: string): Promise<PendingChange | null>;
  /**
   * Pending by their row — an expiry not yet recorded included — oldest
   * first: one person's, one requester's, or the tenant's.
   */
  open(
    tx: Tx,
    tenantId: string,
    where: { readonly personId?: string; readonly requestedBy?: string; readonly limit: number },
  ): Promise<readonly PendingChange[]>;
  /** Every change to one person, whatever it became, oldest first: their subject access pack. */
  forPerson(tx: Tx, tenantId: string, personId: string): Promise<readonly PendingChange[]>;
  /** A sealed value's plaintext, while it is pending. */
  unseal(tx: Tx, tenantId: string, id: string): Promise<string | null>;
  /**
   * Write `next` only if the row is still pending, and drop any ciphertext
   * with it. False when somebody closed it first.
   */
  close(tx: Tx, prior: PendingChange, next: PendingChange): Promise<boolean>;
}

/** What the write path needs to hold a change. */
export interface Holding {
  readonly store: PendingChangeStore;
  /** The outbox, in the caller's transaction. */
  readonly publish: (tx: Tx, events: readonly PendingEvent[]) => Promise<void>;
  readonly clock: Clock;
  readonly newId: () => string;
}

/**
 * The two `PersonAccess` writes an approved change goes through. A port here
 * rather than `PersonAccess` itself, which imports this file.
 */
export interface ApprovedWriter {
  update(
    tx: Tx,
    asking: Asking & {
      readonly personId: string;
      readonly changes: Readonly<Record<string, unknown>>;
      readonly effectiveFrom?: string;
    },
  ): Promise<Result<unknown>>;
  correct(
    tx: Tx,
    asking: Asking & {
      readonly personId: string;
      readonly supersedes: string;
      readonly value: unknown;
      readonly reason: string | null;
    },
  ): Promise<Result<unknown>>;
}

export interface PendingChangeDeps extends Holding {
  readonly access: ApprovedWriter;
  readonly schemas: SchemaVersions;
  readonly reader: PersonReader;
  readonly relations: RelationsResolver;
  /**
   * Who holds `hr`, as the role rows say (PEO-112): whether anybody but the
   * requester may approve. Absent, nobody approves alone.
   */
  readonly roles?: Pick<RoleReads, 'holdings'>;
  /** A held identifier's review (PEO-125). Absent, no change waits on one. */
  readonly reviews?: IdentifierReviews;
}

/* ------------------------------------------------- the approved write -- */

const APPROVED = Symbol('people.approved');

/** The change an approved write applies: whose it was, and the decision that let it through. */
export interface ApprovedChange {
  readonly requestedBy: string;
  readonly causationId: string;
}

/**
 * An asking that applies an approved change: not held again, written with the
 * reach the requester had when they asked, recorded as theirs. A symbol, so
 * no transport can put it on an asking built from a request body.
 */
function asApproved<A extends Asking>(asking: A, change: ApprovedChange): A {
  return { ...asking, [APPROVED]: change };
}

export const approvedOf = (asking: Asking): ApprovedChange | undefined =>
  (asking as Asking & { readonly [APPROVED]?: ApprovedChange })[APPROVED];

/** Whether a write of this attribute is held, given who writes it (the caller says). */
export function holds(definition: AttributeDefinition): boolean {
  return requiresApproval(definition) && !LIFECYCLE_KEYS.has(definition.key);
}

/* -------------------------------------------------------------- hold -- */

const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

function event(
  deps: Pick<Holding, 'clock' | 'newId'>,
  change: PendingChange,
  actor: Actor,
  correlationId: string,
  name: string,
  payload: unknown,
  version: number,
  eventId = deps.newId(),
): PendingEvent {
  return {
    eventId,
    eventName: name,
    eventVersion: 1,
    tenantId: change.tenantId as PendingEvent['tenantId'],
    occurredAt: deps.clock.instant(),
    effectiveFrom: change.effectiveFrom as PendingEvent['effectiveFrom'],
    aggregate: { type: 'PendingChange', id: change.approval.id, version },
    actor,
    correlationId,
    causationId: null,
    payload,
  };
}

/**
 * Record a change and do not apply it. Called by the write path, in its
 * transaction, for each value it takes out; `change_requested` wakes the
 * approval workflow once it is consumed.
 */
export async function holdChange(
  tx: Tx,
  deps: Holding,
  input: {
    readonly tenantId: string;
    readonly personId: string;
    readonly definition: AttributeDefinition;
    readonly value: unknown;
    readonly effectiveFrom: string;
    readonly actor: Actor;
    readonly requestedBy: string;
    readonly correlationId: string;
    readonly kind: ChangeKind;
    readonly supersedes: string | null;
    readonly reason: string | null;
    /** A doubted identifier's review, opened against this change; the review it answers. */
    readonly review?: { readonly id: string | null; readonly supersedes: string | null };
  },
): Promise<Result<PendingChange>> {
  const now = deps.clock.instant();
  const opened = openApproval({
    id: deps.newId(),
    requestedBy: input.requestedBy,
    reason: input.reason,
    reasonOptional: true,
    at: now,
    expiresAt: plus(now, DECISION_WINDOW_MS),
  });
  if (!opened.ok) return opened;

  const sealed = input.definition.encrypted;
  // Shown as the stored secret would be: its last four, never more.
  const display = typeof input.value === 'string' ? input.value : JSON.stringify(input.value);
  const change: PendingChange = {
    tenantId: input.tenantId,
    personId: input.personId,
    attributeKey: input.definition.key,
    kind: input.kind,
    approval: opened.value,
    effectiveFrom: input.effectiveFrom,
    supersedes: input.supersedes,
    sealed,
    value: sealed ? null : input.value,
    last4: sealed && display.length > 0 ? display.slice(-4) : null,
    decidedAs: null,
  };
  await deps.store.insert(tx, change, sealed ? JSON.stringify(input.value) : null);
  await deps.publish(tx, [
    event(
      deps,
      change,
      input.actor,
      input.correlationId,
      PersonChangeRequested.name,
      PersonChangeRequested.payload.parse({
        changeId: change.approval.id,
        personId: change.personId,
        attributeKey: change.attributeKey,
        kind: change.kind,
        supersedes: change.supersedes,
        reason: change.approval.reason === '' ? null : change.approval.reason,
        expiresAt: change.approval.expiresAt,
        ...(input.review?.id == null ? {} : { reviewId: input.review.id }),
        ...(input.review?.supersedes == null ? {} : { supersedesReview: input.review.supersedes }),
      }),
      1,
    ),
  ]);
  return ok(change);
}

/* ------------------------------------------------------------ decide -- */

const NotFound = () => failure('NOT_FOUND', 'No such pending change');
const user = (userId: string): Actor => ({ kind: 'user', userId });
const SETTLE: Actor = { kind: 'system', process: 'people-pending-change' };

/** Every account holding `hr` now, as the role rows say; none when they cannot be read. */
async function hrHolders(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'roles'>,
  tenantId: string,
): Promise<readonly string[]> {
  if (!deps.roles) return [];
  const held = await deps.roles.holdings(tx, tenantId);
  return [...held].flatMap(([account, roles]) => (roles.has('hr') ? [account] : []));
}

/** The review a held identifier waits on, while it is not accepted (PEO-125). */
async function openReviewOf(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'reviews'>,
  change: PendingChange,
) {
  const review = await deps.reviews?.forChange(tx, change.tenantId, change.approval.id);
  return review === undefined || review === null || review.state === 'accepted' ? null : review;
}

/**
 * Close the review this change's value was waiting on: nobody reviews a value
 * that will never be written. One already sent back stays: it is the
 * employee's to answer, and their next value supersedes it.
 */
async function closeReviewOf(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'reviews'>,
  change: PendingChange,
): Promise<void> {
  const review = await openReviewOf(tx, deps, change);
  if (review?.state === 'pending') {
    await deps.reviews?.supersede(tx, change.tenantId, change.personId, change.attributeKey);
  }
}

/**
 * HR approves or rejects. An approval applies the value in this transaction,
 * so a value the write path would now refuse — a unique value somebody else
 * took meanwhile, a field since archived — refuses the approval with the
 * write's own reason, and the change stays pending for HR to reject.
 *
 * A requester whom no other HR member may approve for approves their own
 * change with `soleApprover`, asked of who holds `hr` now, in this
 * transaction: an eligible member granted a moment ago is the approver instead.
 */
export async function decidePendingChange(
  tx: Tx,
  deps: PendingChangeDeps,
  asking: Asking & {
    readonly changeId: string;
    readonly approve: boolean;
    readonly note?: string | null;
    /** The requester confirmed they approve it alone: no other HR member may. */
    readonly soleApprover?: boolean;
  },
): Promise<Result<PendingChange>> {
  const prior = await deps.store.find(tx, asking.tenantId, asking.changeId);
  if (!prior) return err(NotFound());
  const person = await deps.reader.record(tx, asking.tenantId, prior.personId);
  if (!person) return err(NotFound());
  const relations = await deps.relations.relations(
    tx,
    asking.tenantId,
    asking.viewer,
    prior.personId,
  );
  const decided = decideChange(prior.approval, {
    by: asking.viewer.accountId,
    isHr: relations.isHr,
    subjectAccountId: person.snapshot.identityAccountId,
    approve: asking.approve,
    at: deps.clock.instant(),
    note: asking.note ?? null,
    hr: await hrHolders(tx, deps, asking.tenantId),
    soleApprover: asking.soleApprover === true,
    awaitingReview: (await openReviewOf(tx, deps, prior)) !== null,
  });
  if (!decided.ok) return decided;
  const { approval, decidedAs } = decided.value;

  // Opened before the row is closed: closing drops the ciphertext.
  const approved = approval.state === 'approved';
  let value = prior.value;
  if (approved && prior.sealed) {
    const plaintext = await deps.store.unseal(tx, prior.tenantId, prior.approval.id);
    if (plaintext === null) return err(NotFound());
    value = JSON.parse(plaintext) as unknown;
  }

  const next: PendingChange = {
    ...prior,
    approval,
    decidedAs: decidedAs === 'approver' ? null : decidedAs,
  };
  const decisionId = await closeDecided(tx, deps, prior, next, asking);
  if (!decisionId.ok) return decisionId;
  if (!approved) {
    await closeReviewOf(tx, deps, prior);
    return ok(next);
  }

  const applied = await apply(tx, deps, next, value, decisionId.value, asking.correlationId);
  return applied.ok ? ok(next) : applied;
}

/** Record a decision: the guarded close, then `change_decided`. Its event id causes the write. */
async function closeDecided(
  tx: Tx,
  deps: Holding,
  prior: PendingChange,
  next: PendingChange,
  asking: { readonly viewer: { readonly accountId: string }; readonly correlationId: string },
): Promise<Result<string>> {
  if (!(await deps.store.close(tx, prior, next))) {
    return err(failure('APPROVAL_DECIDED', 'Somebody closed this change first'));
  }
  const decisionId = deps.newId();
  await deps.publish(tx, [
    event(
      deps,
      next,
      user(asking.viewer.accountId),
      asking.correlationId,
      PersonChangeDecided.name,
      PersonChangeDecided.payload.parse({
        changeId: next.approval.id,
        personId: next.personId,
        attributeKey: next.attributeKey,
        decision: next.approval.state,
        note: next.approval.note,
        ...(next.decidedAs === null ? {} : { decidedAs: next.decidedAs }),
      }),
      2,
      decisionId,
    ),
  ]);
  return ok(decisionId);
}

/**
 * The review of a held identifier found errors (PEO-125): the change is
 * declined, in the review's transaction, with the reviewer's reason as its
 * note; the requester and the employee are told as for any rejection, and
 * the employee sees the reason on their record. Nothing to do when the change
 * already closed — it expired, or was withdrawn — and the review stands alone.
 */
export async function declineHeldForReview(
  tx: Tx,
  deps: Holding,
  input: Asking & { readonly changeId: string; readonly note: string | null },
): Promise<Result<PendingChange | null>> {
  const prior = await deps.store.find(tx, input.tenantId, input.changeId);
  if (!prior) return ok(null);
  const declined = declineForReview(prior.approval, {
    by: input.viewer.accountId,
    at: deps.clock.instant(),
    note: input.note,
  });
  if (!declined.ok) return declined.error.code === 'REASON_REQUIRED' ? declined : ok(null);
  const next: PendingChange = {
    ...prior,
    approval: declined.value.approval,
    decidedAs: 'identifier_review',
  };
  const closed = await closeDecided(tx, deps, prior, next, input);
  return closed.ok ? ok(next) : closed;
}

async function apply(
  tx: Tx,
  deps: PendingChangeDeps,
  change: PendingChange,
  value: unknown,
  causationId: string,
  correlationId: string,
): Promise<Result<void>> {
  const on = asApproved(
    {
      tenantId: change.tenantId,
      viewer: { accountId: change.approval.requestedBy, roles: new Set<string>() },
      correlationId,
      personId: change.personId,
    },
    { requestedBy: change.approval.requestedBy, causationId },
  );
  if (change.kind === 'correction' && change.supersedes !== null) {
    const fixed = await deps.access.correct(tx, {
      ...on,
      supersedes: change.supersedes,
      value,
      reason: change.approval.reason === '' ? null : change.approval.reason,
    });
    return fixed.ok ? ok(undefined) : fixed;
  }
  const version = await deps.schemas.current(tx, change.tenantId);
  const dated =
    version?.document.attributes.find((d) => d.key === change.attributeKey)?.effectiveDated ===
    true;
  const written = await deps.access.update(tx, {
    ...on,
    changes: { [change.attributeKey]: value },
    ...(dated ? { effectiveFrom: change.effectiveFrom } : {}),
  });
  return written.ok ? ok(undefined) : written;
}

/** The requester takes it back while it waits. */
export async function withdrawPendingChange(
  tx: Tx,
  deps: PendingChangeDeps,
  asking: Asking & { readonly changeId: string },
): Promise<Result<PendingChange>> {
  const prior = await deps.store.find(tx, asking.tenantId, asking.changeId);
  if (!prior) return err(NotFound());
  const withdrawn = withdrawChange(prior.approval, {
    by: asking.viewer.accountId,
    at: deps.clock.instant(),
  });
  if (!withdrawn.ok) return withdrawn;
  const next: PendingChange = { ...prior, approval: withdrawn.value };
  if (!(await deps.store.close(tx, prior, next))) {
    return err(failure('APPROVAL_DECIDED', 'Somebody closed this change first'));
  }
  await closeReviewOf(tx, deps, prior);
  await deps.publish(tx, [
    event(
      deps,
      next,
      user(asking.viewer.accountId),
      asking.correlationId,
      PersonChangeWithdrawn.name,
      PersonChangeWithdrawn.payload.parse({
        changeId: next.approval.id,
        personId: next.personId,
        attributeKey: next.attributeKey,
      }),
      2,
    ),
  ]);
  return ok(next);
}

/* ------------------------------------------------------------ settle -- */

export type Settled = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'expired';

/**
 * What the change's state calls for now: record an expiry that is due, or
 * nothing. Idempotent — the workflow's activity, retried or replayed, lands
 * here every time — and `expiredNow` is true exactly once, for the call that
 * recorded it.
 */
export async function settlePendingChange(
  tx: Tx,
  deps: Holding & Pick<PendingChangeDeps, 'reviews'>,
  where: { readonly tenantId: string; readonly changeId: string; readonly correlationId: string },
): Promise<Result<{ state: Settled; change: PendingChange; expiredNow: boolean }>> {
  const prior = await deps.store.find(tx, where.tenantId, where.changeId);
  if (!prior) return err(NotFound());
  const now = deps.clock.instant();
  const state = stateAt(prior.approval, now);
  if (state !== 'expired' || prior.approval.state === 'expired') {
    return ok({ state, change: prior, expiredNow: false });
  }
  const expired = expire(prior.approval, now);
  if (!expired.ok) return expired;
  const next: PendingChange = { ...prior, approval: expired.value };
  if (!(await deps.store.close(tx, prior, next))) {
    // Closed meanwhile: say what it became.
    const now2 = await deps.store.find(tx, where.tenantId, where.changeId);
    return ok({
      state: now2?.approval.state ?? 'expired',
      change: now2 ?? next,
      expiredNow: false,
    });
  }
  await closeReviewOf(tx, deps, prior);
  await deps.publish(tx, [
    event(
      deps,
      next,
      SETTLE,
      where.correlationId,
      PersonChangeExpired.name,
      PersonChangeExpired.payload.parse({
        changeId: next.approval.id,
        personId: next.personId,
        attributeKey: next.attributeKey,
      }),
      2,
    ),
  ]);
  return ok({ state: 'expired', change: next, expiredNow: true });
}

/* ------------------------------------------------------------- reads -- */

/** A pending value as a viewer may see it: in clear, or sealed to its last four. */
export interface PendingValue {
  readonly id: string;
  readonly attributeKey: string;
  readonly kind: ChangeKind;
  readonly value: unknown;
  readonly effectiveFrom: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly requestedBy: string;
  readonly reason: string | null;
  /** The viewer asked for it, so may withdraw it. */
  readonly mine: boolean;
  /** The viewer holds HR and is neither the requester nor the subject. */
  readonly canDecide: boolean;
  /**
   * The viewer asked, holds HR, and no other HR member may decide it: they may
   * approve it alone, once they confirm it (PEO-077).
   */
  readonly canSelfApprove: boolean;
  /** A doubted identifier whose review is not accepted yet: nobody approves it (PEO-125). */
  readonly awaitingReview: boolean;
  /** What the checks doubted, while it waits on its review. Never the value. */
  readonly findings: readonly ReviewFinding[];
}

/** What a viewer may do with a change, and what it waits on. */
async function standing(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'reviews'>,
  change: PendingChange,
  may: {
    readonly me: string;
    readonly isHr: boolean;
    readonly subject: string | null;
    readonly hr: readonly string[];
  },
): Promise<
  Pick<PendingValue, 'mine' | 'canDecide' | 'canSelfApprove' | 'awaitingReview' | 'findings'>
> {
  const review = await openReviewOf(tx, deps, change);
  const requester = change.approval.requestedBy;
  return {
    mine: requester === may.me,
    canDecide: may.isHr && requester !== may.me && may.subject !== may.me,
    canSelfApprove:
      may.isHr &&
      mayApproveAlone(
        may.hr,
        { requestedBy: change.approval.requestedBy, subjectAccountId: may.subject },
        may.me,
      ),
    awaitingReview: review !== null,
    findings: review === null ? [] : review.findings.filter((f) => f.level !== 'ok'),
  };
}

const shown = (change: PendingChange): unknown =>
  change.sealed ? ({ last4: change.last4 } satisfies SealedValue) : change.value;

/**
 * One person's changes still waiting, on the fields this viewer may read
 * (PEO-077): the same `visibleTo` a read of the record uses, so a pending
 * value is never shown to somebody the current value is withheld from.
 */
export async function pendingFor(
  tx: Tx,
  deps: Pick<
    PendingChangeDeps,
    'store' | 'schemas' | 'reader' | 'relations' | 'clock' | 'roles' | 'reviews'
  >,
  asking: Asking & { readonly personId: string },
): Promise<Result<readonly PendingValue[]>> {
  const version = await deps.schemas.current(tx, asking.tenantId);
  if (!version) return ok([]);
  const person = await deps.reader.record(tx, asking.tenantId, asking.personId);
  if (!person) return err(failure('NOT_FOUND', 'No such person'));
  const relations = await deps.relations.relations(
    tx,
    asking.tenantId,
    asking.viewer,
    asking.personId,
  );
  const byKey = new Map(version.document.attributes.map((d) => [d.key as string, d]));
  const now = deps.clock.instant();
  const me = asking.viewer.accountId;
  const subject = person.snapshot.identityAccountId;
  const open = await deps.store.open(tx, asking.tenantId, {
    personId: asking.personId,
    limit: 100,
  });
  const hr = await hrHolders(tx, deps, asking.tenantId);
  const found: PendingValue[] = [];
  for (const c of open) {
    const definition = byKey.get(c.attributeKey);
    if (definition === undefined || stateAt(c.approval, now) !== 'pending') continue;
    if (!visibleTo(definition, relations)) continue;
    found.push({
      id: c.approval.id,
      attributeKey: c.attributeKey,
      kind: c.kind,
      value: shown(c),
      effectiveFrom: c.effectiveFrom,
      requestedAt: c.approval.requestedAt,
      expiresAt: c.approval.expiresAt,
      requestedBy: c.approval.requestedBy,
      reason: c.approval.reason === '' ? null : c.approval.reason,
      ...(await standing(tx, deps, c, { me, isHr: relations.isHr, subject, hr })),
    });
  }
  return ok(found);
}

/** One change in the inbox; `value` is null where the viewer may not read the field. */
export interface InboxItem extends Omit<PendingValue, 'value'> {
  readonly personId: string;
  readonly value: unknown;
  readonly readable: boolean;
}

const NOBODY = '00000000-0000-0000-0000-000000000000';
const INBOX = 200;

/**
 * The approvals inbox: every change waiting in the tenant for HR, oldest
 * first; for anybody else, their own. A value is shown only where the viewer
 * may read the field on that person — HR can be asked to approve a field it
 * cannot read, and then decides on who asked, when, and why.
 */
export async function approvalsInbox(
  tx: Tx,
  deps: Pick<
    PendingChangeDeps,
    'store' | 'schemas' | 'reader' | 'relations' | 'clock' | 'roles' | 'reviews'
  >,
  asking: Asking,
): Promise<Result<{ readonly isHr: boolean; readonly items: readonly InboxItem[] }>> {
  const version = await deps.schemas.current(tx, asking.tenantId);
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  if (!version) return ok({ isHr: everyone.isHr, items: [] });
  const me = asking.viewer.accountId;
  const open = await deps.store.open(tx, asking.tenantId, {
    ...(everyone.isHr ? {} : { requestedBy: me }),
    limit: INBOX,
  });
  const byKey = new Map(version.document.attributes.map((d) => [d.key as string, d]));
  const now = deps.clock.instant();
  const hr = await hrHolders(tx, deps, asking.tenantId);
  const items: InboxItem[] = [];
  for (const c of open) {
    const definition = byKey.get(c.attributeKey);
    if (definition === undefined || stateAt(c.approval, now) !== 'pending') continue;
    const person = await deps.reader.record(tx, asking.tenantId, c.personId);
    if (!person) continue;
    const relations = await deps.relations.relations(
      tx,
      asking.tenantId,
      asking.viewer,
      c.personId,
    );
    const readable = visibleTo(definition, relations);
    const subject = person.snapshot.identityAccountId;
    items.push({
      id: c.approval.id,
      personId: c.personId,
      attributeKey: c.attributeKey,
      kind: c.kind,
      value: readable ? shown(c) : null,
      readable,
      effectiveFrom: c.effectiveFrom,
      requestedAt: c.approval.requestedAt,
      expiresAt: c.approval.expiresAt,
      requestedBy: c.approval.requestedBy,
      reason: c.approval.reason === '' ? null : c.approval.reason,
      ...(await standing(tx, deps, c, { me, isHr: everyone.isHr, subject, hr })),
    });
  }
  return ok({ isHr: everyone.isHr, items });
}

/* ---------------------------------------------------------- who to tell -- */

/** Who holds which tenant role, and who they are: `RoleStore`'s two reads. */
export interface RoleReads {
  holdings(tx: Tx, tenantId: string): Promise<ReadonlyMap<string, ReadonlySet<string>>>;
  candidates(
    tx: Tx,
    tenantId: string,
  ): Promise<readonly { readonly accountId: string; readonly workEmail: string | null }[]>;
}

/**
 * The addresses to tell about a change: every approver (HR, less the
 * requester and the subject), the requester, and the person it is about. An account with no current
 * record, or no work email, is not told — the inbox still lists the change.
 */
export async function whoToTell(
  tx: Tx,
  deps: { readonly reader: PersonReader; readonly roles: RoleReads },
  change: PendingChange,
): Promise<{
  readonly approvers: readonly { readonly accountId: string; readonly email: string }[];
  readonly requester: string | null;
  /** The person the change is about, when they have an account and a work email. */
  readonly subject: string | null;
}> {
  const held = await deps.roles.holdings(tx, change.tenantId);
  const people = await deps.roles.candidates(tx, change.tenantId);
  const person = await deps.reader.record(tx, change.tenantId, change.personId);
  const email = new Map(
    people.flatMap((p) => (p.workEmail === null ? [] : [[p.accountId, p.workEmail] as const])),
  );
  const hr = [...held].flatMap(([account, roles]) => (roles.has('hr') ? [account] : []));
  const approvers = approversOf(hr, {
    requestedBy: change.approval.requestedBy,
    subjectAccountId: person?.snapshot.identityAccountId ?? null,
  }).flatMap((accountId) => {
    const to = email.get(accountId);
    return to === undefined ? [] : [{ accountId, email: to }];
  });
  const subject = person?.snapshot.identityAccountId ?? null;
  return {
    approvers,
    requester: email.get(change.approval.requestedBy) ?? null,
    subject: subject === null ? null : (email.get(subject) ?? null),
  };
}
