import { randomBytes } from 'node:crypto';
import * as z from 'zod';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { publish } from '@kithena/db-kit';
import { TenantId } from '@kithena/contracts';
import { err, failure, ok, type Clock, type PendingEvent, type Result } from '@kithena/domain-kit';

import type { InTenant } from '../../application/person/service.js';
import { open, seal, type KeyRing } from '../envelope.js';
import { vet, type EgressPolicy, type Poster } from './egress.js';
import { filterFor, signatureHeader, type StoredEnvelope } from './payload.js';
import { outbox } from '../tables.js';
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
 *             attempt; then the delivery fails, the endpoint is disabled,
 *             `people.webhook.endpoint_disabled` is raised in the same
 *             transaction, and the endpoint's alert address is emailed.
 *   Durable   The schedule is the rows: `next_attempt_at` is written before
 *             anything is sent. A pass claims a delivery by pushing that
 *             forward by a lease, so two processes — or one restarted
 *             mid-send — never send the same delivery at once, and a crash
 *             mid-send is a resend once the lease runs out.
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
  /**
   * After the disable has committed: the tenant's alert address is emailed.
   * The event is the durable notice; this is best effort, and a failure here
   * is the caller's to log.
   */
  readonly notify: (tenantId: string, disabled: DisabledEndpoint) => Promise<void> | void;
}

export interface DisabledEndpoint {
  readonly endpointId: string;
  readonly url: string;
  readonly alertEmail: string | null;
  readonly lastResponse: number;
}

/**
 * How long a claimed delivery is held before another pass may take it.
 * Longer than any send (the poster times out well inside it), so a live send
 * is never doubled; short enough that a crash mid-send costs minutes.
 */
const LEASE_MS = 5 * 60 * 1000;

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

/** `people.webhook_endpoint.alert_email` holds 3 to 320 characters. */
const AlertEmail = z.email().max(320);

export interface EndpointInput {
  readonly url: string;
  readonly events: readonly string[];
  readonly allowlist: readonly string[];
  /**
   * Emailed if the endpoint is disabled. Required for every new endpoint: the
   * admin who registers a receiver names who hears when it stops. Endpoints
   * created before this rule may hold null and are told through the event alone.
   */
  readonly alertEmail: string;
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

export function webhooks(deps: WebhookDeps): WebhookService {
  // An early answer for the settings screen. Not the defence: DNS can change
  // its mind, so `post` vets and pins again on every delivery.
  const validate = async (input: Partial<EndpointInput>): Promise<Result<void>> => {
    if (input.url !== undefined) {
      const target = await vet(input.url, deps.egress);
      if (!target.ok) return target;
    }
    if (input.events?.length === 0) {
      return err(failure('BAD_WEBHOOK_EVENTS', 'Subscribe to at least one event', ['events']));
    }
    if (input.alertEmail !== undefined && !AlertEmail.safeParse(input.alertEmail).success) {
      return err(
        failure(
          'BAD_WEBHOOK_ALERT_EMAIL',
          'Give an address to email if this endpoint is turned off',
          ['alertEmail'],
        ),
      );
    }
    return ok(undefined);
  };

  return {
    async createEndpoint(tenantId, input) {
      // Required by the type here; `validate` checks it is an address.
      const valid = await validate(input);
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
          alertEmail: input.alertEmail,
          secretCiphertext: sealed.ciphertext,
          secretKeyId: sealed.keyId,
        }),
      );
      return ok({ id, secret: plaintext });
    },

    async updateEndpoint(tenantId, id, patch) {
      const valid = await validate(patch);
      if (!valid.ok) return valid;
      const updated = await deps.inTenant(tenantId, ({ tx }) =>
        tx
          .update(webhookEndpoint)
          .set({
            ...(patch.url === undefined ? {} : { url: patch.url }),
            ...(patch.events === undefined ? {} : { events: [...patch.events] }),
            ...(patch.allowlist === undefined ? {} : { allowlist: [...patch.allowlist] }),
            ...(patch.alertEmail === undefined ? {} : { alertEmail: patch.alertEmail }),
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
          /*
           * Claimed before anything else. The head query read without a lock,
           * so another process may have read the same row; only one of the two
           * moves `next_attempt_at` from due to a lease, and the other moves on.
           * That is what keeps a delivery to one send per pass across replicas,
           * and a restart mid-send to a resend once the lease is up.
           */
          const claimed = await deps.inTenant(tenantId, ({ tx }) =>
            tx
              .update(webhookDelivery)
              .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
              .where(
                and(
                  eq(webhookDelivery.id, delivery.id),
                  eq(webhookDelivery.status, 'pending'),
                  lte(webhookDelivery.nextAttemptAt, now),
                ),
              )
              .returning({ id: webhookDelivery.id }),
          );
          if (claimed.length === 0) continue;

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
          const disabled = await deps.inTenant(tenantId, async ({ tx }) => {
            await tx
              .update(webhookDelivery)
              .set({ status: 'failed', attempts, firstAttemptedAt: first, lastResponse: status })
              .where(eq(webhookDelivery.id, delivery.id));
            // Conditional, so an endpoint is disabled — and the tenant told —
            // once, however many deliveries reach the ceiling together.
            const turnedOff = await tx
              .update(webhookEndpoint)
              .set({ disabledAt: now, disabledReason: reason, updatedAt: now })
              .where(and(eq(webhookEndpoint.id, endpoint.id), isNull(webhookEndpoint.disabledAt)))
              .returning({ id: webhookEndpoint.id });
            if (turnedOff.length === 0) return false;
            await publish(tx, outbox, [disabledEvent(tenantId, endpoint.id, status, deps)]);
            return true;
          });
          if (disabled) {
            await deps.notify(tenantId, {
              endpointId: endpoint.id,
              url: endpoint.url,
              alertEmail: endpoint.alertEmail,
              lastResponse: status,
            });
          }
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

/**
 * `people.webhook.endpoint_disabled`: the tenant is told, durably, in the
 * transaction that disabled it. No URL and no address — a URL can carry a
 * receiver's token in its query, and the event is a Kafka topic kept for years.
 */
function disabledEvent(
  tenantId: string,
  endpointId: string,
  lastResponse: number,
  deps: Pick<WebhookDeps, 'clock' | 'newId'>,
): PendingEvent {
  const at = deps.clock.instant();
  return {
    eventId: deps.newId(),
    eventName: 'people.webhook.endpoint_disabled',
    eventVersion: 1,
    tenantId: TenantId.parse(tenantId),
    occurredAt: at,
    effectiveFrom: null,
    aggregate: { type: 'WebhookEndpoint', id: endpointId, version: 1 },
    actor: { kind: 'system', process: 'people-webhooks' },
    correlationId: deps.newId(),
    causationId: null,
    payload: {
      endpointId,
      reason: 'delivery_ceiling',
      // 0 is "no response at all": a refused connection or a timeout.
      lastResponse: lastResponse === 0 ? null : lastResponse,
      disabledAt: at,
    },
  };
}
