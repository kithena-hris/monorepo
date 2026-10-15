import type * as z from 'zod';
import {
  PersonHired,
  PersonIdentityLinked,
  PersonManagerChanged,
  PersonOrgChanged,
  PersonProfileUpdated,
  PersonStatusChanged,
  PersonTerminated,
  TenantAdministratorNamed,
  TenantAdministratorRemoved,
  TenantEntitlementsChanged,
  type CalendarDate,
  type EventDefinition,
  type EventEnvelope,
  type PersonId,
} from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import type { Member, Tx, UnitOfWork } from '../../application/ports.js';

/**
 * People's and identity's events, into Recruiting's member projection and its
 * administrators (PRD §5.2, REC-044). Documents' consumer: idempotent by event id,
 * ordered by `effectiveFrom`, one transaction per event, somebody unknown
 * ignored, a malformed message logged by path and skipped.
 */

export type Outcome = 'applied' | 'unchanged' | 'ignored' | 'rejected';

const teamKeyOf = (orgUnitId: string) => `u_${orgUnitId.replaceAll('-', '')}`;
const locationKeyOf = (locationId: string) => `l_${locationId.replaceAll('-', '')}`;

const statusOf = (s: string): string | null => {
  if (['pending', 'pre_hire', 'active', 'notice'].includes(s)) return 'active';
  if (s === 'on_leave') return 'on_leave';
  return s === 'terminated' ? 'terminated' : null;
};

function parse<P extends z.ZodType>(
  definition: EventDefinition<string, P>,
  raw: unknown,
): (EventEnvelope & { payload: z.infer<P> }) | null {
  const parsed = definition.schema.safeParse(raw);
  if (parsed.success) return parsed.data as EventEnvelope & { payload: z.infer<P> };
  logger.warn(
    { eventName: definition.name, paths: parsed.error.issues.map((i) => i.path.join('.')) },
    'event did not match its contract; skipped',
  );
  return null;
}

const dateOf = (event: EventEnvelope): CalendarDate =>
  event.effectiveFrom ?? (event.occurredAt.slice(0, 10) as CalendarDate);

export function recruitingConsumer(uow: UnitOfWork): (raw: unknown) => Promise<Outcome> {
  const change = (
    event: EventEnvelope,
    personId: PersonId,
    merge: (m: Member) => Member,
  ): Promise<Outcome> =>
    uow.run(event.tenantId, async (tx: Tx) => {
      const existing = await tx.members.get(personId);
      if (existing === null) return 'ignored';
      const wrote = await tx.members.upsert(merge(existing), event.eventId, dateOf(event));
      return wrote ? 'applied' : 'unchanged';
    });

  return async (raw) => {
    const name: unknown =
      typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'eventName') : undefined;
    switch (name) {
      case PersonHired.name: {
        const event = parse(PersonHired, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        return uow.run(event.tenantId, async (tx) => {
          const existing = await tx.members.get(p.personId);
          const teamKey = p.orgUnitId === null ? null : teamKeyOf(p.orgUnitId);
          const wrote = await tx.members.upsert(
            {
              personId: p.personId,
              accountId: p.identityAccountId ?? existing?.accountId ?? null,
              displayName: `${p.name.preferred ?? p.name.given} ${p.name.family}`,
              workEmail: p.workEmail,
              managerPersonId: p.managerId,
              teamKey,
              teamName: existing?.teamKey === teamKey ? existing.teamName : null,
              locationKey: existing?.locationKey ?? null,
              legalEntityId: existing?.legalEntityId ?? null,
              status: statusOf(p.status) ?? 'active',
            },
            event.eventId,
            dateOf(event),
          );
          return wrote ? 'applied' : 'unchanged';
        });
      }
      case PersonIdentityLinked.name: {
        const event = parse(PersonIdentityLinked, raw);
        if (!event) return 'rejected';
        return change(event, event.payload.personId, (m) => ({
          ...m,
          accountId: event.payload.identityAccountId,
        }));
      }
      case PersonManagerChanged.name: {
        const event = parse(PersonManagerChanged, raw);
        if (!event) return 'rejected';
        return change(event, event.payload.personId, (m) => ({
          ...m,
          managerPersonId: event.payload.managerId,
        }));
      }
      case PersonOrgChanged.name: {
        const event = parse(PersonOrgChanged, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        return change(event, p.personId, (m) => {
          const teamKey = p.orgUnitId === null ? null : teamKeyOf(p.orgUnitId);
          return {
            ...m,
            teamKey,
            teamName: m.teamKey === teamKey ? m.teamName : null,
            locationKey: p.locationId === null ? null : locationKeyOf(p.locationId),
          };
        });
      }
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
        const workEmail = value('work_email');
        if ((given === null || family === null) && workEmail === null) {
          return 'ignored';
        }
        return change(event, event.payload.personId, (m) => ({
          ...m,
          ...(given === null || family === null
            ? {}
            : { displayName: `${preferred ?? given} ${family}` }),
          ...(workEmail === null ? {} : { workEmail }),
        }));
      }
      case PersonStatusChanged.name: {
        const event = parse(PersonStatusChanged, raw);
        if (!event) return 'rejected';
        const status = statusOf(event.payload.next);
        if (status === null) return 'ignored';
        return change(event, event.payload.personId, (m) => ({ ...m, status }));
      }
      case PersonTerminated.name: {
        const event = parse(PersonTerminated, raw);
        if (!event) return 'rejected';
        return change(event, event.payload.personId, (m) => ({
          ...m,
          status: 'terminated',
        }));
      }
      case TenantAdministratorNamed.name:
      case TenantAdministratorRemoved.name: {
        const named = name === TenantAdministratorNamed.name;
        const event = named
          ? parse(TenantAdministratorNamed, raw)
          : parse(TenantAdministratorRemoved, raw);
        if (!event) return 'rejected';
        if (event.payload.entitlement !== 'module.recruiting') return 'ignored';
        await uow.run(event.tenantId, (tx) =>
          named
            ? tx.admins.add(event.payload.accountId)
            : tx.admins.remove(event.payload.accountId),
        );
        return 'applied';
      }
      case TenantEntitlementsChanged.name: {
        const event = parse(TenantEntitlementsChanged, raw);
        if (!event) return 'rejected';
        return uow.run(event.tenantId, async (tx) => {
          const kept = (await tx.settings.get('entitlements')) as { asOf: string } | null;
          if (kept !== null && Date.parse(kept.asOf) >= Date.parse(event.occurredAt)) {
            return 'unchanged';
          }
          await tx.settings.set('entitlements', {
            entitlements: [...event.payload.entitlements],
            asOf: event.occurredAt,
          });
          return 'applied';
        });
      }
      default:
        return 'ignored';
    }
  };
}
