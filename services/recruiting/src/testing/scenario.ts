import { randomBytes, randomUUID } from 'node:crypto';
import {
  CalendarDate,
  Instant,
  JobSearch,
  TenantId,
  type LaunchCountry,
  type PersonId,
} from '@kithena/contracts';
import type { Clock } from '@kithena/domain-kit';
import { expect } from 'vitest';
import * as z from 'zod';

import { contextOf, deliver, type Ctx, type Outgoing } from '../application/context.js';
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
  decidePrehireCondition,
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
import {
  agencyPortal,
  openAgencySession,
  requestAgencyCode,
  submitAsAgency,
} from '../application/agency-portal.js';
import {
  confirmAlert,
  sendAlertDigests,
  stopAlert,
  subscribeAlert,
} from '../application/alerts.js';
import { readApplication } from '../application/ai.js';
import {
  MATRIX,
  agreeWithFinding,
  assessMatrix,
  latestMatrix,
  rediscover,
} from '../application/matrix.js';
import { PARSER, confirmParsedProfile, myParsedProfile, parseCv } from '../application/parser.js';
import { daily } from '../application/background.js';
import { fairness, saveSelfId } from '../application/fairness.js';
import { aesSealer } from '../infrastructure/sealer.js';
import { askForChart } from '../application/chart-ask.js';
import { askAboutJob, planSearch } from '../application/job-assistant.js';
import { summariseDebrief } from '../application/debrief-summary.js';
import { draftAd, draftEmail, suggestQuestions, translateAd } from '../application/writer.js';
import { poolsScreen } from '../application/screens.js';
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

/** Where the hire happens: the entity, the office, and terms the country's pack accepts (§19). */
export interface Place {
  readonly country: LaunchCountry;
  readonly currency: string;
  readonly entity: string;
  /** As the country's job-ad rules want it: Germany's names every gender. */
  readonly jobTitle: string;
  readonly office: { readonly region: string; readonly city: string; readonly timeZone: string };
  readonly fullTimeWeeklyMinutes: number;
  /** The offer's terms, as composed on R21. */
  readonly terms: Record<string, unknown> & {
    readonly contractType: string;
    readonly annualPayMinor: number;
    readonly paymentsPerYear: number;
  };
  readonly probationEnd: string | null;
}

const month = { count: 1, unit: 'months' } as const;
const common = {
  relationship: 'employee',
  workMode: 'hybrid',
  hybridDaysOnsite: 3,
  agreement: null,
  paymentsPerYear: 12,
  benefitIds: [],
  nonCompeteMonths: null,
  mobilityClause: false,
} as const;

/** One per launch country (REC-099). */
export const PLACES: Readonly<Record<LaunchCountry, Place>> = {
  ES: {
    country: 'ES',
    jobTitle: 'Product Designer',
    currency: 'EUR',
    entity: 'Acme Iberia SL',
    office: { region: 'MD', city: 'Madrid', timeZone: 'Europe/Madrid' },
    fullTimeWeeklyMinutes: 2400,
    terms: {
      ...common,
      region: 'MD',
      contractType: 'indefinido',
      roleGroup: 'qualified',
      weeklyMinutes: 2400,
      probation: { count: 6, unit: 'months' },
      noticeEmployee: { count: 15, unit: 'days' },
      noticeEmployer: { count: 15, unit: 'days' },
      agreement: { key: 'consultoria', group: 'grupo_1' },
      annualPayMinor: 5_300_000,
      paymentsPerYear: 14,
    },
    probationEnd: '2027-05-31',
  },
  DE: {
    country: 'DE',
    jobTitle: 'Product Designer (m/w/d)',
    currency: 'EUR',
    entity: 'Acme GmbH',
    office: { region: 'BE', city: 'Berlin', timeZone: 'Europe/Berlin' },
    fullTimeWeeklyMinutes: 2400,
    terms: {
      ...common,
      region: 'BE',
      contractType: 'unbefristet',
      weeklyMinutes: 2400,
      probation: { count: 6, unit: 'months' },
      noticeEmployee: { count: 4, unit: 'weeks' },
      noticeEmployer: { count: 4, unit: 'weeks' },
      annualPayMinor: 7_800_000,
    },
    probationEnd: '2027-05-31',
  },
  GB: {
    country: 'GB',
    jobTitle: 'Product Designer',
    currency: 'GBP',
    entity: 'Acme UK Ltd',
    office: { region: 'ENG', city: 'London', timeZone: 'Europe/London' },
    fullTimeWeeklyMinutes: 2400,
    terms: {
      ...common,
      region: 'ENG',
      contractType: 'permanent',
      weeklyMinutes: 2400,
      probation: { count: 3, unit: 'months' },
      noticeEmployee: month,
      noticeEmployer: month,
      annualPayMinor: 6_000_000,
    },
    probationEnd: null,
  },
  IN: {
    country: 'IN',
    jobTitle: 'Product Designer',
    currency: 'INR',
    entity: 'Acme India Pvt Ltd',
    office: { region: 'KA', city: 'Bengaluru', timeZone: 'Asia/Kolkata' },
    fullTimeWeeklyMinutes: 2880,
    terms: {
      ...common,
      region: 'KA',
      contractType: 'permanent',
      weeklyMinutes: 2880,
      probation: { count: 6, unit: 'months' },
      noticeEmployee: { count: 30, unit: 'days' },
      noticeEmployer: { count: 30, unit: 'days' },
      annualPayMinor: 180_000_000,
    },
    probationEnd: null,
  },
  US: {
    country: 'US',
    jobTitle: 'Product Designer',
    currency: 'USD',
    entity: 'Acme Inc',
    office: { region: 'CA', city: 'San Francisco', timeZone: 'America/Los_Angeles' },
    fullTimeWeeklyMinutes: 2400,
    terms: {
      ...common,
      region: 'CA',
      contractType: 'at_will_full_time',
      weeklyMinutes: 2400,
      probation: null,
      noticeEmployee: { count: 0, unit: 'days' },
      noticeEmployer: { count: 0, unit: 'days' },
      annualPayMinor: 12_000_000,
      exempt: true,
    },
    probationEnd: null,
  },
};

export const hireInSpain = (h: Harness): Promise<void> => hireIn(h, PLACES.ES);

/** One candidate from a requisition to a pre-hire in `place`, Recruiting alone. */
export async function hireIn(h: Harness, place: Place): Promise<void> {
  const pay = place.terms.annualPayMinor;
  const band = { min: Math.round(pay * 0.9), max: Math.round(pay * 1.1) };
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
        name: place.entity,
        country: place.country,
        currency: place.currency,
        fullTimeWeeklyMinutes: place.fullTimeWeeklyMinutes,
        headcount: 80,
        foundedOn: null,
        worksCouncil: false,
        worksCouncilIds: [],
      }),
    );
    value(
      await saveLocation(ctx, {
        id: locationId,
        name: place.office.city,
        entityId,
        country: place.country,
        region: place.office.region,
        city: place.office.city,
        timeZone: place.office.timeZone,
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
        title: place.jobTitle,
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
          from: { amountMinor: band.min, currency: place.currency },
          to: { amountMinor: band.max, currency: place.currency },
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
        title: place.jobTitle,
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
        salary: {
          minMinor: band.min,
          maxMinor: band.max,
          currency: place.currency,
          period: 'year',
        },
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
      await saveAd(ctx, jobId, 'en', place.jobTitle, {
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
    [place.jobTitle, true, 'acme'],
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
        place: `${place.office.city} office`,
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

  // §22.2: a model reads the application only for the hiring team, masked, and every read is kept.
  await uow.run(tenantId, async (tx) => {
    const general = (await tx.settings.get('general')) as { ai: Record<string, unknown> };
    await tx.settings.set('general', {
      ...general,
      ai: { ...general.ai, parser: true, matrix: true },
    });
  });
  const seen: string[] = [];
  const reading = {
    ...deps,
    model: {
      name: 'fake',
      complete: (
        _: string,
        prompt: { instruction: string; context: Readonly<Record<string, unknown>> },
      ) => {
        seen.push(String(prompt.context['application']));
        return Promise.resolve(
          prompt.instruction === MATRIX.instruction
            ? JSON.stringify({
                findings: (prompt.context['criteria'] as { id: string }[]).map((c) => ({
                  criterionId: c.id,
                  verdict: 'met',
                  passages: ['product designer'],
                  why: 'Says so.',
                })),
              })
            : prompt.instruction === PARSER.instruction
              ? JSON.stringify({
                  work: [],
                  education: [],
                  skills: [
                    { value: 'product design', passage: 'product designer' },
                    { value: 'Kubernetes', passage: 'Kubernetes' },
                  ],
                  languages: [],
                  certifications: [],
                })
              : '{"summary":"A product designer."}',
        );
      },
    },
  };
  const spec = {
    feature: 'parser' as const,
    version: 'test@1',
    instruction: 'Summarise.',
    answer: z.object({ summary: z.string() }),
  };
  const readAs = (who: 'ada' | 'adam') =>
    uow.run(tenantId, async (tx) =>
      readApplication(await contextOf(reading, tx, callerOf(who)), applied.applicationId, spec),
    );
  expect(value(await readAs('ada')).answer.summary).toBe('A product designer.');
  expect((await readAs('adam')).ok).toBe(false);
  expect(seen.join(' ')).not.toContain('Yuki');
  const logged = await uow.run(tenantId, (tx) =>
    tx.assessments.forApplication(applied.applicationId),
  );
  expect(logged.map((a) => [a.feature, a.model, a.promptVersion])).toEqual([
    ['parser', 'fake', 'test@1'],
  ]);
  // §14.3: the matrix is scored by the domain, from quotes found in the text.
  const criterionId = randomUUID();
  await uow.run(tenantId, (tx) =>
    tx.jobs.setCriteria(jobId, [
      { id: criterionId, text: 'Product design', must: true, weight: 3 },
    ]),
  );
  const matrix = value(
    await uow.run(tenantId, async (tx) =>
      assessMatrix(await contextOf(reading, tx, callerOf('ada')), applied.applicationId),
    ),
  );
  expect([matrix.scoreBp, matrix.band]).toEqual([10_000, 'strong']);
  // §22.4: a recruiter disagrees with one finding; it is kept with the assessment.
  await as('ada', async (ctx) => {
    value(
      await agreeWithFinding(ctx, applied.applicationId, matrix.assessmentId, criterionId, false),
    );
    expect((await latestMatrix(ctx, applied.applicationId))?.findings[0]?.agreed).toBe(false);
  });

  // §14.5: a second job's recruiter rediscovers Yuki from the pool she agreed to join.
  const poolId = randomUUID();
  const secondJobId = randomUUID();
  await uow.run(tenantId, async (tx) => {
    await tx.pools.save({ id: poolId, name: 'Designers', description: null });
    await tx.pools.add({
      poolId,
      candidateId: yuki?.id ?? '',
      reason: 'Strong portfolio',
      addedBy: people.ada,
      addedAt: Instant.parse('2026-10-18T06:00:00.000Z'),
    });
    const first = await tx.jobs.get(jobId);
    if (first !== null) await tx.jobs.save({ ...first, id: secondJobId, slug: 'lead-designer' });
    await tx.jobs.setTeam(secondJobId, [{ personId: people.ada, role: 'recruiter' }]);
    await tx.jobs.setCriteria(secondJobId, [
      { id: randomUUID(), text: 'Product design', must: true, weight: 3 },
    ]);
  });
  const rediscovered = value(
    await uow.run(tenantId, async (tx) =>
      rediscover(await contextOf(reading, tx, callerOf('ada')), secondJobId),
    ),
  );
  expect(rediscovered.map((r) => [r.name, r.band])).toEqual([['Yuki Sato', 'strong']]);
  // That read was for the second job, so Yuki's own matrix on the first is unchanged.
  await as('ada', async (ctx) => {
    expect((await latestMatrix(ctx, applied.applicationId))?.assessmentId).toBe(
      matrix.assessmentId,
    );
  });

  // §22.3: a draft and a translation come back for a person to save; nothing is saved here.
  await uow.run(tenantId, async (tx) => {
    const general = (await tx.settings.get('general')) as { ai: Record<string, unknown> };
    await tx.settings.set('general', {
      ...general,
      ai: { ...general.ai, writer: true, assistant: true, charts: true },
    });
  });
  const writing = {
    ...deps,
    model: {
      name: 'fake',
      complete: (
        _: string,
        prompt: { instruction: string; context: Readonly<Record<string, unknown>> },
      ) =>
        Promise.resolve(
          prompt.instruction.startsWith('You turn a question about hiring')
            ? JSON.stringify({
                metric: 'hires',
                breakdown: String(prompt.context['question']).includes('stage')
                  ? 'stage'
                  : 'department',
                filters: {},
                period: 'this_year',
                compare: null,
                chart: 'bar',
              })
            : prompt.instruction.startsWith('You answer a job seeker')
              ? JSON.stringify({ answer: 'It is hybrid.', fromSources: true })
              : prompt.instruction.startsWith('You turn a job seeker')
                ? JSON.stringify({ filters: { workMode: ['remote'], country: 'ES', bogus: 1 } })
                : prompt.instruction.startsWith('You draft an email')
                  ? JSON.stringify({
                      subject: 'Next steps for {{job}}',
                      body: `Hello {{candidate}}, ${JSON.stringify(prompt.context).includes('Yuki') ? 'LEAK' : 'thank you.'}`,
                    })
                  : prompt.instruction.startsWith('You summarise interview scorecards')
                    ? JSON.stringify({
                        sentences: [
                          { text: 'Craft was rated strong.', cites: ['s1'] },
                          { text: 'Hire.', cites: [] },
                        ],
                      })
                    : prompt.instruction.startsWith('You suggest interview questions')
                      ? JSON.stringify({
                          competencies: [
                            { key: 'craft', questions: ['Tell us about a design you shipped.'] },
                            { key: 'made_up', questions: ['Ignored.'] },
                          ],
                        })
                      : prompt.instruction.startsWith('You translate')
                        ? JSON.stringify({
                            title: 'Diseño de producto',
                            pieces: (prompt.context['pieces'] as string[]).map((x) =>
                              x.toUpperCase(),
                            ),
                          })
                        : JSON.stringify({
                            title: place.jobTitle,
                            sections: [{ heading: 'The role', paragraphs: ['Design with us.'] }],
                          }),
        ),
    },
  };
  const asWriter = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    uow.run(tenantId, async (tx) => fn(await contextOf(writing, tx, callerOf('ada'))));
  expect(
    value(await asWriter((ctx) => draftAd(ctx, jobId, { language: 'en', intake: 'A designer.' })))
      .html,
  ).toContain('Design with us.');
  expect(
    value(await asWriter((ctx) => translateAd(ctx, jobId, { from: 'en', to: 'es' }))).html,
  ).toContain('DESIGN THE PRODUCT WITH US.');

  // J8: the job assistant says it is an AI; the search planner can only fill real filters.
  const answered = value(
    await uow.run(tenantId, async (tx) =>
      askAboutJob(await contextOf(writing, tx, callerOf('public')), slug, 'Is it remote?'),
    ),
  );
  expect(answered).toEqual({ ai: true, answer: 'It is hybrid.', answered: true });
  const planned = value(await planSearch(writing.model, 'remote jobs in Spain'));
  expect([planned.workMode, planned.country, 'bogus' in planned]).toEqual([
    ['remote'],
    'ES',
    false,
  ]);

  // R25: the plan is the domain's to check; a breakdown the metric lacks is refused whole.
  expect(value(await asWriter((ctx) => askForChart(ctx, 'hires by department'))).plan.metric).toBe(
    'hires',
  );
  const refused = await asWriter((ctx) => askForChart(ctx, 'hires by stage'));
  expect(refused.ok ? null : refused.error.code).toBe('PLAN');

  // R12: the model writes placeholders without seeing the name; the domain fills them.
  const email = value(
    await asWriter((ctx) =>
      draftEmail(ctx, applied.applicationId, {
        intent: 'Invite to a portfolio review',
        language: 'en',
      }),
    ),
  );
  expect(email).toEqual({
    subject: `Next steps for ${place.jobTitle}`,
    body: 'Hello Yuki Sato, thank you.',
  });

  // R14: questions are added only to the scorecard's own competencies, and nothing is saved.
  const kit = value(await asWriter((ctx) => suggestQuestions(ctx, SCORECARD)));
  expect(kit.competencies.map((c) => [c.key, c.questions])).toEqual([
    ['craft', ['Tell us about a design you shipped.']],
    ['collab', []],
  ]);

  // §14.2: the parser keeps only what the text says, and the candidate confirms it on their page.
  const parsed = value(
    await uow.run(tenantId, async (tx) =>
      parseCv(await contextOf(reading, tx, callerOf('ada')), applied.applicationId),
    ),
  );
  expect(parsed.profile.skills.map((x) => x.value)).toEqual(['product design']);
  await as('public', async (ctx) => {
    value(
      await confirmParsedProfile(
        ctx,
        yuki?.id ?? '',
        applied.applicationId,
        'I also lead research.',
      ),
    );
    expect(value(await myParsedProfile(ctx, yuki?.id ?? '', applied.applicationId))?.note).toBe(
      'I also lead research.',
    );
  });

  // §24.4: self-ID is sealed, counted only by an administrator, and a group under five is withheld.
  await uow.run(tenantId, async (tx) => {
    const general = (await tx.settings.get('general')) as Record<string, unknown>;
    await tx.settings.set('general', { ...general, selfId: { gender: true, ethnicity: false } });
  });
  const sealing = { ...deps, sealer: aesSealer(randomBytes(32)) };
  const asSealing = <T>(who: 'public' | 'ada' | 'adam', fn: (ctx: Ctx) => Promise<T>) =>
    uow.run(tenantId, async (tx) => fn(await contextOf(sealing, tx, callerOf(who))));
  value(
    await asSealing('public', (ctx) =>
      saveSelfId(ctx, yuki?.id ?? '', applied.applicationId, {
        gender: 'woman',
        ethnicity: 'asian',
      }),
    ),
  );
  const stored = await uow.run(tenantId, (tx) => tx.selfIds.all());
  expect(new TextDecoder().decode(stored[0]?.sealed)).not.toContain('woman');
  expect(value(await asSealing('ada', (ctx) => fairness(ctx, 'gender'))).all).toEqual([]);
  expect((await asSealing('adam', (ctx) => fairness(ctx, 'gender'))).ok).toBe(false);

  // J11: an alert sends nothing until confirmed, then each new matching job once.
  const alertMail: { to: string; text: string }[] = [];
  const mailing = {
    ...deps,
    mailer: {
      send: (m: { to: string; text: string }) => {
        alertMail.push(m);
        return Promise.resolve();
      },
    },
  };
  const alertRun = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    uow.run(tenantId, async (tx) => {
      const mail: Outgoing[] = [];
      const ctx = await contextOf(mailing, tx, callerOf('public'), mail);
      const value = await fn(ctx);
      await deliver(mailing, tenantId, mail);
      return value;
    });
  await alertRun((ctx) =>
    subscribeAlert(ctx, { email: 'kai@example.com', query: 'designer', frequency: 'daily' }),
  );
  const confirm = /#confirm\.([\w-]+)/u.exec(alertMail[0]?.text ?? '')?.[1] ?? '';
  expect(await alertRun((ctx) => sendAlertDigests(ctx))).toBe(0);
  value(await alertRun((ctx) => confirmAlert(ctx, confirm)));
  // As if confirmed before the Product Designer job opened.
  await uow.run(tenantId, async (tx) => {
    const held = (await tx.settings.get('job_alerts')) as { lastSentOn: string }[];
    await tx.settings.set(
      'job_alerts',
      held.map((a) => ({ ...a, lastSentOn: '2026-10-01' })),
    );
  });
  expect(await alertRun((ctx) => sendAlertDigests(ctx))).toBe(1);
  expect(await alertRun((ctx) => sendAlertDigests(ctx))).toBe(0);
  const stop = /#stop\.([\w-]+)/u.exec(alertMail.at(-1)?.text ?? '')?.[1] ?? '';
  value(await alertRun((ctx) => stopAlert(ctx, stop)));
  expect(await uow.run(tenantId, (tx) => tx.settings.get('job_alerts'))).toEqual([]);

  // J9: an agency signs in by code, submits once, sees its candidate's stage; a second
  // submission of the same person is refused with the first one's date.
  const agencyId = randomUUID();
  await uow.run(tenantId, (tx) =>
    tx.agencies.save({
      id: agencyId,
      name: 'Talento Madrid',
      contactEmail: 'desk@talento.example',
      fee: { kind: 'percent', basisPoints: 2000 },
      guaranteeDays: 90,
      ownershipMonths: 6,
      active: true,
      jobIds: [jobId],
    }),
  );
  await as('public', async (ctx) => {
    const { code } = value(await requestAgencyCode(ctx, 'Desk@Talento.example'));
    const { token } = value(await openAgencySession(ctx, 'desk@talento.example', code ?? ''));
    const lucia = { jobId, name: 'Lucía Pérez', email: 'lucia@example.com' };
    value(await submitAsAgency(ctx, token, lucia, []));
    const again = await submitAsAgency(ctx, token, lucia, []);
    expect(again.ok ? null : again.error.code).toBe('ALREADY_SUBMITTED');
    const portal = value(await agencyPortal(ctx, token));
    expect(portal.submissions.map((x) => x.candidate)).toEqual(['Lucía Pérez']);
    expect((await agencyPortal(ctx, 'not-a-token')).ok).toBe(false);
  });
  // Pools are the recruiters': an interviewer cannot list who is in them.
  await as('adam', async (ctx) => {
    expect((await poolsScreen(ctx, undefined)).ok).toBe(false);
  });
  await as('ada', async (ctx) => {
    expect((await poolsScreen(ctx, undefined)).ok).toBe(true);
  });

  // §33: another agency sees none of the first one's candidates.
  await uow.run(tenantId, (tx) =>
    tx.agencies.save({
      id: randomUUID(),
      name: 'Other Search',
      contactEmail: 'desk@other.example',
      fee: { kind: 'fixed', amountMinor: 500_000 },
      guaranteeDays: 90,
      ownershipMonths: 6,
      active: true,
      jobIds: [jobId],
    }),
  );
  await as('public', async (ctx) => {
    const { code } = value(await requestAgencyCode(ctx, 'desk@other.example'));
    const { token } = value(await openAgencySession(ctx, 'desk@other.example', code ?? ''));
    expect(value(await agencyPortal(ctx, token)).submissions).toEqual([]);
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
  // R17: a summary keeps only sentences that cite a scorecard; "Hire." is the manager's to say.
  const summary = value(await asWriter((ctx) => summariseDebrief(ctx, applied.applicationId)));
  expect(summary.sentences.map((x) => x.text)).toEqual(['Craft was rated strong.']);

  const offer = await as('ada', async (ctx) => {
    value(await moveApplication(ctx, applied.applicationId, offerStage));
    const drafted = value(
      await composeOffer(ctx, applied.applicationId, {
        terms: place.terms,
        pay: {
          baseMinor: pay,
          currency: place.currency,
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
  // Whatever the country's pack made a condition (a right-to-work check, say) is checked and met.
  await as('ada', async (ctx) => {
    for (const c of (await ctx.tx.prehires.get(applied.applicationId))?.conditions ?? [])
      if (c.state === 'open')
        value(await decidePrehireCondition(ctx, applied.applicationId, c.kind, 'met', null));
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
      country: place.country,
      contractType: place.terms.contractType,
      paymentsPerYear: place.terms.paymentsPerYear,
      ...(place.probationEnd === null ? {} : { probationEnd: place.probationEnd }),
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
