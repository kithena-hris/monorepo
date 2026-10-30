import { randomUUID } from 'node:crypto';
import {
  CandidateHired,
  PersonHired,
  PrehireCancelled,
  ReviewReleased,
  TenantId,
  type CalendarDate,
  type PersonId,
} from '@kithena/contracts';
import type { Clock } from '@kithena/domain-kit';
import { expect } from 'vitest';

import { contextOf, type Ctx } from '../application/context.js';
import { uuidv7 } from '../infrastructure/ids.js';
import {
  completeByWelcome,
  completeTask,
  moveStartDate,
  reviewProbation,
  setBuddy,
  welcomePage,
} from '../application/plans.js';
import { boardScreen, myTasks, planScreen, saveSettings } from '../application/screens.js';
import type { Deps, UnitOfWork } from '../application/ports.js';
import { onboardingConsumer } from '../infrastructure/consumers/handle.js';

/**
 * One new hire from Recruiting's handover to a probation review (ONB-015),
 * with People and Recruiting absent: their events arrive as data and nothing
 * of theirs is imported. Shared by the standalone suite (memory) and the
 * integration suite (Postgres).
 */

export interface Harness {
  readonly uow: UnitOfWork;
  readonly events: (
    tenantId: string,
  ) => Promise<readonly { eventName: string; payload: unknown }[]>;
}

const fixedClock = (today: string): Clock =>
  ({
    date: () => today as CalendarDate,
    instant: () => `${today}T09:00:00.000Z` as never,
  }) as unknown as Clock;

export async function welcomeAndReview(h: Harness): Promise<void> {
  const tenantId = TenantId.parse(randomUUID());
  const hr = randomUUID();
  const people = { manager: randomUUID(), buddy: randomUUID(), it: randomUUID() };
  const sent: { to: string; link: string }[] = [];
  let today = '2026-10-15';
  const deps: Deps = {
    uow: h.uow,
    get clock() {
      return fixedClock(today);
    },
    newId: randomUUID,
    jobsOrigin: 'https://jobs.example',
    mailer: {
      send: (m) => {
        sent.push({ to: m.to, link: m.parts?.action?.href ?? '' });
        return Promise.resolve();
      },
    },
  };
  const as = <T>(who: 'hr' | keyof typeof people | 'public', fn: (ctx: Ctx) => Promise<T>) =>
    h.uow.run(tenantId, async (tx) =>
      fn(
        await contextOf(deps, tx, {
          tenantId,
          accountId: who === 'hr' ? hr : who === 'public' ? 'public' : randomUUID(),
          personId: who === 'hr' || who === 'public' ? null : people[who],
          correlationId: randomUUID(),
        }),
      ),
    );
  const value = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  // The company: HR is an administrator; IT is named in settings; the three are members.
  await h.uow.run(tenantId, async (tx) => {
    await tx.admins.add(hr);
    for (const [name, id] of Object.entries(people))
      await tx.members.upsert(
        {
          personId: id as PersonId,
          accountId: null,
          displayName: name,
          workEmail: null,
          managerPersonId: null,
          status: 'active',
        },
        randomUUID(),
      );
  });
  await as('hr', async (ctx) =>
    value(
      await saveSettings(ctx, {
        roles: { hr: [], it: [people.it] },
        holidays: {},
        defaultCountry: 'ES',
      }),
    ),
  );

  // Recruiting hands the hire over: a plan, its event, and a welcome email.
  const consume = onboardingConsumer(deps);
  const applicationId = randomUUID();
  const envelope = (eventName: string, payload: unknown) => ({
    eventId: uuidv7(),
    eventName,
    eventVersion: 1,
    tenantId,
    occurredAt: '2026-10-15T09:00:00.000Z',
    recordedAt: '2026-10-15T09:00:00.000Z',
    effectiveFrom: '2026-10-15',
    aggregate: { type: 'application', id: applicationId, version: 0 },
    actor: { kind: 'system', process: 'recruiting' },
    correlationId: randomUUID(),
    causationId: null,
    payload,
  });
  expect(CandidateHired.name).toBe('recruiting.candidate.hired');
  const handover = (application: string) => ({
    candidateId: randomUUID(),
    applicationId: application,
    jobId: randomUUID(),
    offerId: randomUUID(),
    offerVersion: 1,
    candidate: { givenName: 'Yuki', familyName: 'Sato', email: 'yuki@example.com', phone: null },
    terms: {
      country: 'ES',
      region: null,
      packVersion: '2026.2',
      relationship: 'employee',
      contractType: 'indefinido',
      employmentType: 'permanent',
      fixedTermReason: null,
      contractStart: '2026-12-01',
      contractEnd: null,
      workingPattern: 'full_time',
      weeklyMinutes: 2400,
      fte: '1.0000',
      probation: { count: 6, unit: 'months' },
      probationEnd: '2027-05-31',
      noticeEmployee: { count: 15, unit: 'days' },
      noticeEmployer: { count: 15, unit: 'days' },
      workMode: 'hybrid',
      hybridDaysOnsite: 2,
      remoteCountry: null,
      collectiveAgreement: null,
      nonCompeteMonths: null,
      mobilityClause: false,
      paymentsPerYear: 14,
      signature: 'electronic',
      documents: [],
      conditions: [],
    },
    pay: { base: { amountMinor: 6_000_000, currency: 'EUR' }, frequency: 'year' },
    benefits: [],
    startDate: '2026-12-01',
    managerId: people.manager,
    orgUnitId: null,
    locationId: null,
    legalEntityId: randomUUID(),
    conditions: [],
  });
  const hired = await consume(envelope(CandidateHired.name, handover(applicationId)));
  expect(hired).toBe('applied');
  // The same handover again changes nothing.
  expect(await consume(envelope(CandidateHired.name, handover(applicationId)))).toBe('applied');
  expect((await h.events(tenantId)).map((e) => e.eventName)).toEqual(['onboarding.plan.started']);
  // The welcome's button carries the hire's link.
  const link = sent.find((m) => m.to === 'yuki@example.com')?.link ?? '';
  const token = /#(\S+)/u.exec(link)?.[1] ?? '';
  expect(token.startsWith(`${tenantId}.`)).toBe(true);

  // HR sees the plan on the board; the buddy, not yet chosen, does not.
  const board = (await as('hr', (ctx) => boardScreen(ctx, undefined))) as {
    rows: { id: string; name: string; total: number }[];
  };
  expect(board.rows.map((r) => r.name)).toEqual(['Yuki Sato']);
  const planId = board.rows[0]?.id ?? '';
  expect(
    ((await as('buddy', (ctx) => boardScreen(ctx, undefined))) as { rows: unknown[] }).rows,
  ).toEqual([]);

  // Spain's tasks are in, and the manager owes a probation review on 1 May.
  const plan = value(await as('hr', (ctx) => planScreen(ctx, planId))) as {
    tasks: { id: string; key: string; dueOn: string; ownerRole: string; mine: boolean }[];
  };
  expect(plan.tasks.map((t) => t.key)).toContain('es_social_security_alta');
  expect(plan.tasks.find((t) => t.key === 'probation_review')?.dueOn).toBe('2027-05-03');

  // The manager chooses the buddy, who now sees it.
  value(await as('manager', (ctx) => setBuddy(ctx, planId, people.buddy)));
  expect(
    ((await as('buddy', (ctx) => boardScreen(ctx, undefined))) as { rows: unknown[] }).rows.length,
  ).toBe(1);

  // IT's own list has the laptop, and only IT may tick it.
  const itTasks = (await as('it', (ctx) => myTasks(ctx))) as {
    rows: { taskId: string; title: string }[];
  };
  const equipment = itTasks.rows.find((r) => r.title.includes('laptop'));
  expect(equipment).toBeDefined();
  expect((await as('buddy', (ctx) => completeTask(ctx, planId, equipment?.taskId ?? ''))).ok).toBe(
    false,
  );
  value(await as('it', (ctx) => completeTask(ctx, planId, equipment?.taskId ?? '')));

  // The new hire, with no account, opens the welcome page and ticks a task of theirs.
  const page = value(await as('public', (ctx) => welcomePage(ctx, token))) as {
    startDate: string;
    manager: string | null;
    buddy: string | null;
    tasks: { id: string; done: boolean }[];
  };
  expect(page).toMatchObject({ startDate: '2026-12-01', manager: 'manager', buddy: 'buddy' });
  value(await as('public', (ctx) => completeByWelcome(ctx, token, page.tasks[0]?.id ?? '')));
  expect(
    (await as('public', (ctx) => welcomePage(ctx, `${tenantId}.wrong-token-wrong-token`))).ok,
  ).toBe(false);

  // HR moves the start by a week; the review moves with it.
  value(await as('hr', (ctx) => moveStartDate(ctx, planId, '2026-12-08' as CalendarDate)));
  const moved = value(await as('hr', (ctx) => planScreen(ctx, planId))) as {
    plan: { probationEnd: string };
  };
  expect(moved.plan.probationEnd).toBe('2027-06-07');

  // People makes Yuki: the plan has its person now, and says so again for
  // Performance, which needs a person to hang the probation's end on.
  const yuki = randomUUID();
  const personHired = (personId: string, email: string, given: string) =>
    envelope(PersonHired.name, {
      personId,
      identityAccountId: null,
      name: { given, family: 'Sato', preferred: null },
      workEmail: email,
      managerId: null,
      orgUnitId: null,
      legalEntityId: null,
      employment: { from: '2026-12-08', to: null },
      status: 'pending',
      schemaVersion: 1,
      sourceOfRecord: 'own',
    });
  expect(await consume(personHired(yuki, 'yuki@example.com', 'Yuki'))).toBe('applied');
  const started = (await h.events(tenantId)).filter(
    (e) => e.eventName === 'onboarding.plan.started',
  );
  expect(started.map((e) => (e.payload as { personId: string | null }).personId)).toEqual([
    null,
    yuki,
  ]);
  expect((started.at(-1)?.payload as { probationEnd: string }).probationEnd).toBe('2027-06-07');
  // Performance releases the probation review: the task links to it; the decision stays here.
  const cycleId = randomUUID();
  const released = envelope(ReviewReleased.name, {
    reviewId: randomUUID(),
    cycleId,
    subjectId: yuki,
  });
  expect(await consume(released)).toBe('applied');
  expect(await consume(released)).toBe('unchanged');
  const linked = value(await as('hr', (ctx) => planScreen(ctx, planId))) as {
    tasks: { key: string; link: string | null }[];
  };
  expect(linked.tasks.find((t) => t.key === 'probation_review')?.link).toBe(
    `/performance/cycles/${cycleId}/about/${yuki}`,
  );

  // Probation: an extension past what the pack allows is refused; a pass is published.
  today = '2027-05-10';
  expect((await as('manager', (ctx) => reviewProbation(ctx, planId, 'extended', 6))).ok).toBe(
    false,
  );
  value(await as('manager', (ctx) => reviewProbation(ctx, planId, 'passed', null)));
  const names = (await h.events(tenantId)).map((e) => e.eventName);
  expect(names).toContain('onboarding.probation.reviewed');
  expect(names.filter((n) => n === 'onboarding.task.completed').length).toBe(3);

  // Ana's two events come the other way round: People's first, then Recruiting's.
  // One plan, rebuilt from the hand-over with the probation People's never knew.
  const ana = randomUUID();
  const anaApplication = randomUUID();
  today = '2026-10-15';
  expect(await consume(personHired(ana, 'ana@example.com', 'Ana'))).toBe('applied');
  expect(
    await consume(
      envelope(CandidateHired.name, {
        ...handover(anaApplication),
        candidate: { givenName: 'Ana', familyName: 'Sato', email: 'ana@example.com', phone: null },
      }),
    ),
  ).toBe('applied');
  const anaRows = (
    (await as('hr', (ctx) => boardScreen(ctx, undefined))) as {
      rows: { id: string; name: string }[];
    }
  ).rows.filter((r) => r.name === 'Ana Sato');
  expect(anaRows.length).toBe(1);
  const anaPlan = value(await as('hr', (ctx) => planScreen(ctx, anaRows[0]?.id ?? ''))) as {
    plan: { probationEnd: string | null };
    tasks: { key: string }[];
  };
  expect(anaPlan.plan.probationEnd).toBe('2027-05-31');
  expect(anaPlan.tasks.map((t) => t.key)).toContain('probation_review');
  // Welcomed once, by the plan People's event started.
  expect(sent.filter((m) => m.to === 'ana@example.com').length).toBe(1);
  // And Recruiting's cancellation still finds it.
  expect(
    await consume(
      envelope(PrehireCancelled.name, {
        candidateId: randomUUID(),
        applicationId: anaApplication,
        reasonKey: 'reneged',
        email: null,
      }),
    ),
  ).toBe('applied');

  // Another hire falls through before the start: its plan is cancelled.
  const second = randomUUID();
  expect(await consume(envelope(CandidateHired.name, handover(second)))).toBe('applied');
  expect(
    await consume(
      envelope(PrehireCancelled.name, {
        candidateId: randomUUID(),
        applicationId: second,
        reasonKey: 'reneged',
        email: null,
      }),
    ),
  ).toBe('applied');
  expect((await h.events(tenantId)).map((e) => e.eventName)).toContain('onboarding.plan.cancelled');
}
