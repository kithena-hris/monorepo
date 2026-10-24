import type * as z from 'zod';
import {
  PersonHired,
  PersonIdentityLinked,
  PersonManagerChanged,
  PersonSnapshot,
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

import { SEEDED_TYPES } from '../../domain/type/document-type.js';

import type { Member, Tx, UnitOfWork } from '../../application/ports.js';

/**
 * People's and identity's events, into Documents' member projection and its
 * HR (PRD §5.2). Time Off's consumer, smaller: idempotent by event id,
 * ordered by `effectiveFrom`, one transaction per event, somebody unknown
 * ignored, a malformed message logged by path and skipped.
 */

export type Outcome = 'applied' | 'unchanged' | 'ignored' | 'rejected';

const teamKeyOf = (orgUnitId: string) => `u_${orgUnitId.replaceAll('-', '')}`;
const locationKeyOf = (locationId: string) => `l_${locationId.replaceAll('-', '')}`;

const statusOf = (s: string): string | null => {
  if (['pending', 'pre_hire', 'onboarding', 'active', 'notice'].includes(s)) return 'active';
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

export function documentsConsumer(uow: UnitOfWork): (raw: unknown) => Promise<Outcome> {
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
              hireDate: p.employment.from,
              terminationDate: p.employment.to,
              status: statusOf(p.status) ?? 'active',
            },
            event.eventId,
            dateOf(event),
          );
          return wrote ? 'applied' : 'unchanged';
        });
      }
      // Everything People holds of a person: one hired before Documents listened.
      case PersonSnapshot.name: {
        const event = parse(PersonSnapshot, raw);
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
              hireDate: p.hireDate ?? existing?.hireDate ?? null,
              terminationDate: p.lastWorkingDay,
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
        const hireDate = value('hire_date');
        const workEmail = value('work_email');
        if ((given === null || family === null) && hireDate === null && workEmail === null) {
          return 'ignored';
        }
        return change(event, event.payload.personId, (m) => ({
          ...m,
          ...(given === null || family === null
            ? {}
            : { displayName: `${preferred ?? given} ${family}` }),
          ...(hireDate === null ? {} : { hireDate: hireDate as CalendarDate }),
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
          terminationDate: event.payload.lastWorkingDay,
        }));
      }
      case TenantAdministratorNamed.name:
      case TenantAdministratorRemoved.name: {
        const named = name === TenantAdministratorNamed.name;
        const event = named
          ? parse(TenantAdministratorNamed, raw)
          : parse(TenantAdministratorRemoved, raw);
        if (!event) return 'rejected';
        if (event.payload.entitlement !== 'module.documents') return 'ignored';
        await uow.run(event.tenantId, (tx) =>
          named ? tx.hr.add(event.payload.accountId) : tx.hr.remove(event.payload.accountId),
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
          // A company with Documents starts with its starter types, and gains any added since.
          if (event.payload.entitlements.includes('module.documents')) {
            const have = new Set((await tx.types.list()).map((t) => t.key as string));
            for (const type of SEEDED_TYPES)
              if (!have.has(type.key)) await tx.types.save(type, false);
          }
          return 'applied';
        });
      }
      default:
        return 'ignored';
    }
  };
}
