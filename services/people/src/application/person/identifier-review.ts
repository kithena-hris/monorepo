import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';
import {
  PersonIdentifierReviewed,
  PersonIdentifierRevealed,
  type AttributeDefinition,
} from '@kithena/contracts';

import { visibleTo, type ViewerRelations } from '../../domain/access/field-access.js';
import {
  decideReview,
  isOpen,
  onIdentifierWritten,
  type IdentifierReview,
  type ReviewDecision,
  type ReviewFinding,
} from '../../domain/person/identifier-review.js';
import { checkNationalId, type NationalIdCheck } from '../../country-packs/national-id.js';

/**
 * HR's review of the national identifiers our checks doubted (PEO-125; PRD
 * §6.4, §8.4), for every transport through `PersonAccess`.
 *
 * - **Warn, never block.** A write carries the findings of every identifier
 *   it wrote back to its caller; only a value that cannot be the identifier
 *   at all is refused.
 * - **Queued for HR.** A value accepted with an `attention` or `mismatch`
 *   finding opens a review keyed to the history row that wrote it. History is
 *   never touched: the review is its own record.
 * - **The reviewer is final.** `accept` closes it and the same value is never
 *   flagged again; `send_back` asks the employee to correct it, and their
 *   next value supersedes it. Both are audited with a classified event that
 *   names the finding codes and never the value.
 * - **The value is shown only to who may read it**, and a sealed one only
 *   through `reveal`, which is audited too.
 */

type Tx = PostgresJsDatabase;

/** `drizzleIdentifierReviews` satisfies this. */
export interface IdentifierReviews {
  /** The newest review of one attribute on one person, whatever its state. */
  latest(
    tx: Tx,
    tenantId: string,
    personId: string,
    attributeKey: string,
  ): Promise<IdentifierReview | null>;
  /** One person's reviews still waiting on somebody: pending or sent back. */
  open(tx: Tx, tenantId: string, personId: string): Promise<readonly IdentifierReview[]>;
  /** HR's queue, oldest first. */
  pending(tx: Tx, tenantId: string, limit: number): Promise<readonly IdentifierReview[]>;
  /** The review of a value held for approval (PEO-077), whatever its state. */
  forChange(tx: Tx, tenantId: string, changeId: string): Promise<IdentifierReview | null>;
  insert(tx: Tx, tenantId: string, review: IdentifierReview): Promise<void>;
  /** Close whatever is open on this attribute: a new value replaced it. */
  supersede(tx: Tx, tenantId: string, personId: string, attributeKey: string): Promise<void>;
  /** Write the decision only if the review is still pending. False when somebody decided first. */
  decide(tx: Tx, tenantId: string, next: IdentifierReview): Promise<boolean>;
  publish(tx: Tx, events: readonly PendingEvent[]): Promise<void>;
  /**
   * A keyed hash of a normalised value, under the current key: what a review
   * stores to be recognised again. Never reversible, never the value.
   */
  fingerprint(
    tenantId: string,
    attributeKey: string,
    normalised: string,
  ): { readonly valueHash: string; readonly keyId: string };
  /** Whether this normalised value is the one a review is about. A hash comparison: nothing is decrypted. */
  matches(tenantId: string, review: IdentifierReview, normalised: string): boolean;
  /**
   * `drizzleSecretStore.reveal`: the audited read of a sealed value. Called
   * only when a reviewer asks to see one (`reveal` below), never to compare.
   */
  reveal(
    tx: Tx,
    where: { tenantId: string; personId: string; attributeKey: string },
  ): Promise<string | null>;
}

/** Where a value stands with HR: the latest review of this very value, if any. */
export type ReviewStanding = 'pending' | 'accepted' | 'sent_back' | 'none';

/** What the checks found on one identifier, and where that value stands with HR. */
export interface AttributeFindings {
  readonly key: string;
  readonly findings: readonly ReviewFinding[];
  readonly review: ReviewStanding;
}

/**
 * The country's check on one proposed identifier: refused only when it
 * cannot be the identifier at all. Null for any other type.
 */
export function checkIdentifier(
  definition: AttributeDefinition,
  value: unknown,
): Result<NationalIdCheck | null> {
  const config = definition.typeConfig;
  if (config.kind !== 'national_id' || typeof value !== 'string') return ok(null);
  const checked = checkNationalId(config.country, config.scheme, value);
  return checked.ok
    ? checked
    : err(
        failure('VALUE_INVALID', `${definition.key}: ${checked.error.message}`, [definition.key]),
      );
}

/** One identifier a write carries: its definition and the check of its new value (null: cleared). */
export type Carried = readonly [AttributeDefinition, NationalIdCheck | null];

/**
 * Where each checked value stands with HR: the state of the latest review of
 * that attribute when its fingerprint is this value's, else `none`. The one
 * answer every transport gives — a write's response, a retry's replay and the
 * check a form makes before it saves — so the three cannot disagree.
 */
export async function findingsFor(
  tx: Tx,
  reviews: IdentifierReviews | undefined,
  tenantId: string,
  personId: string,
  carried: readonly Carried[],
): Promise<readonly AttributeFindings[]> {
  const found: AttributeFindings[] = [];
  for (const [definition, check] of carried) {
    if (check === null) continue;
    const latest = reviews ? await reviews.latest(tx, tenantId, personId, definition.key) : null;
    const mine = latest !== null && reviews?.matches(tenantId, latest, check.normalised) === true;
    found.push({
      key: definition.key,
      findings: check.findings,
      review: !mine || latest.state === 'superseded' ? 'none' : latest.state,
    });
  }
  return found;
}

/** One write's identifiers, gated: what it will do to their reviews, and doing it. */
export interface IdentifierGate {
  /** Supersede and open reviews, once the history rows they point at exist. */
  apply(tx: Tx, historyIds: ReadonlyMap<string, string>): Promise<void>;
  /** After `apply`: what the caller is told, as `findingsFor` answers. */
  findings(tx: Tx): Promise<readonly AttributeFindings[]>;
}

/**
 * **The one path every write of a national identifier takes** (PEO-125): an
 * edit, a hire, an import row, a grid cell, a correction. Decided before the
 * value is stored, applied after its history row is written.
 *
 * Whether the value is the one HR accepted is a comparison of keyed hashes
 * (`matches`): nothing is decrypted, so nothing reads as a reveal.
 */
export async function gateIdentifiers(
  tx: Tx,
  deps: {
    readonly reviews: IdentifierReviews | undefined;
    readonly clock: Clock;
    readonly newId: () => string;
  },
  tenantId: string,
  personId: string,
  carried: readonly Carried[],
): Promise<IdentifierGate> {
  const { reviews } = deps;
  const plans: {
    readonly carried: Carried;
    readonly supersede: boolean;
    readonly open: boolean;
  }[] = [];
  if (reviews) {
    for (const entry of carried) {
      const [definition, check] = entry;
      const latest = await reviews.latest(tx, tenantId, personId, definition.key);
      const same =
        latest !== null && check !== null && reviews.matches(tenantId, latest, check.normalised);
      plans.push({
        carried: entry,
        ...onIdentifierWritten({ findings: check?.findings ?? [], latest, sameAsLatest: same }),
      });
    }
  }
  return {
    async apply(at, historyIds) {
      if (!reviews) return;
      for (const plan of plans) {
        const [definition, check] = plan.carried;
        const key = definition.key;
        if (plan.supersede) await reviews.supersede(at, tenantId, personId, key);
        const historyId = historyIds.get(key);
        if (!plan.open || historyId === undefined || check === null) continue;
        await reviews.insert(at, tenantId, {
          id: deps.newId(),
          personId,
          attributeKey: key,
          historyId,
          pendingChangeId: null,
          ...reviews.fingerprint(tenantId, key, check.normalised),
          findings: check.findings,
          state: 'pending',
          createdAt: deps.clock.instant(),
          decidedBy: null,
          decidedAt: null,
          note: null,
        });
      }
    },
    findings: (at) => findingsFor(at, reviews, tenantId, personId, carried),
  };
}

/** A held identifier's review, planned before the change is recorded and opened once it is. */
export interface HeldReview {
  /** The review this value opens, or null when nothing is doubted. */
  readonly id: string | null;
  /** The sent-back review this value answers, closed by it. */
  readonly supersedes: string | null;
  open(tx: Tx, changeId: string): Promise<void>;
}

/**
 * **A doubted identifier held for approval is reviewed first** (PEO-077,
 * PEO-125). The same rule a write follows (`onIdentifierWritten`), taken when
 * the value is held rather than when it is written: whatever is open on the
 * attribute is superseded — a sent-back value is answered by this one — and a
 * doubted value opens its review against the held change. Nobody approves the
 * change until that review is accepted; once approved, the write meets the
 * accepted review of the same value and asks nobody again.
 */
export async function reviewHeld(
  tx: Tx,
  deps: {
    readonly reviews?: IdentifierReviews | undefined;
    readonly clock: Clock;
    readonly newId: () => string;
  },
  tenantId: string,
  personId: string,
  carried: Carried,
): Promise<HeldReview> {
  const { reviews } = deps;
  const [definition, check] = carried;
  const none: HeldReview = { id: null, supersedes: null, open: () => Promise.resolve() };
  if (!reviews || definition.typeConfig.kind !== 'national_id') return none;
  const latest = await reviews.latest(tx, tenantId, personId, definition.key);
  const same =
    latest !== null && check !== null && reviews.matches(tenantId, latest, check.normalised);
  const plan = onIdentifierWritten({ findings: check?.findings ?? [], latest, sameAsLatest: same });
  const id = plan.open && check !== null ? deps.newId() : null;
  return {
    id,
    supersedes: plan.supersede && latest?.state === 'sent_back' ? latest.id : null,
    async open(at, changeId) {
      if (plan.supersede) await reviews.supersede(at, tenantId, personId, definition.key);
      if (id === null || check === null) return;
      await reviews.insert(at, tenantId, {
        id,
        personId,
        attributeKey: definition.key,
        historyId: null,
        pendingChangeId: changeId,
        ...reviews.fingerprint(tenantId, definition.key, check.normalised),
        findings: check.findings,
        state: 'pending',
        createdAt: deps.clock.instant(),
        decidedBy: null,
        decidedAt: null,
        note: null,
      });
    },
  };
}

/* ------------------------------------------------------------ reviewing -- */

/** One review as HR's queue lists it. The value is never here; `last4` is what a screen shows. */
export interface ReviewItem extends IdentifierReview {
  readonly label: string;
  readonly last4: string | null;
}

/** The value a held change carries, for its review: sealed until a reviewer reveals it (PEO-077). */
export interface HeldValues {
  last4(tx: Tx, tenantId: string, changeId: string): Promise<string | null>;
  /** The value in full while the change is pending; null once it closed. */
  value(tx: Tx, tenantId: string, changeId: string): Promise<string | null>;
}

export interface ReviewDeps {
  readonly reviews: IdentifierReviews;
  readonly clock: Clock;
  readonly newId: () => string;
}

function audit(
  deps: ReviewDeps,
  tenantId: string,
  review: IdentifierReview,
  actor: string,
  correlationId: string,
  eventName: string,
  payload: unknown,
): PendingEvent {
  return {
    eventId: deps.newId(),
    eventName,
    eventVersion: 1,
    tenantId: tenantId as PendingEvent['tenantId'],
    occurredAt: deps.clock.instant(),
    effectiveFrom: null,
    aggregate: { type: 'Person', id: review.personId, version: 1 },
    actor: { kind: 'user', userId: actor },
    correlationId,
    causationId: null,
    payload,
  };
}

const NotReviewable = (key: string) =>
  failure('NOT_FOUND', `Nothing about ${key} is waiting for review`, [key]);

/**
 * The open review on an attribute this viewer may decide: HR, and able to
 * read the attribute on this person. Refused the same way whether the review
 * is missing or the viewer may not see it, so a probe learns nothing.
 */
export async function reviewable(
  tx: Tx,
  deps: ReviewDeps,
  input: {
    readonly tenantId: string;
    readonly personId: string;
    readonly attributeKey: string;
    readonly definition: AttributeDefinition | undefined;
    readonly relations: ViewerRelations;
  },
): Promise<Result<IdentifierReview>> {
  if (!input.relations.isHr) return err(failure('FORBIDDEN', 'Only HR reviews identifiers'));
  const { definition } = input;
  if (!definition || !visibleTo(definition, input.relations)) {
    return err(NotReviewable(input.attributeKey));
  }
  const latest = await deps.reviews.latest(tx, input.tenantId, input.personId, input.attributeKey);
  return latest && isOpen(latest) ? ok(latest) : err(NotReviewable(input.attributeKey));
}

/** The reviewer's decision, final, and its audit event. */
export async function decide(
  tx: Tx,
  deps: ReviewDeps,
  review: IdentifierReview,
  input: {
    readonly tenantId: string;
    readonly by: string;
    readonly correlationId: string;
    readonly decision: ReviewDecision;
    readonly note: string | null;
  },
): Promise<Result<IdentifierReview>> {
  const decided = decideReview(review, {
    decision: input.decision,
    by: input.by,
    at: deps.clock.instant(),
    note: input.note,
  });
  if (!decided.ok) return decided;
  if (!(await deps.reviews.decide(tx, input.tenantId, decided.value))) {
    return err(failure('REVIEW_DECIDED', 'Somebody reviewed this value first'));
  }
  await deps.reviews.publish(tx, [
    audit(
      deps,
      input.tenantId,
      decided.value,
      input.by,
      input.correlationId,
      PersonIdentifierReviewed.name,
      PersonIdentifierReviewed.payload.parse({
        personId: review.personId,
        attributeKey: review.attributeKey,
        reviewId: review.id,
        decision: decided.value.state,
        findingCodes: review.findings.filter((f) => f.level !== 'ok').map((f) => f.code),
        note: decided.value.note,
        ...(review.pendingChangeId === null ? {} : { changeId: review.pendingChangeId }),
      }),
    ),
  ]);
  return decided;
}

/** The value under review, in full, for a reviewer: audited, whether sealed or not. */
export async function reveal(
  tx: Tx,
  deps: ReviewDeps,
  review: IdentifierReview,
  input: {
    readonly tenantId: string;
    readonly by: string;
    readonly correlationId: string;
    readonly definition: AttributeDefinition;
    readonly values: Readonly<Record<string, unknown>>;
    /** Where a held value is read from: it is not in the record yet. */
    readonly held?: HeldValues;
  },
): Promise<Result<string>> {
  const value =
    review.pendingChangeId !== null
      ? await input.held?.value(tx, input.tenantId, review.pendingChangeId)
      : input.definition.encrypted
        ? await deps.reviews.reveal(tx, {
            tenantId: input.tenantId,
            personId: review.personId,
            attributeKey: review.attributeKey,
          })
        : input.values[review.attributeKey];
  if (typeof value !== 'string') return err(NotReviewable(review.attributeKey));
  await deps.reviews.publish(tx, [
    audit(
      deps,
      input.tenantId,
      review,
      input.by,
      input.correlationId,
      PersonIdentifierRevealed.name,
      PersonIdentifierRevealed.payload.parse({
        personId: review.personId,
        attributeKey: review.attributeKey,
        reviewId: review.id,
      }),
    ),
  ]);
  return ok(value);
}
