import type * as z from 'zod';
import { ok, type Result } from '@kithena/domain-kit';
import {
  LocationCreated,
  LocationKey,
  LocationUpdated,
  LocationZoneChanged,
  PersonHired,
  PersonManagerChanged,
  PersonOrgChanged,
  PersonProfileUpdated,
  PersonStatusChanged,
  PersonSyncedFromExternal,
  PersonTerminated,
  TeamKey,
  type CalendarDate,
  type EventDefinition,
  type EventEnvelope,
  type PersonId,
  type TenantId,
} from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import { endMember, upsertIn, type Applied } from '../../application/member/sync.js';
import { MemberFields, type Deps, type Member, type Tx } from '../../application/ports.js';
import { transact } from '../../application/shared.js';

/**
 * People's events, translated into Time Off's two member commands (PRD §5.2,
 * TOF-045). Nothing past this file reads a People payload.
 *
 * Transport-free, as People's `handle.ts` is: the Kafka loop in `wire.ts`
 * hands each message here, and the tests hand envelopes in directly.
 *
 * - **Idempotent by event id, ordered by `effectiveFrom`.** Each person event
 *   becomes `upsertMember` with the event's id and date, which ignores one it
 *   applied already or one older than the last applied, and the member's row
 *   never moves backwards (`drizzle-members.ts`).
 * - **One transaction**: the member is read, merged and written together, so
 *   a field the event does not carry is the one already stored.
 * - **An event about somebody Time Off does not know** is ignored. People's
 *   outbox keys a person's events to one partition, so `hired` arrives first.
 * - **Locations** are kept as People describes them, so a member's
 *   `org_changed`, which names a location by id, becomes their country and
 *   zone; a zone change reaches everybody already there. Those writes carry
 *   no event id onto the member, so they never hold back a person's own events.
 * - **A malformed message** is logged and skipped: Kafka would redeliver it
 *   forever. A database error throws, because that may succeed on retry.
 *
 * People's org units and locations are ids; Time Off's keys are
 * `u_<hex>` and `l_<hex>` of them. People raises no event naming an org unit,
 * so a team's name stays what an import gave it, or none.
 */

export type Outcome = 'applied' | 'unchanged' | 'ignored' | 'rejected';

type ConsumerDeps = Pick<Deps, 'uow' | 'clock' | 'newId' | 'notifier'>;

export const teamKeyOf = (orgUnitId: string): TeamKey =>
  TeamKey.parse(`u_${orgUnitId.replaceAll('-', '')}`);
export const locationKeyOf = (locationId: string): LocationKey =>
  LocationKey.parse(`l_${locationId.replaceAll('-', '')}`);

const fieldsOf = (m: Member): MemberFields => {
  const { lastEventId: _id, lastEffectiveFrom: _from, ...fields } = m;
  return fields;
};

/**
 * People's employment status or record state in the projection's three
 * words; `null` for a state that is no member at all (provisional, merged).
 * Somebody starting later or working their notice is a member now.
 */
const statusOf = (s: string): Member['status'] | null => {
  if (['pending', 'pre_hire', 'active', 'notice'].includes(s)) return 'active';
  if (s === 'on_leave') return 'on_leave';
  return s === 'terminated' ? 'left' : null;
};

function parse<P extends z.ZodType>(
  definition: EventDefinition<string, P>,
  raw: unknown,
): (EventEnvelope & { payload: z.infer<P> }) | null {
  const parsed = definition.schema.safeParse(raw);
  if (parsed.success) return parsed.data as EventEnvelope & { payload: z.infer<P> };
  // Paths, never values: a payload carrying a name must not reach the log.
  logger.warn(
    { eventName: definition.name, paths: parsed.error.issues.map((i) => i.path.join('.')) },
    'event did not match its contract; skipped',
  );
  return null;
}

const appliedBy = (event: EventEnvelope): Applied => ({
  eventId: event.eventId,
  effectiveFrom: event.effectiveFrom ?? (event.occurredAt.slice(0, 10) as CalendarDate),
  correlationId: event.correlationId,
});

const outcome = (r: Result<{ applied: boolean }>, event: EventEnvelope): Outcome => {
  if (r.ok) return r.value.applied ? 'applied' : 'unchanged';
  logger.warn({ eventId: event.eventId, code: r.error.code }, 'member change refused');
  return 'rejected';
};

export function timeoffConsumer(deps: ConsumerDeps): (raw: unknown) => Promise<Outcome> {
  /** Merge an event into a known member, or ignore it for somebody unknown. */
  const change = async (
    event: EventEnvelope,
    personId: PersonId,
    merge: (m: Member, tx: Tx) => Promise<MemberFields | null> | MemberFields | null,
  ): Promise<Outcome> => {
    const result = await transact<{ applied: boolean } | null>(deps, event.tenantId, async (tx) => {
      const existing = await tx.members.get(personId);
      if (existing === null) return ok(null);
      const fields = await merge(existing, tx);
      if (fields === null) return ok({ applied: false });
      return upsertIn(tx, deps, MemberFields.parse(fields), appliedBy(event));
    });
    if (result.ok && result.value === null) return 'ignored';
    return outcome(result as Result<{ applied: boolean }>, event);
  };

  /** Everyone at a location, after People changed it: no event id onto the member. */
  const atLocation = (
    tenantId: TenantId,
    location: {
      locationKey: LocationKey;
      name?: string;
      country?: string | null;
      timeZone?: string;
    },
    correlationId: string,
  ): Promise<Result<{ applied: boolean }>> =>
    transact(deps, tenantId, async (tx) => {
      const before = await tx.locations.get(location.locationKey);
      const next = {
        locationKey: location.locationKey,
        name: location.name ?? before?.name ?? location.locationKey,
        country: location.country ?? before?.country ?? null,
        timeZone: location.timeZone ?? before?.timeZone ?? 'UTC',
      };
      await tx.locations.save(next);
      for (const m of await tx.members.list()) {
        if (m.locationKey !== next.locationKey) continue;
        if (m.country === next.country && m.timeZone === next.timeZone) continue;
        // oxlint-disable-next-line no-await-in-loop -- one transaction, a location's members
        const done = await upsertIn(
          tx,
          deps,
          { ...fieldsOf(m), country: next.country, timeZone: next.timeZone },
          { eventId: null, effectiveFrom: null, correlationId },
        );
        if (!done.ok) return done;
      }
      return ok({ applied: true });
    });

  return async (raw) => {
    const name: unknown =
      typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'eventName') : undefined;

    switch (name) {
      /* Somebody joins, or a hire is restated: everything the event knows. */
      case PersonHired.name: {
        const event = parse(PersonHired, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        const status = statusOf(p.status) ?? 'active';
        const result = await transact(deps, event.tenantId, async (tx) => {
          const existing = await tx.members.get(p.personId);
          const teamKey = p.orgUnitId === null ? null : teamKeyOf(p.orgUnitId);
          const fields = MemberFields.parse({
            ...(existing === null ? {} : fieldsOf(existing)),
            personId: p.personId,
            displayName: `${p.name.preferred ?? p.name.given} ${p.name.family}`,
            firstName: p.name.preferred ?? p.name.given,
            managerPersonId: p.managerId,
            teamKey,
            teamName: existing !== null && existing.teamKey === teamKey ? existing.teamName : null,
            hireDate: p.employment.from,
            terminationDate: p.employment.to,
            status,
          });
          return upsertIn(tx, deps, fields, appliedBy(event));
        });
        return outcome(result, event);
      }

      case PersonManagerChanged.name: {
        const event = parse(PersonManagerChanged, raw);
        if (!event) return 'rejected';
        return change(event, event.payload.personId, (m) => ({
          ...fieldsOf(m),
          managerPersonId: event.payload.managerId,
        }));
      }

      case PersonOrgChanged.name: {
        const event = parse(PersonOrgChanged, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        return change(event, p.personId, async (m, tx) => {
          const teamKey = p.orgUnitId === null ? null : teamKeyOf(p.orgUnitId);
          const locationKey = p.locationId === null ? null : locationKeyOf(p.locationId);
          const place = locationKey === null ? null : await tx.locations.get(locationKey);
          return {
            ...fieldsOf(m),
            teamKey,
            teamName: m.teamKey === teamKey ? m.teamName : null,
            locationKey,
            country: place?.country ?? m.country,
            timeZone: place?.timeZone ?? m.timeZone,
          };
        });
      }

      /*
       * A profile edit carries a value only where the attribute opted in, and
       * the name's parts arrive one by one: the name is restated when given
       * and family name both came, the start date when it did.
       */
      case PersonProfileUpdated.name: {
        const event = parse(PersonProfileUpdated, raw);
        if (!event) return 'rejected';
        const value = (key: string): string | null => {
          const v = event.payload.changed.find((c) => c.key === key)?.value;
          return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
        };
        const given = value('given_name');
        const family = value('family_name');
        const preferred = value('preferred_name');
        const hireDate = value('hire_date');
        if ((given === null || family === null) && hireDate === null) return 'ignored';
        return change(event, event.payload.personId, (m) => ({
          ...fieldsOf(m),
          ...(given === null || family === null
            ? {}
            : { displayName: `${preferred ?? given} ${family}`, firstName: preferred ?? given }),
          ...(hireDate === null ? {} : { hireDate: hireDate as CalendarDate }),
        }));
      }

      case PersonStatusChanged.name: {
        const event = parse(PersonStatusChanged, raw);
        if (!event) return 'rejected';
        const status = statusOf(event.payload.next);
        if (status === null) return 'ignored';
        return change(event, event.payload.personId, (m) => ({ ...fieldsOf(m), status }));
      }

      /* A leaver: settled as the policy says (TOF-035's `endMember`). */
      case PersonTerminated.name: {
        const event = parse(PersonTerminated, raw);
        if (!event) return 'rejected';
        const result = await endMember(deps)(
          event.tenantId,
          event.payload.personId,
          event.payload.lastWorkingDay,
          appliedBy(event),
        );
        if (!result.ok && result.error.code === 'NOT_FOUND') return 'ignored';
        if (!result.ok) return outcome(result, event);
        return result.value.member.lastEventId === event.eventId ? 'applied' : 'unchanged';
      }

      /*
       * The source of record changed hands, or an upstream sync touched the
       * person. It names fields, never values; the values arrive on the
       * `manager_changed`, `org_changed` and `profile_updated` People raises
       * beside it, so there is nothing to apply from this one.
       */
      case PersonSyncedFromExternal.name: {
        return parse(PersonSyncedFromExternal, raw) ? 'ignored' : 'rejected';
      }

      case LocationCreated.name: {
        const event = parse(LocationCreated, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        const result = await atLocation(
          event.tenantId,
          {
            locationKey: locationKeyOf(p.locationId),
            name: p.name,
            country: p.country,
            timeZone: p.timeZone,
          },
          event.correlationId,
        );
        return outcome(result, event);
      }

      case LocationUpdated.name: {
        const event = parse(LocationUpdated, raw);
        if (!event) return 'rejected';
        const result = await atLocation(
          event.tenantId,
          { locationKey: locationKeyOf(event.payload.locationId), name: event.payload.name },
          event.correlationId,
        );
        return outcome(result, event);
      }

      case LocationZoneChanged.name: {
        const event = parse(LocationZoneChanged, raw);
        if (!event) return 'rejected';
        // ponytail: applied when it arrives, not from its `effectiveFrom`. A
        // zone change dated ahead moves "today" early; schedule it if one is.
        const result = await atLocation(
          event.tenantId,
          {
            locationKey: locationKeyOf(event.payload.locationId),
            timeZone: event.payload.timeZone,
          },
          event.correlationId,
        );
        return outcome(result, event);
      }

      default:
        return 'ignored';
    }
  };
}
