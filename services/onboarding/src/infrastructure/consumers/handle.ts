import type * as z from 'zod';
import {
  CandidateHired,
  PersonHired,
  PersonSnapshot,
  PersonIdentityLinked,
  PersonTerminated,
  PrehireCancelled,
  ReviewReleased,
  TenantAdministratorNamed,
  TenantAdministratorRemoved,
  TenantEntitlementsChanged,
  type EventDefinition,
  type EventEnvelope,
  type HireIntake,
} from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import { contextOf } from '../../application/context.js';
import { cancelForHire, intake } from '../../application/plans.js';
import type { Deps, Member } from '../../application/ports.js';
import { deliver, type Outgoing } from '../../application/context.js';

/**
 * Where hires come from (Recruiting PRD §O2, ONB-007): Recruiting's handover,
 * People's hire, and identity's administrators. Recruiting's consumer:
 * idempotent, one transaction per event, a malformed message logged and
 * skipped.
 *
 * People's `person.hired` is replayed from the beginning when Onboarding is
 * bought, so it starts a plan only for somebody starting recently or later;
 * everyone else becomes a member and nothing more.
 */

export type Outcome = 'applied' | 'unchanged' | 'ignored' | 'rejected';

/** How far back a People hire still gets a plan. */
const RECENT_DAYS = 30;

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

const SYSTEM = (event: EventEnvelope) => ({
  tenantId: event.tenantId,
  accountId: 'system',
  personId: null,
  correlationId: event.correlationId,
});

export function onboardingConsumer(deps: Deps): (raw: unknown) => Promise<Outcome> {
  /** A use case as the system, its mail sent once it commits. */
  const asSystem = async <T>(
    event: EventEnvelope,
    fn: (ctx: Awaited<ReturnType<typeof contextOf>>) => Promise<T>,
  ): Promise<T> => {
    const mail: Outgoing[] = [];
    const answer = await deps.uow.run(event.tenantId, async (tx) =>
      fn(await contextOf(deps, tx, SYSTEM(event), mail)),
    );
    await deliver(deps, event.tenantId, mail);
    return answer;
  };

  return async (raw) => {
    const name: unknown =
      typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'eventName') : undefined;
    switch (name) {
      case CandidateHired.name: {
        const event = parse(CandidateHired, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        const country = p.terms?.country ?? p.country;
        // No terms, and a job with no legal entity to give the country: nothing to plan from.
        if (country === null) return 'applied';
        const probation = p.terms?.probation ?? null;
        const hire: HireIntake = {
          externalId: p.applicationId,
          source: 'recruiting',
          givenName: p.candidate.givenName,
          familyName: p.candidate.familyName,
          email: p.candidate.email,
          personId: null,
          managerId: p.managerId,
          startDate: p.startDate,
          probationEnd: p.terms?.probationEnd ?? null,
          country,
          legalEntityId: p.legalEntityId,
          location: null,
          department: null,
          workMode: p.terms?.workMode ?? p.workMode ?? 'onsite',
          contractType: p.terms?.contractType ?? null,
          // ponytail: half the probation again, capped at the pack's 6 months; the pack's own rule when it publishes one.
          probationExtensionMonths:
            probation === null
              ? null
              : probation.unit === 'months'
                ? Math.min(6, Math.floor(probation.count / 2))
                : 0,
        };
        const done = await asSystem(event, (ctx) => intake(ctx, hire));
        return done.ok ? 'applied' : 'rejected';
      }
      case PrehireCancelled.name: {
        const event = parse(PrehireCancelled, raw);
        if (!event) return 'rejected';
        const done = await asSystem(event, (ctx) =>
          cancelForHire(ctx, 'recruiting', event.payload.applicationId),
        );
        return done.ok && done.value !== null ? 'applied' : 'ignored';
      }
      // Everything People holds of a person: a member, never a new onboarding plan.
      case PersonSnapshot.name: {
        const event = parse(PersonSnapshot, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        const member: Member = {
          personId: p.personId,
          accountId: p.identityAccountId,
          displayName: `${p.name.preferred ?? p.name.given} ${p.name.family}`,
          workEmail: p.workEmail,
          managerPersonId: p.managerId,
          status: p.status === 'terminated' ? 'terminated' : 'active',
        };
        await deps.uow.run(event.tenantId, (tx) => tx.members.upsert(member, event.eventId));
        return 'applied';
      }
      case PersonHired.name: {
        const event = parse(PersonHired, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        const member: Member = {
          personId: p.personId,
          accountId: p.identityAccountId,
          displayName: `${p.name.preferred ?? p.name.given} ${p.name.family}`,
          workEmail: p.workEmail,
          managerPersonId: p.managerId,
          status: p.status === 'terminated' ? 'terminated' : 'active',
        };
        await deps.uow.run(event.tenantId, (tx) => tx.members.upsert(member, event.eventId));
        const since = new Date(Date.parse(event.occurredAt) - RECENT_DAYS * 86_400_000)
          .toISOString()
          .slice(0, 10);
        if (p.employment.from < since || p.status === 'terminated') return 'applied';
        const hire = (country: HireIntake['country']): HireIntake => ({
          externalId: p.personId,
          source: 'people',
          givenName: p.name.preferred ?? p.name.given,
          familyName: p.name.family,
          email: p.workEmail,
          personId: p.personId,
          managerId: p.managerId,
          startDate: p.employment.from,
          probationEnd: null,
          country,
          legalEntityId: p.legalEntityId,
          location: null,
          department: null,
          workMode: 'onsite',
          contractType: null,
          probationExtensionMonths: null,
        });
        // People's event names no country: the company's own, from settings.
        const done = await asSystem(event, async (ctx) =>
          intake(
            ctx,
            hire(
              ((await ctx.tx.settings.get('defaultCountry')) as HireIntake['country'] | null) ??
                'DE',
            ),
          ),
        );
        return done.ok ? 'applied' : 'rejected';
      }
      case PersonIdentityLinked.name: {
        const event = parse(PersonIdentityLinked, raw);
        if (!event) return 'rejected';
        return deps.uow.run(event.tenantId, async (tx) => {
          const m = await tx.members.get(event.payload.personId);
          if (m === null) return 'ignored';
          return (await tx.members.upsert(
            { ...m, accountId: event.payload.identityAccountId },
            event.eventId,
          ))
            ? 'applied'
            : 'unchanged';
        });
      }
      case PersonTerminated.name: {
        const event = parse(PersonTerminated, raw);
        if (!event) return 'rejected';
        return deps.uow.run(event.tenantId, async (tx) => {
          const m = await tx.members.get(event.payload.personId);
          if (m === null) return 'ignored';
          return (await tx.members.upsert({ ...m, status: 'terminated' }, event.eventId))
            ? 'applied'
            : 'unchanged';
        });
      }
      // Performance wrote the probation review: the task links to it (Performance PRD §16.3).
      // The decision stays here, with the manager or HR.
      case ReviewReleased.name: {
        const event = parse(ReviewReleased, raw);
        if (!event) return 'rejected';
        const p = event.payload;
        return deps.uow.run(event.tenantId, async (tx) => {
          const plan = (await tx.plans.list()).find(
            (x) => x.personId === p.subjectId && x.state !== 'cancelled',
          );
          const task = plan?.tasks.find((t) => t.key === 'probation_review' && t.state === 'open');
          if (plan === undefined || task === undefined) return 'ignored';
          const link = `/performance/cycles/${p.cycleId}/about/${p.subjectId}`;
          if (task.link === link) return 'unchanged';
          await tx.plans.save({
            ...plan,
            tasks: plan.tasks.map((t) => (t.id === task.id ? { ...t, link } : t)),
          });
          return 'applied';
        });
      }
      case TenantAdministratorNamed.name:
      case TenantAdministratorRemoved.name: {
        const named = name === TenantAdministratorNamed.name;
        const event = named
          ? parse(TenantAdministratorNamed, raw)
          : parse(TenantAdministratorRemoved, raw);
        if (!event) return 'rejected';
        if (event.payload.entitlement !== 'module.onboarding') return 'ignored';
        await deps.uow.run(event.tenantId, (tx) =>
          named
            ? tx.admins.add(event.payload.accountId)
            : tx.admins.remove(event.payload.accountId),
        );
        return 'applied';
      }
      case TenantEntitlementsChanged.name: {
        const event = parse(TenantEntitlementsChanged, raw);
        if (!event) return 'rejected';
        return deps.uow.run(event.tenantId, async (tx) => {
          const kept = (await tx.settings.get('entitlements')) as { asOf: string } | null;
          if (kept !== null && Date.parse(kept.asOf) >= Date.parse(event.occurredAt))
            return 'unchanged';
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
