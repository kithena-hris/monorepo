import type * as z from 'zod';
import {
  EnvelopeCompleted,
  EnvelopeSigned,
  LaunchCountry,
  LegalEntityCreated,
  LegalEntityUpdated,
  LocationCreated,
  LocationUpdated,
  LocationZoneChanged,
  OrgUnitCreated,
  OrgUnitUpdated,
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
  TenantAmended,
  TenantEntitlementsChanged,
  TenantProvisioned,
  type CalendarDate,
  type EventDefinition,
  type EventEnvelope,
  type PersonId,
} from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import { contextOf, deliver, type Outgoing } from '../../application/context.js';
import { candidateSignedContract, contractSignedByEnvelope } from '../../application/offers.js';
import type { Deps, Member, Tx, UnitOfWork } from '../../application/ports.js';
import { statutoryBenefits } from '../../domain/benefits/benefits.js';

/** The currency a launch country's entity pays in, until Recruiting is told otherwise. */
const CURRENCY_OF: Readonly<Record<LaunchCountry, string>> = {
  DE: 'EUR',
  ES: 'EUR',
  GB: 'GBP',
  IN: 'INR',
  US: 'USD',
};

/**
 * People's and identity's events, into Recruiting's member projection and its
 * administrators (PRD §5.2, REC-044), and Documents' `envelope.completed`,
 * which signs a contract and hires (PRD §21.2, REC-140). Documents' consumer:
 * idempotent by event id, ordered by `effectiveFrom`, one transaction per
 * event, somebody unknown ignored, a malformed message logged by path and
 * skipped.
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

export function recruitingConsumer(
  uow: UnitOfWork,
  /** The use cases' dependencies, for the one event that runs one (a signed contract). Absent, that event is ignored. */
  deps: Deps | null = null,
): (raw: unknown) => Promise<Outcome> {
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
      // Everything People holds of a person: one hired before Recruiting listened.
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
              legalEntityId: p.legalEntityId ?? existing?.legalEntityId ?? null,
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
      /*
       * People's organisation (PRD §5.2): its legal entities, locations and
       * org units become Recruiting's, marked as People's so its settings show
       * them and refuse to rename or remove them. An entity is only one
       * Recruiting can hire in (a launch country); Recruiting adds the currency
       * from the country's pack and what only it knows stays editable here.
       */
      case LegalEntityCreated.name: {
        const event = parse(LegalEntityCreated, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        const country = LaunchCountry.safeParse(p.country);
        if (!country.success) return 'ignored';
        return uow.run(event.tenantId, async (tx) => {
          const held = await tx.entities.get(p.legalEntityId);
          if (held?.name === p.name && held.source === 'people') return 'unchanged';
          await tx.entities.save({
            id: p.legalEntityId,
            name: p.name,
            country: country.data,
            currency: held?.currency ?? CURRENCY_OF[country.data],
            fullTimeWeeklyMinutes: held?.fullTimeWeeklyMinutes ?? 2400,
            headcount: held?.headcount ?? 0,
            foundedOn: held?.foundedOn ?? null,
            worksCouncil: held?.worksCouncil ?? false,
            worksCouncilIds: held?.worksCouncilIds ?? [],
            source: 'people',
          });
          for (const benefit of statutoryBenefits(country.data, null, p.legalEntityId))
            if ((await tx.benefits.get(benefit.id)) === null) await tx.benefits.save(benefit);
          return 'applied';
        });
      }
      case LegalEntityUpdated.name: {
        const event = parse(LegalEntityUpdated, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        return uow.run(event.tenantId, async (tx) => {
          const held = await tx.entities.get(p.legalEntityId);
          if (held === null) return 'ignored';
          if (p.archived) {
            for (const l of await tx.locations.list())
              if (l.entityId === p.legalEntityId) await tx.locations.remove(l.id);
            for (const b of await tx.benefits.list())
              if (b.legalEntityId === p.legalEntityId) await tx.benefits.remove(b.id);
            await tx.entities.remove(p.legalEntityId);
            return 'applied';
          }
          if (held.name === p.name) return 'unchanged';
          await tx.entities.save({ ...held, name: p.name, source: 'people' });
          return 'applied';
        });
      }
      case LocationCreated.name: {
        const event = parse(LocationCreated, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        const country = LaunchCountry.safeParse(p.country);
        if (!country.success) return 'ignored';
        return uow.run(event.tenantId, async (tx) => {
          const held = await tx.locations.get(p.locationId);
          if (held?.name === p.name && held.timeZone === p.timeZone && held.source === 'people')
            return 'unchanged';
          const entity = await tx.entities.get(p.legalEntityId);
          await tx.locations.save({
            id: p.locationId,
            name: p.name,
            entityId: entity === null ? null : entity.id,
            country: country.data,
            region: held?.region ?? null,
            city: held?.city ?? null,
            timeZone: p.timeZone,
            source: 'people',
          });
          return 'applied';
        });
      }
      case LocationUpdated.name: {
        const event = parse(LocationUpdated, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        return uow.run(event.tenantId, async (tx) => {
          const held = await tx.locations.get(p.locationId);
          if (held === null) return 'ignored';
          if (p.archived) {
            await tx.locations.remove(p.locationId);
            return 'applied';
          }
          if (held.name === p.name) return 'unchanged';
          await tx.locations.save({ ...held, name: p.name, source: 'people' });
          return 'applied';
        });
      }
      case LocationZoneChanged.name: {
        const event = parse(LocationZoneChanged, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        return uow.run(event.tenantId, async (tx) => {
          const held = await tx.locations.get(p.locationId);
          if (held === null) return 'ignored';
          if (held.timeZone === p.timeZone) return 'unchanged';
          await tx.locations.save({ ...held, timeZone: p.timeZone, source: 'people' });
          return 'applied';
        });
      }
      case OrgUnitCreated.name:
      case OrgUnitUpdated.name: {
        const event =
          name === OrgUnitCreated.name ? parse(OrgUnitCreated, raw) : parse(OrgUnitUpdated, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        const archived = 'archived' in p && p.archived;
        return uow.run(event.tenantId, async (tx) => {
          const held = await tx.orgUnits.get(p.orgUnitId);
          if (archived) {
            if (held === null) return 'ignored';
            await tx.orgUnits.remove(p.orgUnitId);
            return 'applied';
          }
          if (held?.name === p.name && held.parentId === p.parentId && held.source === 'people')
            return 'unchanged';
          await tx.orgUnits.save({
            id: p.orgUnitId,
            name: p.name,
            parentId: p.parentId,
            source: 'people',
          });
          return 'applied';
        });
      }
      /*
       * The label the company's app is served on, for the links Recruiting's
       * emails carry (`hostSlug`). The newest wins, as entitlements do.
       */
      case TenantProvisioned.name:
      case TenantAmended.name: {
        const event =
          name === TenantProvisioned.name
            ? parse(TenantProvisioned, raw)
            : parse(TenantAmended, raw);
        if (!event) return 'rejected';
        return uow.run(event.tenantId, async (tx) => {
          const kept = (await tx.settings.get('host')) as { asOf: string } | null;
          if (kept !== null && Date.parse(kept.asOf) >= Date.parse(event.occurredAt)) {
            return 'unchanged';
          }
          await tx.settings.set('host', { slug: event.payload.slug, asOf: event.occurredAt });
          return 'applied';
        });
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
      /*
       * A signed envelope. Only one sent for a contract carries a subject
       * reference of Recruiting's; the contract is signed, the application
       * hired and `recruiting.candidate.hired` published, as the system
       * (PRD §21.2, §21.3). A reference Recruiting does not hold, or a
       * contract already signed, changes nothing.
       */
      case EnvelopeCompleted.name: {
        const event = parse(EnvelopeCompleted, raw);
        if (!event) return 'rejected';
        const ref = event.payload.subjectRef;
        if (deps === null || ref === null || !ref.startsWith('recruiting:offer:')) return 'ignored';
        // The emails a hire sends go once the transaction has committed, as a request's do.
        const mail: Outgoing[] = [];
        const outcome = await uow.run(event.tenantId, async (tx) => {
          const ctx = await contextOf(
            deps,
            tx,
            {
              tenantId: event.tenantId,
              accountId: 'system',
              personId: null,
              correlationId: event.correlationId,
            },
            mail,
          );
          const signed = await contractSignedByEnvelope(
            ctx,
            ref,
            dateOf(event),
            event.payload.signatures,
          );
          if (signed.ok) return 'applied';
          if (signed.error.code === 'CONTRACT_STATE') return 'unchanged';
          logger.warn(
            { eventId: event.eventId, code: signed.error.code },
            'signed contract not applied',
          );
          return 'rejected';
        });
        if (outcome === 'applied') await deliver(deps, event.tenantId, mail);
        return outcome;
      }
      /*
       * The candidate signed a contract Recruiting sent: whoever signs next
       * for the company is told it is their turn (`candidateSignedContract`).
       */
      case EnvelopeSigned.name: {
        const event = parse(EnvelopeSigned, raw);
        if (!event) return 'rejected';
        const ref = event.payload.subjectRef;
        if (deps === null || ref === null || !ref.startsWith('recruiting:offer:')) return 'ignored';
        if (event.payload.personId !== null || event.payload.turn.length === 0) return 'ignored';
        const mail: Outgoing[] = [];
        await uow.run(event.tenantId, async (tx) => {
          const ctx = await contextOf(
            deps,
            tx,
            {
              tenantId: event.tenantId,
              accountId: 'system',
              personId: null,
              correlationId: event.correlationId,
            },
            mail,
          );
          await candidateSignedContract(ctx, ref, event.payload.envelopeId, event.payload.turn);
        });
        await deliver(deps, event.tenantId, mail);
        return 'applied';
      }
      default:
        return 'ignored';
    }
  };
}
