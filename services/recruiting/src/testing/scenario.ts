import { randomUUID } from 'node:crypto';
import { CalendarDate, Instant, JobSearch, TenantId, type PersonId } from '@kithena/contracts';
import type { Clock } from '@kithena/domain-kit';
import { expect } from 'vitest';

import { contextOf, type Ctx } from '../application/context.js';
import { apply, requestCode } from '../application/intake.js';
import {
  createJob,
  publishTo,
  saveAd,
  saveJobDetails,
  setPlan,
  moveJobState,
} from '../application/jobs.js';
import { moveApplication } from '../application/moves.js';
import {
  saveScorecard,
  scheduleInterview,
  setInterviewState,
  slotsFor,
} from '../application/interviews.js';
import {
  candidateAccepts,
  composeOffer,
  offerForCandidate,
  sendTheOffer,
  submitOfferForApproval,
  uploadSignedContract,
} from '../application/offers.js';
import { candidateByToken } from '../application/privacy.js';
import {
  decideRequisition,
  saveRequisition,
  submitRequisition,
} from '../application/requisitions.js';
import {
  saveEntity,
  saveGeneralSettings,
  saveLocation,
  saveScorecardTemplate,
  DEFAULT_SETTINGS,
} from '../application/setup.js';
import { daily } from '../application/background.js';
import { receiveReply, replyAddress } from '../application/replies.js';
import type { Listings, Blobs, Caller, Deps, UnitOfWork } from '../application/ports.js';
import type { MemoryUnitOfWork } from './memory.js';

/**
 * One candidate from a requisition to a pre-hire (REC-099): the flow the
 * standalone suite runs in memory and the integration suite over Postgres.
 * `events` and `listings` read back what the store under test kept.
 */
export interface Harness {
  readonly uow: UnitOfWork;
  readonly blobs: Blobs;
  readonly events: (
    tenantId: string,
  ) => Promise<readonly { eventName: string; payload: unknown; effectiveFrom: string | null }[]>;
  /** Kithena Jobs' reads, as `apps/jobs` makes them. */
  readonly jobs: Listings;
}

const SCORECARD = '0190a000-0000-7000-8000-00000000005c';

export async function hireInSpain(h: Harness): Promise<void> {
  const tenantId = TenantId.parse(randomUUID());
  let now = Date.parse('2026-10-15T08:00:00Z');
  const clock: Clock = {
    now: () => new Date(now),
    today: () => new Date(now).toISOString().slice(0, 10),
    instant: () => Instant.parse(new Date(now).toISOString()),
    date: () => CalendarDate.parse(new Date(now).toISOString().slice(0, 10)),
  };
  const uow = h.uow;
  const deps: Deps = {
    uow,
    blobs: h.blobs,
    clock,
    newId: () => randomUUID(),
    jobsOrigin: 'https://jobs.example',
    extractText: (bytes) => Promise.resolve(new TextDecoder().decode(bytes)),
  };
  const people = {
    ada: randomUUID(),
    marco: randomUUID(),
    sofia: randomUUID(),
    adam: randomUUID(),
  };
  const accounts = {
    ada: randomUUID(),
    marco: randomUUID(),
    sofia: randomUUID(),
    adam: randomUUID(),
  };
  const callerOf = (who: keyof typeof people | 'public'): Caller => ({
    tenantId,
    accountId: who === 'public' ? 'public' : accounts[who],
    personId: who === 'public' ? null : (people[who] as PersonId),
    correlationId: randomUUID(),
  });
  const as = async <T>(
    who: keyof typeof people | 'public',
    fn: (ctx: Ctx) => Promise<T>,
  ): Promise<T> => uow.run(tenantId, async (tx) => fn(await contextOf(deps, tx, callerOf(who))));
  const value = <T>(
    r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } },
  ): T => {
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.value;
  };
  const entityId = randomUUID();
  const locationId = randomUUID();
  await uow.run(tenantId, async (tx) => {
    await tx.admins.add(accounts.ada);
    for (const [who, id] of Object.entries(people)) {
      await tx.members.upsert(
        {
          personId: id as PersonId,
          accountId: accounts[who as keyof typeof accounts],
          displayName: who,
          workEmail: `${who}@acme.example`,
          managerPersonId: who === 'marco' ? (people.sofia as PersonId) : null,
          teamKey: null,
          teamName: null,
          locationKey: null,
          legalEntityId: entityId,
          status: 'active',
        },
        randomUUID(),
        CalendarDate.parse('2026-01-01'),
      );
    }
    await tx.chains.save({
      id: randomUUID(),
      name: 'Manager’s manager',
      appliesTo: 'requisition',
      priority: 1,
      when: {},
      steps: [{ kind: 'managers_manager' }],
    });
  });

  await as('ada', async (ctx) => {
    value(
      await saveGeneralSettings(ctx, {
        ...DEFAULT_SETTINGS,
        companyName: 'Acme',
        companySlug: 'acme',
        searchable: true,
      }),
    );
    value(
      await saveEntity(ctx, {
        id: entityId,
        name: 'Acme Iberia SL',
        country: 'ES',
        currency: 'EUR',
        fullTimeWeeklyMinutes: 2400,
        headcount: 80,
        foundedOn: null,
        worksCouncil: false,
        worksCouncilIds: [],
      }),
    );
    value(
      await saveLocation(ctx, {
        id: locationId,
        name: 'Madrid',
        entityId,
        country: 'ES',
        region: 'MD',
        city: 'Madrid',
        timeZone: 'Europe/Madrid',
      }),
    );
    value(
      await saveScorecardTemplate(ctx, {
        id: SCORECARD,
        name: 'Design',
        competencies: [
          { key: 'craft', name: 'Craft', description: '', questions: [] },
          { key: 'collab', name: 'Collaboration', description: '', questions: [] },
        ],
      }),
    );
  });

  // Marco asks for a designer; Sofia, his manager, approves.
  const requisitionId = randomUUID();
  await as('marco', async (ctx) => {
    value(
      await saveRequisition(ctx, {
        id: requisitionId,
        title: 'Product Designer',
        orgUnitId: null,
        hiringManagerId: people.marco,
        legalEntityId: entityId,
        locationIds: [locationId],
        openings: 1,
        filled: 0,
        targetStart: null,
        reason: 'new_role',
        replacesPersonId: null,
        budget: {
          from: { amountMinor: 4_800_000, currency: 'EUR' },
          to: { amountMinor: 5_800_000, currency: 'EUR' },
        },
        justification: 'Growth squad',
        state: 'draft',
        approved: null,
      }),
    );
    expect(value(await submitRequisition(ctx, requisitionId)).state).toBe('pending_approval');
  });
  expect(
    (await as('sofia', (ctx) => decideRequisition(ctx, requisitionId, 'approved', null))).ok,
  ).toBe(true);

  // Ada opens the job, writes the ad and publishes it.
  const jobId = randomUUID();
  await as('ada', async (ctx) => {
    const job = value(
      await createJob(ctx, {
        id: jobId,
        title: 'Product Designer',
        internalTitle: 'Designer, Growth',
        requisitionIds: [requisitionId],
        entityId,
        locationIds: [locationId],
        department: 'Design',
        workMode: 'hybrid',
        openings: 1,
        languages: ['en'],
        hiringManagerId: people.marco,
      }),
    );
    value(
      await saveJobDetails(ctx, jobId, {
        ...job,
        salaryShown: true,
        salary: { minMinor: 4_800_000, maxMinor: 5_800_000, currency: 'EUR', period: 'year' },
        scorecardTemplateId: SCORECARD,
      }),
    );
    value(
      await setPlan(ctx, jobId, [
        {
          key: 'portfolio',
          title: 'Portfolio review',
          minutes: 60,
          interviewerIds: [people.adam],
          competencies: [],
          scorecardTemplateId: SCORECARD,
        },
      ]),
    );
    const ad = value(
      await saveAd(ctx, jobId, 'en', 'Product Designer', {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Design the product with us.' }] },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'You bring five years of product design.' }],
          },
        ],
      }),
    );
    expect(ad.html).toBe(
      '<p>Design the product with us.</p><p>You bring five years of product design.</p>',
    );
    expect(ad.checks.filter((c) => c.severity === 'error')).toEqual([]);
    value(await moveJobState(ctx, jobId, 'open'));
    value(await publishTo(ctx, jobId, 'careers_page'));
    value(await publishTo(ctx, jobId, 'kithena_jobs'));
    value(await publishTo(ctx, jobId, 'google_for_jobs'));
  });
  const found = await h.jobs.search(JobSearch.parse({ q: 'designer' }));
  expect(found.rows.map((l) => [l.title, l.searchable, l.company.slug])).toEqual([
    ['Product Designer', true, 'acme'],
  ]);
  expect(found.total).toBe(1);
  expect((await h.jobs.search(JobSearch.parse({ q: 'plumber' }))).rows).toEqual([]);
  const slug = found.rows[0]?.slug ?? '';
  expect((await h.jobs.job('acme', slug, 'en'))?.closed).toBe(false);
  expect((await h.jobs.company('acme'))?.jobs.map((j) => j.slug)).toEqual([slug]);

  // Yuki applies on her phone: a code, then the form.
  const { code } = await as('public', async (ctx) =>
    value(await requestCode(ctx, slug, 'yuki@example.com', 'Yuki Sato')),
  );
  const applied = await as('public', async (ctx) =>
    value(
      await apply(
        ctx,
        {
          jobId,
          language: 'en',
          answers: { name: 'Yuki Sato', email: 'yuki@example.com', right_to_work: true },
          consent: { application: true, talentPool: true },
          adjustments: null,
          source: { target: 'kithena_jobs' },
          code,
        },
        [
          {
            field: 'cv',
            fileName: 'yuki.pdf',
            mediaType: 'application/pdf',
            bytes: new TextEncoder().encode('Yuki Sato, product designer'),
          },
        ],
      ),
    ),
  );
  expect(applied.portalUrl).toMatch(/^https:\/\/jobs\.example\/me\/acme#/u);

  // Interview, scorecard, offer.
  const stages = await uow.run(tenantId, (tx) => tx.jobs.stages(jobId));
  const interviewStage = stages.find((s) => s.category === 'interview')?.id ?? '';
  const offerStage = stages.find((s) => s.category === 'offer')?.id ?? '';
  await as('ada', async (ctx) => {
    value(
      await moveApplication(ctx, applied.applicationId, interviewStage, {
        interviewType: 'portfolio',
      }),
    );
    const slots = value(
      await slotsFor(
        ctx,
        applied.applicationId,
        'portfolio',
        Instant.parse('2026-10-19T00:00:00.000Z'),
        Instant.parse('2026-10-20T00:00:00.000Z'),
      ),
    );
    expect(slots.length).toBeGreaterThan(0);
    value(
      await scheduleInterview(ctx, applied.applicationId, {
        planKey: 'portfolio',
        startsAt: Instant.parse(slots[0] ?? ''),
        place: 'Madrid office',
        videoUrl: null,
      }),
    );
  });
  const interviewId =
    (await uow.run(tenantId, (tx) => tx.interviews.forApplication(applied.applicationId)))[0]?.id ??
    '';
  // The day before, the candidate is reminded; messaging drops a repeat by its key.
  now = Date.parse('2026-10-18T06:00:00Z');
  const sent: string[] = [];
  await daily({
    ...deps,
    mailer: {
      send: (m) => {
        sent.push(m.dedupeKey);
        return Promise.resolve();
      },
    },
  });
  expect(sent).toContain(`interview-reminder:${interviewId}`);

  // A reply to the thread's own address lands on it; the same words from anyone else do not.
  const yuki = await uow.run(tenantId, (tx) => tx.candidates.byEmail('yuki@example.com'));
  const address =
    (await uow.run(tenantId, (tx) =>
      replyAddress(
        { inbound: { domain: 'in.example.com', token: 't' } },
        tx,
        'acme',
        yuki?.id ?? '',
      ),
    )) ?? '';
  const replyToken = /\.([a-f0-9]{20})@in\.example\.com$/u.exec(address)?.[1] ?? '';
  const reply = { token: replyToken, subject: 'Re: Tomorrow', text: 'See you then.' };
  await as('public', async (ctx) => {
    expect((await receiveReply(ctx, { ...reply, from: 'someone@else.com' })).ok).toBe(false);
    value(await receiveReply(ctx, { ...reply, from: 'Yuki@Example.com' }));
    expect((await ctx.tx.messages.thread(yuki?.id ?? '')).at(-1)?.direction).toBe('in');
  });
  now = Date.parse('2026-10-19T15:00:00Z');
  await as('adam', async (ctx) => {
    value(await setInterviewState(ctx, interviewId, 'completed'));
    value(
      await saveScorecard(ctx, interviewId, {
        ratings: { craft: 4, collab: 3 },
        recommendation: 'strong_yes',
        notes: null,
        submit: true,
      }),
    );
  });
  const offer = await as('ada', async (ctx) => {
    value(await moveApplication(ctx, applied.applicationId, offerStage));
    const drafted = value(
      await composeOffer(ctx, applied.applicationId, {
        terms: {
          region: 'MD',
          relationship: 'employee',
          contractType: 'indefinido',
          roleGroup: 'qualified',
          weeklyMinutes: 2400,
          probation: { count: 6, unit: 'months' },
          noticeEmployee: { count: 15, unit: 'days' },
          noticeEmployer: { count: 15, unit: 'days' },
          workMode: 'hybrid',
          hybridDaysOnsite: 3,
          agreement: { key: 'consultoria', group: 'grupo_1' },
          annualPayMinor: 5_300_000,
          paymentsPerYear: 14,
          benefitIds: [],
          nonCompeteMonths: null,
          mobilityClause: false,
        },
        pay: {
          baseMinor: 5_300_000,
          currency: 'EUR',
          frequency: 'year',
          variableTargetMinor: 0,
          signOnMinor: 0,
          relocationMinor: 0,
          equity: null,
        },
        benefitIds: [],
        startDate: CalendarDate.parse('2026-12-01'),
        expiresOn: CalendarDate.parse('2026-10-26'),
        letterTemplateId: null,
        grade: null,
        outsideBandReason: null,
      }),
    );
    expect(value(await submitOfferForApproval(ctx, drafted.id)).state).toBe('approved');
    return value(await sendTheOffer(ctx, drafted.id));
  });

  // Yuki accepts on her page; Ada uploads the signed contract.
  const token = applied.portalUrl.split('#')[1] ?? '';
  await as('public', async (ctx) => {
    const candidate = await candidateByToken(ctx, token);
    expect(candidate?.email).toBe('yuki@example.com');
    const read = value(await offerForCandidate(ctx, candidate?.id ?? '', offer.id));
    expect(
      value(await candidateAccepts(ctx, candidate?.id ?? '', offer.id, read.hash, '203.0.113.9'))
        .state,
    ).toBe('accepted');
  });
  await as('ada', async (ctx) => {
    const contract = await ctx.tx.contracts.forOffer(offer.id);
    expect(contract?.route).toBe('upload');
    const candidate = await ctx.tx.candidates.byEmail('yuki@example.com');
    const fileId = (await ctx.tx.files.of(candidate?.id ?? ''))[0]?.id ?? '';
    value(await uploadSignedContract(ctx, offer.id, fileId, CalendarDate.parse('2026-10-20')));
  });

  const events = (await h.events(tenantId)).map((e) => e.eventName);
  expect(events).toEqual(
    expect.arrayContaining([
      'recruiting.requisition.submitted',
      'recruiting.requisition.decided',
      'recruiting.job.opened',
      'recruiting.job.published',
      'recruiting.application.received',
      'recruiting.application.moved',
      'recruiting.interview.scheduled',
      'recruiting.interview.completed',
      'recruiting.scorecard.submitted',
      'recruiting.offer.approved',
      'recruiting.offer.sent',
      'recruiting.offer.accepted',
      'recruiting.candidate.hired',
      'recruiting.job.filled',
    ]),
  );
  const hired = (await h.events(tenantId)).find(
    (e) => e.eventName === 'recruiting.candidate.hired',
  );
  expect(hired?.payload).toMatchObject({
    candidate: { givenName: 'Yuki', familyName: 'Sato', email: 'yuki@example.com' },
    terms: {
      country: 'ES',
      contractType: 'indefinido',
      paymentsPerYear: 14,
      probationEnd: '2027-05-31',
    },
    startDate: '2026-12-01',
  });
  expect(hired?.effectiveFrom).toBe('2026-12-01');
  // Filled: the job comes off Kithena Jobs.
  expect((await h.jobs.search(JobSearch.parse({ company: 'acme' }))).rows).toEqual([]);
  const prehire = await uow.run(tenantId, (tx) => tx.prehires.get(applied.applicationId));
  expect(prehire?.state).toBe('conditions_met');
}

/** The in-memory harness. */
export function memoryHarness(uow: MemoryUnitOfWork, blobs: Blobs): Harness {
  return {
    uow,
    blobs,
    events: (tenantId) =>
      Promise.resolve(
        uow.events(tenantId as never).map((e) => ({
          eventName: e.eventName,
          payload: e.payload,
          effectiveFrom: e.effectiveFrom,
        })),
      ),
    jobs: uow.listings,
  };
}
