import { randomBytes } from 'node:crypto';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { AttributeDefinition } from '@kithena/contracts';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import type { SchemaVersions } from '../../application/person/ports.js';
import type { InTenant } from '../../application/person/service.js';
import { open, seal, type KeyRing } from '../envelope.js';
import { vet, type EgressPolicy, type Poster } from './egress.js';
import { filterFor, signatureHeader, type StoredEnvelope } from './payload.js';
import { webhookDelivery, webhookEndpoint } from './tables.js';

/**
 * Outbound webhooks (§13.3).
 *
 *   Enqueue   A trigger on `people.outbox` writes one delivery per subscribed
 *             endpoint in the same INSERT as the event, so a delivery exists
 *             if and only if the event does.
 *   Order     Per person: only the oldest pending delivery for an (endpoint,
 *             aggregate) pair is sent; the next waits until it is settled.
 *   Delivery  At least once. The envelope carries `eventId`, and so does a
 *             header, for the receiver to deduplicate on.
 *   Retry     Exponential from 30 seconds, until 24 hours after the first
 *             attempt; then the delivery fails, the endpoint is disabled and
 *             the tenant is told.
 *   Replay    A new delivery of a stored envelope, filtered against the
 *             allowlist as it is when it is sent — never as it was.
 */

export interface WebhookDeps {
  readonly inTenant: InTenant;
  readonly ring: KeyRing;
  /** Delivery. In production, `pinnedPoster` over the same egress policy. */
  readonly post: Poster;
  /** Checked at registration as well as, through `post`, at every delivery. */
  readonly egress: EgressPolicy;
  readonly clock: Clock;
  readonly newId: () => string;
  /** The tenant is told an endpoint was disabled. */
  readonly notify: (tenantId: string, endpointId: string, reason: string) => void;
  /** The version in force, which is what an allowlist may name. */
  readonly schemas: SchemaVersions;
}

const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;
const GIVE_UP_MS = 24 * 60 * 60 * 1000;

/**
 * When to try again after `attempts` failures, or null once 24 hours have
 * passed since the first attempt. The last retry lands on the 24-hour mark
 * rather than past it.
 */
export function nextAttempt(firstAttempt: Date, attempts: number, now: Date): Date | null {
  const deadline = firstAttempt.getTime() + GIVE_UP_MS;
  if (now.getTime() >= deadline) return null;
  const wait = Math.min(FIRST_RETRY_MS * 2 ** Math.max(attempts - 1, 0), MAX_RETRY_MS);
  return new Date(Math.min(now.getTime() + wait, deadline));
}

const secret = () => randomBytes(32).toString('base64url');

export interface EndpointInput {
  readonly url: string;
  readonly events: readonly string[];
  readonly allowlist: readonly string[];
}

export interface WebhookService {
  /** The secret is returned once, here, and never again. */
  createEndpoint(
    tenantId: string,
    input: EndpointInput,
  ): Promise<Result<{ id: string; secret: string }>>;
  /** Change what an endpoint receives, or re-enable one that was disabled. */
  updateEndpoint(
    tenantId: string,
    id: string,
    patch: Partial<EndpointInput> & { readonly enabled?: boolean },
  ): Promise<Result<void>>;
  /** A new secret; the old one keeps signing until the overlap ends. */
  rotateSecret(
    tenantId: string,
    id: string,
    overlapHours?: number,
  ): Promise<Result<{ secret: string }>>;
  /** Send what is due for one tenant. */
  deliverDue(
    tenantId: string,
  ): Promise<{ delivered: number; skipped: number; retrying: number; failed: number }>;
  /** Send a stored delivery again, filtered as the endpoint is configured now. */
  replay(tenantId: string, deliveryId: string): Promise<Result<string>>;
  /** When the next pending delivery for this tenant falls due, for a timer. */
  nextDue(tenantId: string): Promise<Date | null>;
}

/**
 * Whether every key may be named in an allowlist (§13.3).
 *
 * A key must exist in the version in force, so an allowlist cannot promise a
 * field nobody defined. Special-category and encrypted attributes are refused
 * outright: the first never travels on an event and the second never leaves
 * the secret store, so naming either would be a promise the payload breaks —
 * or, worse, one a later change quietly keeps. Checked here, in the one place
 * every caller goes through, so the settings screen and any API get the same
 * answer.
 */
export function allowable(
  definitions: readonly AttributeDefinition[],
  keys: readonly string[],
): Result<void> {
  const byKey = new Map(definitions.map((d) => [d.key as string, d]));
  for (const key of keys) {
    const definition = byKey.get(key);
    if (definition === undefined) {
      return err(
        failure('FIELD_NOT_ALLOWED', `${key} is not a field in the published schema`, [
          'allowlist',
        ]),
      );
    }
    if (definition.classification.classification === 'special-category') {
      return err(
        failure(
          'FIELD_NOT_ALLOWED',
          `${key} is special-category data and never leaves in a webhook`,
          ['allowlist'],
        ),
      );
    }
    if (definition.encrypted) {
      return err(
        failure('FIELD_NOT_ALLOWED', `${key} is encrypted and never leaves in a webhook`, [
          'allowlist',
        ]),
      );
    }
  }
  return ok(undefined);
}

export function webhooks(deps: WebhookDeps): WebhookService {
  // An early answer for the settings screen. Not the defence: DNS can change
  // its mind, so `post` vets and pins again on every delivery.
  const validate = async (
    tenantId: string,
    input: Partial<EndpointInput>,
  ): Promise<Result<void>> => {
    if (input.url !== undefined) {
      const target = await vet(input.url, deps.egress);
      if (!target.ok) return target;
    }
    if (input.events?.length === 0) {
      return err(failure('BAD_WEBHOOK_EVENTS', 'Subscribe to at least one event', ['events']));
    }
    if (input.allowlist !== undefined && input.allowlist.length > 0) {
      const version = await deps.inTenant(tenantId, ({ tx }) => deps.schemas.current(tx, tenantId));
      const allowed = allowable(version?.document.attributes ?? [], input.allowlist);
      if (!allowed.ok) return allowed;
    }
    return ok(undefined);
  };

  return {
    async createEndpoint(tenantId, input) {
      const valid = await validate(tenantId, input);
      if (!valid.ok) return valid;
      const id = deps.newId();
      const plaintext = secret();
      const sealed = seal(plaintext, deps.ring);
      await deps.inTenant(tenantId, ({ tx }) =>
        tx.insert(webhookEndpoint).values({
          id,
          tenantId,
          url: input.url,
          events: [...input.events],
          allowlist: [...input.allowlist],
          secretCiphertext: sealed.ciphertext,
          secretKeyId: sealed.keyId,
        }),
      );
      return ok({ id, secret: plaintext });
    },

    async updateEndpoint(tenantId, id, patch) {
      const valid = await validate(tenantId, patch);
      if (!valid.ok) return valid;
      const updated = await deps.inTenant(tenantId, ({ tx }) =>
        tx
          .update(webhookEndpoint)
          .set({
            ...(patch.url === undefined ? {} : { url: patch.url }),
            ...(patch.events === undefined ? {} : { events: [...patch.events] }),
            ...(patch.allowlist === undefined ? {} : { allowlist: [...patch.allowlist] }),
            ...(patch.enabled === true ? { disabledAt: null, disabledReason: null } : {}),
            ...(patch.enabled === false
              ? { disabledAt: deps.clock.now(), disabledReason: 'disabled by the tenant' }
              : {}),
            updatedAt: deps.clock.now(),
          })
          .where(and(eq(webhookEndpoint.tenantId, tenantId), eq(webhookEndpoint.id, id)))
          .returning({ id: webhookEndpoint.id }),
      );
      return updated.length === 1 ? ok(undefined) : err(failure('NOT_FOUND', 'No such endpoint'));
    },

    async rotateSecret(tenantId, id, overlapHours = 24) {
      const plaintext = secret();
      const sealed = seal(plaintext, deps.ring);
      const rotated = await deps.inTenant(tenantId, ({ tx }) =>
        tx
          .update(webhookEndpoint)
          .set({
            previousSecretCiphertext: sql`${webhookEndpoint.secretCiphertext}`,
            previousSecretKeyId: sql`${webhookEndpoint.secretKeyId}`,
            previousSecretExpiresAt: new Date(
              deps.clock.now().getTime() + overlapHours * 3_600_000,
            ),
            secretCiphertext: sealed.ciphertext,
            secretKeyId: sealed.keyId,
            updatedAt: deps.clock.now(),
          })
          .where(and(eq(webhookEndpoint.tenantId, tenantId), eq(webhookEndpoint.id, id)))
          .returning({ id: webhookEndpoint.id }),
      );
      return rotated.length === 1
        ? ok({ secret: plaintext })
        : err(failure('NOT_FOUND', 'No such endpoint'));
    },

    async deliverDue(tenantId) {
      const totals = { delivered: 0, skipped: 0, retrying: 0, failed: 0 };

      // Passes, because settling one person's head delivery makes their next
      // one the head. Bounded so a flood cannot hold the process.
      for (let pass = 0; pass < 20; pass += 1) {
        const now = deps.clock.now();
        const heads = await deps.inTenant(tenantId, ({ tx }) =>
          tx
            .select({ delivery: webhookDelivery, endpoint: webhookEndpoint })
            .from(webhookDelivery)
            .innerJoin(webhookEndpoint, eq(webhookEndpoint.id, webhookDelivery.endpointId))
            .where(
              and(
                eq(webhookDelivery.tenantId, tenantId),
                eq(webhookDelivery.status, 'pending'),
                lte(webhookDelivery.nextAttemptAt, now),
                isNull(webhookEndpoint.disabledAt),
                sql`NOT EXISTS (
                  SELECT 1 FROM people.webhook_delivery earlier
                   WHERE earlier.endpoint_id = ${webhookDelivery.endpointId}
                     AND earlier.aggregate_id = ${webhookDelivery.aggregateId}
                     AND earlier.status = 'pending'
                     AND earlier.seq < ${webhookDelivery.seq})`,
              ),
            )
            .orderBy(asc(webhookDelivery.seq))
            .limit(100),
        );
        if (heads.length === 0) break;

        let settled = 0;
        for (const { delivery, endpoint } of heads) {
          const filtered = filterFor(delivery.envelope as StoredEnvelope, endpoint.allowlist);

          if (filtered === null) {
            await deps.inTenant(tenantId, ({ tx }) =>
              tx
                .update(webhookDelivery)
                .set({ status: 'skipped' })
                .where(eq(webhookDelivery.id, delivery.id)),
            );
            totals.skipped += 1;
            settled += 1;
            continue;
          }

          const secrets = [
            open({ ciphertext: endpoint.secretCiphertext, keyId: endpoint.secretKeyId }, deps.ring),
          ];
          if (
            endpoint.previousSecretCiphertext !== null &&
            endpoint.previousSecretKeyId !== null &&
            endpoint.previousSecretExpiresAt !== null &&
            endpoint.previousSecretExpiresAt > now
          ) {
            secrets.push(
              open(
                {
                  ciphertext: endpoint.previousSecretCiphertext,
                  keyId: endpoint.previousSecretKeyId,
                },
                deps.ring,
              ),
            );
          }

          const body = JSON.stringify(filtered);
          // Sent outside any transaction: a slow receiver must not hold a
          // connection, and a crash here is a resend, which at-least-once allows.
          const status = await deps
            .post(endpoint.url, {
              headers: {
                'content-type': 'application/json',
                'kithena-event-id': delivery.eventId,
                'kithena-delivery-id': delivery.id,
                'kithena-signature': signatureHeader(body, secrets),
              },
              body,
            })
            .then((r) => r.status)
            .catch(() => 0);

          const attempts = delivery.attempts + 1;
          const first = delivery.firstAttemptedAt ?? now;

          if (status >= 200 && status < 300) {
            await deps.inTenant(tenantId, ({ tx }) =>
              tx
                .update(webhookDelivery)
                .set({
                  status: 'delivered',
                  attempts,
                  firstAttemptedAt: first,
                  lastResponse: status,
                  deliveredAt: now,
                })
                .where(eq(webhookDelivery.id, delivery.id)),
            );
            totals.delivered += 1;
            settled += 1;
            continue;
          }

          const next = nextAttempt(first, attempts, now);
          if (next !== null) {
            await deps.inTenant(tenantId, ({ tx }) =>
              tx
                .update(webhookDelivery)
                .set({
                  attempts,
                  firstAttemptedAt: first,
                  lastResponse: status,
                  nextAttemptAt: next,
                })
                .where(eq(webhookDelivery.id, delivery.id)),
            );
            totals.retrying += 1;
            continue;
          }

          const reason = `No successful delivery for 24 hours (last response ${String(status)})`;
          await deps.inTenant(tenantId, async ({ tx }) => {
            await tx
              .update(webhookDelivery)
              .set({ status: 'failed', attempts, firstAttemptedAt: first, lastResponse: status })
              .where(eq(webhookDelivery.id, delivery.id));
            await tx
              .update(webhookEndpoint)
              .set({ disabledAt: now, disabledReason: reason, updatedAt: now })
              .where(eq(webhookEndpoint.id, endpoint.id));
          });
          deps.notify(tenantId, endpoint.id, reason);
          totals.failed += 1;
          settled += 1;
        }

        if (settled === 0) break;
      }

      return totals;
    },

    async nextDue(tenantId) {
      const [row] = await deps.inTenant(tenantId, ({ tx }) =>
        tx
          .select({ at: webhookDelivery.nextAttemptAt })
          .from(webhookDelivery)
          .innerJoin(webhookEndpoint, eq(webhookEndpoint.id, webhookDelivery.endpointId))
          .where(
            and(
              eq(webhookDelivery.tenantId, tenantId),
              eq(webhookDelivery.status, 'pending'),
              isNull(webhookEndpoint.disabledAt),
            ),
          )
          .orderBy(asc(webhookDelivery.nextAttemptAt))
          .limit(1),
      );
      return row?.at ?? null;
    },

    async replay(tenantId, deliveryId) {
      return deps.inTenant(tenantId, async ({ tx }) => {
        const [original] = await tx
          .select()
          .from(webhookDelivery)
          .where(and(eq(webhookDelivery.tenantId, tenantId), eq(webhookDelivery.id, deliveryId)))
          .limit(1);
        if (!original) return err(failure('NOT_FOUND', 'No such delivery'));

        const id = deps.newId();
        await tx.insert(webhookDelivery).values({
          id,
          tenantId,
          endpointId: original.endpointId,
          eventId: original.eventId,
          eventName: original.eventName,
          aggregateId: original.aggregateId,
          // The envelope as the outbox held it. Filtering happens on send.
          envelope: original.envelope,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: deps.clock.now(),
          replayOf: original.replayOf ?? original.id,
        });
        return ok(id);
      });
    },
  };
}
