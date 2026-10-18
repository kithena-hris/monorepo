import type * as z from 'zod';
import {
  OrgUnitCreated,
  OrgUnitUpdated,
  PersonHired,
  PersonIdentityLinked,
  PersonJobChanged,
  PersonManagerChanged,
  PersonOrgChanged,
  PersonSnapshot,
  PersonTerminated,
  PlanStarted,
  ProbationReviewed,
  TenantAdministratorNamed,
  TenantAdministratorRemoved,
  TenantEntitlementsChanged,
  type EventDefinition,
  type EventEnvelope,
  type CalendarDate,
  type PersonId,
} from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import { isSubmitted } from '../../domain/review.js';
import { deliver } from '../../application/context.js';
import { leaverManagerReviews, onReportingLineMoved } from '../../application/manager-change.js';
import type { Deps, Member, Tx } from '../../application/ports.js';

/**
 * What Performance learns (PRD §5.2, PRF-037): People's members, their
 * managers, titles and departments; Onboarding's start and probation dates;
 * identity's administrators and entitlements. Idempotent, one transaction per
 * event, a malformed message logged and skipped. Onboarding's consumer's
 * shape.
 *
 * A manager change moves the reporting line, and its manager reviews follow
 * where HR chose that for this change, or where the old manager has left
 * (§8.8, `manager-change.ts`). A leaver's unsubmitted reviews are cancelled,
 * and a report already moved to someone else gets a review from them.
 */

export type Outcome = 'applied' | 'unchanged' | 'ignored' | 'rejected';

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

const blank = (personId: PersonId): Member => ({
  personId,
  accountId: null,
  displayName: 'Someone',
  workEmail: null,
  managerPersonId: null,
  status: 'active',
  title: null,
  orgUnitId: null,
  locationId: null,
  legalEntityId: null,
  hiredOn: null,
  probationEnd: null,
});

async function patch(
  tx: Tx,
  personId: PersonId,
  eventId: string,
  change: (m: Member) => Member,
): Promise<Outcome> {
  const m = (await tx.members.get(personId)) ?? blank(personId);
  return (await tx.members.upsert(change(m), eventId)) ? 'applied' : 'unchanged';
}

export function performanceConsumer(deps: Deps): (raw: unknown) => Promise<Outcome> {
  return async (raw) => {
    const name: unknown =
      typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'eventName') : undefined;
    switch (name) {
      case PersonHired.name: {
        const e = parse(PersonHired, raw);
        if (!e) return 'rejected';
        const p = e.payload;
        return deps.uow.run(e.tenantId, (tx) =>
          patch(tx, p.personId, e.eventId, (m) => ({
            ...m,
            accountId: p.identityAccountId ?? m.accountId,
            displayName: `${p.name.preferred ?? p.name.given} ${p.name.family}`.trim(),
            workEmail: p.workEmail,
            managerPersonId: p.managerId,
            status: p.status === 'terminated' ? 'terminated' : 'active',
            orgUnitId: p.orgUnitId,
            legalEntityId: p.legalEntityId,
            hiredOn: p.employment.from,
          })),
        );
      }
      // Everything People holds of a person, for one hired before Performance listened.
      case PersonSnapshot.name: {
        const e = parse(PersonSnapshot, raw);
        if (!e) return 'rejected';
        const p = e.payload;
        return deps.uow.run(e.tenantId, (tx) =>
          patch(tx, p.personId, e.eventId, (m) => ({
            ...m,
            accountId: p.identityAccountId ?? m.accountId,
            displayName: `${p.name.preferred ?? p.name.given} ${p.name.family}`.trim(),
            workEmail: p.workEmail,
            managerPersonId: p.managerId,
            status: p.status === 'terminated' ? 'terminated' : 'active',
            title: p.title ?? m.title,
            orgUnitId: p.orgUnitId,
            locationId: p.locationId,
            legalEntityId: p.legalEntityId,
            hiredOn: p.hireDate ?? m.hiredOn,
            leftOn: p.lastWorkingDay ?? m.leftOn ?? null,
          })),
        );
      }
      case PersonIdentityLinked.name: {
        const e = parse(PersonIdentityLinked, raw);
        if (!e) return 'rejected';
        return deps.uow.run(e.tenantId, (tx) =>
          patch(tx, e.payload.personId, e.eventId, (m) => ({
            ...m,
            accountId: e.payload.identityAccountId,
          })),
        );
      }
      case PersonJobChanged.name: {
        const e = parse(PersonJobChanged, raw);
        if (!e) return 'rejected';
        return deps.uow.run(e.tenantId, (tx) =>
          patch(tx, e.payload.personId, e.eventId, (m) => ({ ...m, title: e.payload.title })),
        );
      }
      case PersonOrgChanged.name: {
        const e = parse(PersonOrgChanged, raw);
        if (!e) return 'rejected';
        return deps.uow.run(e.tenantId, (tx) =>
          patch(tx, e.payload.personId, e.eventId, (m) => ({
            ...m,
            orgUnitId: e.payload.orgUnitId,
            legalEntityId: e.payload.legalEntityId,
            locationId: e.payload.locationId,
          })),
        );
      }
      case PersonManagerChanged.name: {
        const e = parse(PersonManagerChanged, raw);
        if (!e) return 'rejected';
        const { personId, managerId, previousManagerId } = e.payload;
        const at = deps.clock.now().toISOString();
        const [done, mail] = await deps.uow.run(e.tenantId, async (tx) => {
          const moved = await patch(tx, personId, e.eventId, (m) => ({
            ...m,
            managerPersonId: managerId,
          }));
          // Once only: a replayed event changes nothing a second time.
          if (moved !== 'applied') return [moved, []] as const;
          return [
            moved,
            await onReportingLineMoved(tx, deps.newId, {
              personId,
              previousManagerId,
              managerId,
              at,
              today: deps.clock.today('UTC') as CalendarDate,
            }),
          ] as const;
        });
        await deliver(deps, e.tenantId, mail);
        return done;
      }
      case PersonTerminated.name: {
        const e = parse(PersonTerminated, raw);
        if (!e) return 'rejected';
        const leaverId = e.payload.personId;
        const [done, mail] = await deps.uow.run(e.tenantId, async (tx) => {
          const left = await patch(tx, leaverId, e.eventId, (m) => ({
            ...m,
            status: 'terminated',
            leftOn: e.payload.lastWorkingDay,
          }));
          const cancelled = [];
          for (const r of await tx.reviews.find({ ownerId: leaverId }))
            if (!isSubmitted(r) && ['not_started', 'in_progress'].includes(r.status)) {
              await tx.reviews.save({ ...r, status: 'cancelled' });
              if (r.kind === 'manager') cancelled.push(r);
            }
          // Their reports already moved to someone else: that manager writes it now.
          return [
            left,
            left === 'applied'
              ? await leaverManagerReviews(tx, deps.newId, {
                  leaverId,
                  cancelled,
                  at: deps.clock.now().toISOString(),
                  today: deps.clock.today('UTC') as CalendarDate,
                })
              : [],
          ] as const;
        });
        await deliver(deps, e.tenantId, mail);
        return done;
      }
      case OrgUnitCreated.name:
      case OrgUnitUpdated.name: {
        const e =
          name === OrgUnitCreated.name ? parse(OrgUnitCreated, raw) : parse(OrgUnitUpdated, raw);
        if (!e) return 'rejected';
        await deps.uow.run(e.tenantId, (tx) =>
          tx.orgUnits.save({
            id: e.payload.orgUnitId,
            name: e.payload.name,
            parentId: e.payload.parentId,
          }),
        );
        return 'applied';
      }
      case PlanStarted.name: {
        const e = parse(PlanStarted, raw);
        if (!e) return 'rejected';
        const personId = e.payload.personId;
        if (personId === null) return 'ignored';
        return deps.uow.run(e.tenantId, (tx) =>
          patch(tx, personId as PersonId, e.eventId, (m) => ({
            ...m,
            hiredOn: m.hiredOn ?? e.payload.startDate,
            probationEnd: e.payload.probationEnd ?? m.probationEnd,
          })),
        );
      }
      case ProbationReviewed.name: {
        const e = parse(ProbationReviewed, raw);
        if (!e) return 'rejected';
        const personId = e.payload.personId;
        if (personId === null) return 'ignored';
        return deps.uow.run(e.tenantId, (tx) =>
          patch(tx, personId as PersonId, e.eventId, (m) => ({
            ...m,
            probationEnd: e.payload.probationEnd ?? m.probationEnd,
          })),
        );
      }
      case TenantAdministratorNamed.name:
      case TenantAdministratorRemoved.name: {
        const named = name === TenantAdministratorNamed.name;
        const e = named
          ? parse(TenantAdministratorNamed, raw)
          : parse(TenantAdministratorRemoved, raw);
        if (!e) return 'rejected';
        if (e.payload.entitlement !== 'module.performance') return 'ignored';
        await deps.uow.run(e.tenantId, (tx) =>
          named ? tx.admins.add(e.payload.accountId) : tx.admins.remove(e.payload.accountId),
        );
        return 'applied';
      }
      case TenantEntitlementsChanged.name: {
        const e = parse(TenantEntitlementsChanged, raw);
        if (!e) return 'rejected';
        return deps.uow.run(e.tenantId, async (tx) => {
          const kept = (await tx.settings.get('entitlements')) as { asOf: string } | null;
          if (kept !== null && Date.parse(kept.asOf) >= Date.parse(e.occurredAt))
            return 'unchanged';
          await tx.settings.set('entitlements', {
            entitlements: [...e.payload.entitlements],
            asOf: e.occurredAt,
          });
          return 'applied';
        });
      }
      default:
        return 'ignored';
    }
  };
}
