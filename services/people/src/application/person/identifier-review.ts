import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';
import {
  PersonIdentifierReviewed,
  PersonIdentifierRevealed,
  type AttributeDefinition,
} from '@kithena/contracts';

import { visibleTo, type ViewerRelations } from '../../domain/access/field-access.js';
import { currentValue } from '../../domain/person/history.js';
import {
  decideReview,
  isOpen,
  onIdentifierWritten,
  type IdentifierReview,
  type ReviewDecision,
  type ReviewFinding,
} from '../../domain/person/identifier-review.js';
import {
  checkNationalId,
  normaliseNationalId,
  type NationalIdCheck,
} from '../../country-packs/national-id.js';
import type { PersonRepository } from '../person-repository.js';
import type { PersonRecord } from './ports.js';

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
  insert(tx: Tx, tenantId: string, review: IdentifierReview): Promise<void>;
  /** Close whatever is open on this attribute: a new value replaced it. */
  supersede(tx: Tx, tenantId: string, personId: string, attributeKey: string): Promise<void>;
  /** Write the decision only if the review is still pending. False when somebody decided first. */
  decide(tx: Tx, tenantId: string, next: IdentifierReview): Promise<boolean>;
  publish(tx: Tx, events: readonly PendingEvent[]): Promise<void>;
  /** `drizzleSecretStore.reveal`: the audited read of a sealed value. */
  reveal(
    tx: Tx,
    where: { tenantId: string; personId: string; attributeKey: string },
  ): Promise<string | null>;
}

/** What the checks found on one identifier a write carried. */
export interface AttributeFindings {
  readonly key: string;
  readonly findings: readonly ReviewFinding[];
  /** `pending`: HR will review it. `accepted`: already accepted, not asked again. */
  readonly review: 'pending' | 'accepted' | 'none';
}

/** What a write decided about one identifier, before anything was stored. */
export interface IdentifierPlan {
  readonly definition: AttributeDefinition;
  readonly findings: readonly ReviewFinding[];
  readonly supersede: boolean;
  readonly open: boolean;
  readonly accepted: boolean;
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

/**
 * What a write does to each identifier's reviews, decided before the value is
 * stored: whether the one being replaced was accepted is read off the value
 * still in place.
 */
export async function planReviews(
  tx: Tx,
  deps: { readonly reviews: IdentifierReviews; readonly people: PersonRepository },
  tenantId: string,
  person: PersonRecord,
  written: readonly (readonly [AttributeDefinition, NationalIdCheck | null])[],
): Promise<readonly IdentifierPlan[]> {
  const plans: IdentifierPlan[] = [];
  for (const [definition, check] of written) {
    const where = { tenantId, personId: person.snapshot.id, attributeKey: definition.key };
    // eslint-disable-next-line no-await-in-loop -- a write carries one or two identifiers
    const latest = await deps.reviews.latest(tx, tenantId, where.personId, where.attributeKey);
    let same = false;
    if (latest?.state === 'accepted' && check !== null) {
      // The accepted value is the one in place only if nothing was written since.
      // eslint-disable-next-line no-await-in-loop -- as above
      const history = await deps.people.history(tx, tenantId, where.personId, definition.key);
      if (currentValue(history, definition.key)?.id === latest.historyId) {
        const prior = definition.encrypted
          ? // eslint-disable-next-line no-await-in-loop -- as above
            await deps.reviews.reveal(tx, where)
          : person.values[definition.key];
        same = typeof prior === 'string' && normaliseNationalId(prior) === check.normalised;
      }
    }
    const findings = check?.findings ?? [];
    const plan = onIdentifierWritten({ findings, latest, sameAsLatest: same });
    plans.push({
      definition,
      findings,
      ...plan,
      accepted: latest?.state === 'accepted' && same,
    });
  }
  return plans;
}

/** Apply the plans once the history rows they point at exist. */
export async function applyReviews(
  tx: Tx,
  deps: {
    readonly reviews: IdentifierReviews;
    readonly clock: Clock;
    readonly newId: () => string;
  },
  tenantId: string,
  personId: string,
  plans: readonly IdentifierPlan[],
  historyIds: ReadonlyMap<string, string>,
): Promise<void> {
  for (const plan of plans) {
    const key = plan.definition.key;
    // eslint-disable-next-line no-await-in-loop -- a write carries one or two identifiers
    if (plan.supersede) await deps.reviews.supersede(tx, tenantId, personId, key);
    const historyId = historyIds.get(key);
    if (!plan.open || historyId === undefined) continue;
    // eslint-disable-next-line no-await-in-loop -- as above
    await deps.reviews.insert(tx, tenantId, {
      id: deps.newId(),
      personId,
      attributeKey: key,
      historyId,
      findings: plan.findings,
      state: 'pending',
      createdAt: deps.clock.instant(),
      decidedBy: null,
      decidedAt: null,
      note: null,
    });
  }
}

/** What a write tells its caller about each identifier it carried. */
export const findingsOf = (plans: readonly IdentifierPlan[]): readonly AttributeFindings[] =>
  plans
    .filter((p) => p.findings.length > 0)
    .map((p) => ({
      key: p.definition.key,
      findings: p.findings,
      review: p.open ? 'pending' : p.accepted ? 'accepted' : 'none',
    }));

/* ------------------------------------------------------------ reviewing -- */

/** One review as HR's queue lists it. The value is never here; `last4` is what a screen shows. */
export interface ReviewItem extends IdentifierReview {
  readonly label: string;
  readonly last4: string | null;
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
  },
): Promise<Result<string>> {
  const value = input.definition.encrypted
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
