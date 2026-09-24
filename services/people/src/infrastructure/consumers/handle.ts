import type * as z from 'zod';
import {
  AccountProfileCaptured,
  AccountProvisioned,
  PersonAnonymised,
  PersonHired,
  PersonIdentityLinked,
  PersonManagerChanged,
  PersonOrgChanged,
  PersonProvisioned,
  PersonStatusChanged,
  PersonTerminated,
  SchemaPublished,
  TenantAmended,
  TenantEntitlementsChanged,
  TenantProvisioned,
  type EventDefinition,
  type EventEnvelope,
} from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import type { RecomputeCompleteness } from '../../application/completeness/recompute.js';
import type { OrgAdmin } from '../../application/org/org.js';
import type { ProvisionalPeople } from '../../application/reconcile.js';
import type { OpenFga } from '../openfga.js';
import { rememberEntitlements } from '../entitlements.js';
import { rememberTenant } from '../tenants.js';
import type { InTenantTransaction } from '../unit-of-work.js';
import { captureProfile } from './identity.js';

/**
 * Every event People consumes, parsed against its contract and applied.
 *
 * Transport-free on purpose: the Kafka loop in `wire.ts` hands each message
 * value here, and the integration tests hand the same envelopes in directly.
 *
 * A message that does not parse is logged and skipped rather than thrown.
 * Throwing would make Kafka redeliver it forever and stall the partition
 * behind it, and a malformed event will be exactly as malformed next time.
 * A database error still throws, because that one may well succeed on retry.
 *
 * The two events that give a tenant work — its first account, its first
 * publish — also record the tenant, in the same transaction, so background
 * jobs know it exists (PEO-080).
 */

export type Outcome = 'applied' | 'unchanged' | 'ignored' | 'rejected';

export interface ConsumerDeps {
  readonly inTenant: InTenantTransaction;
  readonly provisional: ProvisionalPeople;
  readonly recompute: RecomputeCompleteness;
  /** OpenFGA's tuples, kept in line with People's own events (PEO-092). Absent standalone. */
  readonly authz?: Pick<OpenFga, 'sync'>;
  /** Legal entities and settings, for the company the back office created (PEO-099). */
  readonly org?: OrgAdmin;
}

/**
 * People's own events that move who may see whom. Each one only says which
 * person to look at again: `sync` reads the row, so order and redelivery
 * cannot leave a stale tuple behind.
 */
const RELATIONAL: readonly { readonly name: string; readonly schema: z.ZodType }[] = [
  PersonProvisioned,
  PersonIdentityLinked,
  PersonHired,
  PersonManagerChanged,
  PersonOrgChanged,
  PersonStatusChanged,
  PersonTerminated,
  PersonAnonymised,
];

const PROCESS = 'people.consumer';

export function peopleConsumer(deps: ConsumerDeps): (raw: unknown) => Promise<Outcome> {
  return async (raw) => {
    const name: unknown =
      typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'eventName') : undefined;

    switch (name) {
      case AccountProvisioned.name: {
        const event = parse(AccountProvisioned, raw);
        if (!event) return 'rejected';
        const { payload } = event;
        const wrote = await deps.inTenant(event.tenantId, async ({ tx }) => {
          await rememberTenant(tx, event.tenantId);
          return deps.provisional.provision(
            tx,
            event.tenantId,
            {
              accountId: payload.accountId,
              workEmail: payload.workEmail,
              timeZone: payload.timeZone,
              employmentStart: payload.employmentStart,
              name: null,
            },
            context(event),
          );
        });
        return wrote ? 'applied' : 'unchanged';
      }

      case AccountProfileCaptured.name: {
        const event = parse(AccountProfileCaptured, raw);
        if (!event) return 'rejected';
        const found = await deps.inTenant(event.tenantId, ({ tx }) =>
          captureProfile(tx, event.tenantId, event.payload.accountId, event.payload),
        );
        return found ? 'applied' : 'unchanged';
      }

      case SchemaPublished.name: {
        const event = parse(SchemaPublished, raw);
        if (!event) return 'rejected';
        const result = await deps.inTenant(event.tenantId, async ({ tx }) => {
          await rememberTenant(tx, event.tenantId);
          return deps.recompute(tx, {
            tenantId: event.tenantId,
            schemaVersion: event.payload.schemaVersion,
            ...context(event),
          });
        });
        if (!result.ok) {
          logger.error(
            { eventId: event.eventId, code: result.error.code },
            'completeness recompute refused',
          );
          return 'rejected';
        }
        return 'applied';
      }

      /*
       * A company the back office created: its default zone, a first legal
       * entity in its country and zone, and its slug and name (PEO-099). Once:
       * a tenant that already has an entity keeps what its admin made.
       */
      case TenantProvisioned.name: {
        const event = parse(TenantProvisioned, raw);
        if (!event || !deps.org) return event ? 'ignored' : 'rejected';
        const { org } = deps;
        const { payload } = event;
        const adopted = await deps.inTenant(event.tenantId, async ({ tx }) => {
          await rememberTenant(tx, event.tenantId);
          await org.rememberCompany(tx, event.tenantId, {
            slug: payload.slug,
            displayName: payload.displayName,
            asOf: event.occurredAt,
          });
          return org.adoptTenant(
            tx,
            { tenantId: event.tenantId, ...context(event) },
            { name: payload.displayName, country: payload.country, timeZone: payload.timeZone },
          );
        });
        if (!adopted.ok) {
          // A country with no address rules yet, or a zone this runtime does
          // not know: the slug and name are kept, the admin makes the entity.
          logger.warn({ eventId: event.eventId, code: adopted.error.code }, 'tenant not adopted');
          return 'rejected';
        }
        return adopted.value.created ? 'applied' : 'unchanged';
      }

      case TenantAmended.name: {
        const event = parse(TenantAmended, raw);
        if (!event || !deps.org) return event ? 'ignored' : 'rejected';
        const { org } = deps;
        const kept = await deps.inTenant(event.tenantId, ({ tx }) =>
          org.rememberCompany(tx, event.tenantId, {
            slug: event.payload.slug,
            displayName: event.payload.displayName,
            asOf: event.occurredAt,
          }),
        );
        return kept ? 'applied' : 'unchanged';
      }

      /*
       * The modules the company bought (PEO-114): kept, newest wins, and read
       * by every transport's caller check in place of whatever list the
       * caller forwards.
       */
      case TenantEntitlementsChanged.name: {
        const event = parse(TenantEntitlementsChanged, raw);
        if (!event) return 'rejected';
        const kept = await deps.inTenant(event.tenantId, async ({ tx }) => {
          await rememberTenant(tx, event.tenantId);
          return rememberEntitlements(
            tx,
            event.tenantId,
            event.payload.entitlements,
            event.occurredAt,
          );
        });
        return kept ? 'applied' : 'unchanged';
      }

      default: {
        const relational = RELATIONAL.find((d) => d.name === name);
        if (relational === undefined || deps.authz === undefined) return 'ignored';
        const parsed = relational.schema.safeParse(raw);
        if (!parsed.success) {
          logger.warn({ eventName: relational.name }, 'event did not match its contract; skipped');
          return 'rejected';
        }
        const event = parsed.data as EventEnvelope & { payload: { personId: string } };
        const authz = deps.authz;
        const synced = await deps.inTenant(event.tenantId, ({ tx }) =>
          authz.sync(tx, event.tenantId, event.payload.personId),
        );
        return synced;
      }
    }
  };
}

function parse<P extends z.ZodType>(
  definition: EventDefinition<string, P>,
  raw: unknown,
): (EventEnvelope & { payload: z.infer<P> }) | null {
  const parsed = definition.schema.safeParse(raw);
  // `schema` is the envelope extended with this payload, which is the type
  // named here; `defineEvent` erases it to `ZodType` on the way out.
  if (parsed.success) return parsed.data as EventEnvelope & { payload: z.infer<P> };
  // The issues name paths, never values: a payload carrying a work email
  // must not reach the log because it was malformed.
  logger.warn(
    { eventName: definition.name, paths: parsed.error.issues.map((i) => i.path.join('.')) },
    'event did not match its contract; skipped',
  );
  return null;
}

function context(event: { eventId: string; correlationId: string }) {
  return {
    actor: { kind: 'system', process: PROCESS } as const,
    correlationId: event.correlationId,
    causationId: event.eventId,
  };
}
