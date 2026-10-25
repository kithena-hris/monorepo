import { randomBytes, randomUUID } from 'node:crypto';
import {
  CalendarDate,
  InboxItem,
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
import { uuidv7 } from '../infrastructure/ids.js';
import { apply, requestCode } from '../application/intake.js';
import { scheduleKnockout } from '../application/knockout-schedule.js';
import { rejectDueKnockouts } from '../application/knockouts.js';
import {
  archiveJob,
  archivedAt,
  createJob,
  deleteJob,
  publishTo,
  saveAd,
  saveJobDetails,
  setPlan,
  moveJobState,
  unarchiveJob,
} from '../application/jobs.js';
import { moveApplication } from '../application/moves.js';
import { stageWork } from '../application/stage-work.js';
import {
  bookFromAvailability,
  linkSlots,
  offerAvailability,
  requestMoreTimes,
  saveScorecard,
  scheduleInterview,
  scheduleScreen,
  selfScheduleLink,
  setInterviewLink,
  setInterviewState,
  slotsFor,
} from '../application/interviews.js';
import {
  candidateAccepts,
  composeOffer,
  offerStart,
  decidePrehireCondition,
  offerForCandidate,
  sendTheOffer,
  submitOfferForApproval,
  uploadSignedContract,
} from '../application/offers.js';
import { candidateByToken, candidatePage } from '../application/privacy.js';
import {
  answerAsk,
  closeAsk,
  proposeSlots,
  requestChange,
  requestInformation,
} from '../application/requests.js';
import {
  decideRequisition,
  saveRequisition,
  submitRequisition,
} from '../application/requisitions.js';
import {
  removeBenefit,
  saveBenefit,
  saveEntity,
  saveGeneralSettings,
  saveLocation,
  saveScorecardTemplate,
  DEFAULT_SETTINGS,
} from '../application/setup.js';
import { catalogueOf, removeCategory, saveCategory } from '../application/catalogue.js';
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
import { fakeAssessments, fakeBackgroundChecks } from '../infrastructure/fake-providers.js';
import {
  refreshAssessment,
  sendAssessment,
  startBackgroundCheck,
} from '../application/providers.js';
import { askForChart } from '../application/chart-ask.js';
import { askAboutJob, planSearch } from '../application/job-assistant.js';
import { summariseDebrief } from '../application/debrief-summary.js';
import { draftAd, draftEmail, suggestQuestions, translateAd } from '../application/writer.js';
import { previewEmail, sendStageExpectations } from '../application/emails.js';
import { jobTerms, saveJobTerms, suggestPay, termsCatalogue } from '../application/job-terms.js';
import { setMyNotifications } from '../application/notify.js';
import { saveAgreement } from '../application/agreements.js';
import { jobsScreen, offerScreen, poolsScreen, recruitingInbox } from '../application/screens.js';
import { reviseContract } from '../application/contract-draft.js';
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
    // Time-ordered, as production's are: moves at the same instant then read back in the order made.
    newId: () => uuidv7(),
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
    // Boards go through the port (§26.1): Google reads the job's page, aggregators the feed.
    expect(value(await publishTo(ctx, jobId, 'xml_feed')).url).toBe(
      'https://jobs.example/feeds/acme.xml',
    );
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

  // R4: the terms in order, each step's choices from the ones before, within the country's law.
  await as('ada', async (ctx) => {
    const where = value(
      await saveJobTerms(ctx, jobId, { entityId, locationId, workMode: 'onsite' }),
    );
    expect(where.options.relationships.map((r) => r.key)).toContain('employee');
    // The region is the workplace's when the pack knows it.
    if (where.options.regions.length > 0) expect(where.options.region).toBe(place.office.region);
    // Hybrid: days on site, set or of the person's choosing; never more set days than the week has.
    const hybrid = value(
      await saveJobTerms(ctx, jobId, {
        workMode: 'hybrid',
        hybridDaysOnsite: 2,
        hybridOnsiteDays: [3, 1],
      }),
    );
    expect(hybrid.terms.hybridOnsiteDays).toEqual([1, 3]);
    const tooMany = await saveJobTerms(ctx, jobId, { hybridOnsiteDays: [1, 2, 3] });
    expect(tooMany.ok ? null : tooMany.error.code).toBe('HYBRID_DAYS');
    const chosen = value(await saveJobTerms(ctx, jobId, { hybridOnsiteDays: null }));
    expect(chosen.terms.hybridOnsiteDays).toBeNull();
    value(await saveJobTerms(ctx, jobId, { workMode: 'onsite' }));
    expect((await saveJobTerms(ctx, jobId, { relationship: 'astronaut' })).ok).toBe(false);
    const work = value(await saveJobTerms(ctx, jobId, { relationship: 'employee' }));
    // The country's catalogue, fetched ahead, lists exactly what the saved terms offer.
    const catalogue = value(await termsCatalogue(ctx, work.options.country ?? ''));
    expect(catalogue.contracts['employee']?.map((t) => t.key)).toEqual(
      work.options.contractTypes.map((t) => t.key),
    );
    expect(catalogue.relationships.map((r) => r.key)).toEqual(
      work.options.relationships.map((r) => r.key),
    );
    const lawful = work.options.contractTypes.find((t) => t.unavailable === null && !t.fixedTerm);
    expect(lawful).toBeDefined();
    const hours = value(
      await saveJobTerms(ctx, jobId, {
        contractType: lawful?.key ?? '',
        workDays: [1, 2, 3, 4, 5],
        dayStart: 9 * 60,
        dayEnd: 17 * 60,
        breakMinutes: 30,
      }),
    );
    expect(hours.options.weeklyMinutes).toBe(5 * 7.5 * 60);
    expect(hours.options.leave?.days).toBeGreaterThanOrEqual(0);
    const below = await saveJobTerms(ctx, jobId, {
      vacationDays: Math.max(0, (hours.options.leave?.days ?? 0) - 1),
    });
    if ((hours.options.leave?.days ?? 0) > 0)
      expect(below.ok ? null : below.error.code).toBe('LEAVE_MIN');
    value(await saveJobTerms(ctx, jobId, { vacationDays: (hours.options.leave?.days ?? 0) + 5 }));
    // Pay: one figure when fixed, never below the legal minimum at these hours, in the entity's currency.
    const floor = hours.options.minimumPayMinor ?? 0;
    const fixed = await saveJobTerms(ctx, jobId, {
      payKind: 'fixed',
      pay: { minMinor: floor + 100_000, maxMinor: floor + 200_000 },
    });
    expect(fixed.ok ? null : fixed.error.code).toBe('PAY_FIXED');
    if (floor > 0) {
      const under = await saveJobTerms(ctx, jobId, { pay: { minMinor: 1, maxMinor: 1 } });
      expect(under.ok ? null : under.error.code).toBe('PAY_MIN');
    }
    value(
      await saveJobTerms(ctx, jobId, {
        payKind: 'range',
        pay: { minMinor: floor + 100_000, maxMinor: floor + 200_000 },
      }),
    );
    expect((await ctx.tx.jobs.get(jobId))?.salary).toMatchObject({
      minMinor: floor + 100_000,
      maxMinor: floor + 200_000,
      period: 'year',
    });
    // The ad says what was chosen: the contract by its legal name, the hours as the week works out.
    const job = await ctx.tx.jobs.get(jobId);
    expect(job?.outline.contractType).toBe(lawful?.label);
    // Benefits: the standard library is every entity's to pick from; a pick is kept in the catalogue.
    const lunch = hours.options.benefits.find((b) => b.id.endsWith(':meal_allowance'));
    expect(lunch?.description).toBe('A monthly budget for lunch.');
    expect(hours.options.categories.find((c) => c.key === 'meal')?.icon).toBe('break');
    value(await saveJobTerms(ctx, jobId, { benefitIds: [lunch?.id ?? ''] }));
    expect((await ctx.tx.benefits.get(lunch?.id ?? ''))?.names['en']).toBe('Meal allowance');
    // A category of the company's own, a benefit of its own in it, and a library one removed.
    const club = value(await saveCategory(ctx, { key: null, name: 'Club life', icon: 'team' }));
    expect((await saveCategory(ctx, { key: null, name: 'Club life', icon: 'team' })).ok).toBe(
      false,
    );
    value(
      await saveBenefit(ctx, {
        id: `${entityId.slice(0, 8)}_book_club`,
        key: 'book_club',
        legalEntityId: entityId,
        category: club.key,
        names: { en: 'Book club' },
        description: 'A book a month, on the company.',
        value: { kind: 'descriptive' },
        eligibility: {
          employmentTypes: null,
          minWeeklyMinutes: null,
          waiting: { kind: 'none' },
          workModes: null,
          locationIds: null,
        },
        statutory: false,
        taxNote: null,
      }),
    );
    expect((await removeCategory(ctx, club.key)).ok).toBe(false);
    const pets = `lib:${entityId}:pet_friendly`;
    value(await removeBenefit(ctx, pets));
    const after = await catalogueOf(ctx, entityId);
    expect([after.some((b) => b.id === pets), after.some((b) => b.key === 'book_club')]).toEqual([
      false,
      true,
    ]);
    // Change where, and what depended on it is asked again.
    const moved = value(await saveJobTerms(ctx, jobId, { entityId: null }));
    expect(moved.terms).toMatchObject({ relationship: null, contractType: null });
    value(
      await saveJobTerms(ctx, jobId, {
        entityId,
        locationId,
        workMode: 'onsite',
        relationship: 'employee',
        contractType: lawful?.key ?? '',
      }),
    );
    // An agreement is picked from the company's list in Settings, never typed on the job.
    const agreed = value(
      await saveAgreement(ctx, {
        id: randomUUID(),
        name: 'Convenio de consultoría',
        country: place.country,
        groups: ['Grupo 1', ' Grupo 1 '],
      }),
    );
    expect(agreed).toMatchObject({ key: 'convenio_de_consultoria', groups: ['Grupo 1'] });
    const madeUp = await saveJobTerms(ctx, jobId, { agreement: { key: 'made_up', group: null } });
    expect(madeUp.ok ? null : madeUp.error.code).toBe('AGREEMENT');
    value(await saveJobTerms(ctx, jobId, { agreement: { key: agreed.key, group: 'Grupo 1' } }));
  });

  // A knockout that rejects on its own: rejected, and told, the next working morning, not at once.
  const { code: kenjiCode } = await as('public', async (ctx) =>
    value(await requestCode(ctx, slug, 'kenji@example.com', 'Kenji Mori')),
  );
  const kenji = await as('public', async (ctx) =>
    value(
      await apply(
        ctx,
        {
          jobId,
          language: 'en',
          answers: { name: 'Kenji Mori', email: 'kenji@example.com', right_to_work: true },
          consent: { application: true, talentPool: false },
          adjustments: null,
          source: { target: 'kithena_jobs' },
          code: kenjiCode,
        },
        [
          {
            field: 'cv',
            fileName: 'kenji.pdf',
            mediaType: 'application/pdf',
            bytes: new TextEncoder().encode('Kenji Mori, designer'),
          },
        ],
      ),
    ),
  );
  const told = await as('ada', (ctx) =>
    scheduleKnockout(ctx, kenji.applicationId, 'Europe/Madrid'),
  );
  expect(told.slice(0, 10) > new Date(now).toISOString().slice(0, 10)).toBe(true);
  expect(await as('ada', (ctx) => rejectDueKnockouts(ctx))).toBe(0);
  const before = now;
  now = Date.parse(told) + 60_000;
  expect(await as('ada', (ctx) => rejectDueKnockouts(ctx))).toBe(1);
  const knocked = await uow.run(tenantId, (tx) => tx.applications.get(kenji.applicationId));
  expect(knocked?.outcome).toBe('rejected');
  const thread = await uow.run(tenantId, (tx) => tx.messages.thread(kenji.candidateId));
  expect(thread.some((m) => m.direction === 'out')).toBe(true);
  expect(
    (await uow.run(tenantId, (tx) => tx.applications.get(applied.applicationId)))?.outcome,
  ).toBe('active');
  now = before;

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
    // A company holiday strikes the day for everyone, and is named for the calendar.
    const onHoliday = value(
      await scheduleScreen(
        ctx,
        applied.applicationId,
        'portfolio',
        Instant.parse('2026-10-19T00:00:00.000Z'),
        {},
        [{ date: '2026-10-19', name: 'Founders’ day' }],
      ),
    );
    expect(onHoliday.slots.filter((t) => t.startsWith('2026-10-19'))).toEqual([]);
    expect(onHoliday.slots.length).toBeGreaterThan(0);
    expect(onHoliday.holidays).toEqual([{ date: '2026-10-19', name: 'Founders’ day' }]);
    // Who runs it is chosen on the screen; anyone in the company can be asked.
    const chosenPanel = value(
      await scheduleScreen(
        ctx,
        applied.applicationId,
        'portfolio',
        Instant.parse('2026-10-19T00:00:00.000Z'),
        {},
        [],
        {},
        [people.sofia],
      ),
    );
    expect(chosenPanel.interviewers).toEqual([people.sofia]);
    expect(chosenPanel.members.some((m) => m.personId === people.marco)).toBe(true);
    // A working week from Time Off bounds the day: 10:00 to 11:00 holds one hour-long slot.
    const short = value(
      await scheduleScreen(
        ctx,
        applied.applicationId,
        'portfolio',
        Instant.parse('2026-10-19T00:00:00.000Z'),
        {},
        [],
        { [people.adam]: { timeZone: 'UTC', week: { '1': [[600, 660]] } } },
      ),
    );
    expect(short.slots.filter((t) => t.startsWith('2026-10-19'))).toEqual([
      '2026-10-19T10:00:00.000Z',
    ]);
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
  // The loop neither side waits on (§10.5, §16.4): times offered and declined, a question
  // answered, a booked time questioned. Each step mails the other side at once.
  const yukiId =
    (await uow.run(tenantId, (tx) => tx.applications.get(applied.applicationId)))?.candidateId ??
    '';
  const mailed: Outgoing[] = [];
  const asMailing = <T>(who: 'ada' | 'public', fn: (ctx: Ctx) => Promise<T>): Promise<T> =>
    uow.run(tenantId, async (tx) => fn(await contextOf(deps, tx, callerOf(who), mailed)));
  const offered = await asMailing('ada', async (ctx) =>
    value(
      await proposeSlots(ctx, applied.applicationId, {
        planKey: 'portfolio',
        times: [
          Instant.parse('2026-10-22T09:00:00.000Z'),
          Instant.parse('2026-10-22T14:00:00.000Z'),
        ],
        place: null,
        videoUrl: null,
        note: null,
        agenda: {
          html: '<p>Your portfolio, then questions.</p>',
          text: 'Your portfolio, then questions.',
        },
      }),
    ),
  );
  expect(mailed.at(-1)?.subject).toMatch(/^Appointment requested/u);
  const notOffered = await asMailing('public', (ctx) =>
    answerAsk(ctx, yukiId, offered.id, {
      time: Instant.parse('2026-10-23T09:00:00.000Z'),
      text: null,
    }),
  );
  expect(notOffered.ok ? null : notOffered.error.code).toBe('NOT_OFFERED');
  // Nothing declined yet; the team is emailed unless a member switched it off.
  expect(mailed.map((m) => m.subject)).not.toContainEqual(
    expect.stringMatching(/needs other times/u),
  );
  await as('ada', async (ctx) => value(await setMyNotifications(ctx, true)));
  const declined = await asMailing('public', async (ctx) =>
    value(await answerAsk(ctx, yukiId, offered.id, { time: null, text: 'Away that week' })),
  );
  expect(declined.state).toBe('answered');
  expect(mailed.map((m) => m.subject)).toContainEqual(expect.stringMatching(/^Received:/u));
  expect(mailed.map((m) => m.subject)).toContainEqual(expect.stringMatching(/needs other times/u));
  // The link: the candidate gives times, the recruiter who sent it chooses in their Inbox, and the
  // invitation carries the where and the agenda chosen when the link was sent.
  const agenda = { html: '<p>Agenda</p>', text: 'Walk us through two projects.' };
  const link = await asMailing('ada', async (ctx) =>
    value(
      await selfScheduleLink(
        ctx,
        applied.applicationId,
        'portfolio',
        {},
        [],
        {},
        {
          place: null,
          videoUrl: null,
          agenda,
        },
      ),
    ),
  );
  expect(mailed.at(-1)?.parts?.action?.label).toBe('Choose my times');
  // The agenda written for this interview of this job is where the next schedule starts.
  expect(
    (
      await as('ada', async (ctx) =>
        value(await scheduleScreen(ctx, applied.applicationId, 'portfolio', undefined)),
      )
    ).agenda?.text,
  ).toBe(agenda.text);
  const linkToken = link.split('#')[1] ?? '';
  const free = await as('public', async (ctx) => value(await linkSlots(ctx, linkToken)));
  expect(free.wanted).toBe(10);
  // The candidate sees whose calendars the times fit: the recruiter who shared it, then the panel.
  expect(free.organiser).not.toBeNull();
  expect(free.interviewers.length).toBe(1);
  const tooFew = await as('public', (ctx) =>
    offerAvailability(ctx, linkToken, free.slots.slice(0, 3) as Instant[]),
  );
  expect(tooFew.ok ? null : tooFew.error.code).toBe('TIMES');
  const first = await asMailing('public', async (ctx) =>
    value(
      await offerAvailability(ctx, linkToken, free.slots.slice(0, 10) as Instant[], 'Asia/Tokyo'),
    ),
  );
  // Thanked with the times laid out by day, in the zone they gave, and a way back to change them.
  const toYuki = () => mailed.findLast((m) => m.to === 'yuki@example.com');
  const thanks = toYuki();
  expect(thanks?.parts?.times?.title).toContain('Asia/Tokyo');
  expect(thanks?.parts?.action?.href).toContain(linkToken);
  const choosing = async () =>
    (await as('ada', (ctx) => recruitingInbox(ctx))).items.filter(
      (i) => i.kind === 'recruiting.choose-time',
    );
  expect((await choosing()).map((i) => i.id)).toEqual([`recruiting:choose-time:${first.id}`]);
  // The shell drops an item that does not parse, so the task must be a valid Inbox item.
  for (const item of await choosing()) {
    const parsed = InboxItem.safeParse(item);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  }

  // Given again through the same link: the times before are shown picked, then replaced, task and all.
  const again = await as('public', async (ctx) => value(await linkSlots(ctx, linkToken)));
  expect(again.chosen).toEqual(first.times);
  const second = await asMailing('public', async (ctx) =>
    value(await offerAvailability(ctx, linkToken, free.slots.slice(2, 12) as Instant[])),
  );
  expect(toYuki()?.subject).toMatch(/^Updated:/u);
  expect((await choosing()).map((i) => i.id)).toEqual([`recruiting:choose-time:${second.id}`]);

  // None works: ask for more. The old link stops, the new one leaves every given time out.
  const more = await asMailing('ada', async (ctx) =>
    value(await requestMoreTimes(ctx, applied.applicationId, second.id, null)),
  );
  expect(await choosing()).toEqual([]);
  expect((await as('public', (ctx) => linkSlots(ctx, linkToken))).ok).toBe(false);
  const moreToken = more.split('#')[1] ?? '';
  const fresh = await as('public', async (ctx) => value(await linkSlots(ctx, moreToken)));
  expect(fresh.excluded).toBe(10);
  expect(fresh.slots.some((t) => second.times.includes(t as Instant))).toBe(false);
  const third = await asMailing('public', async (ctx) =>
    value(await offerAvailability(ctx, moreToken, fresh.slots.slice(0, fresh.wanted) as Instant[])),
  );
  // Booked from the Inbox with nothing but a time: the agenda chosen at the start goes with it.
  const bookedFromLink = await asMailing('ada', async (ctx) =>
    value(
      await bookFromAvailability(ctx, applied.applicationId, third.id, {
        startsAt: third.times[1] as Instant,
      }),
    ),
  );
  expect(bookedFromLink.startsAt).toBe(third.times[1]);
  expect(toYuki()?.text).toContain('Walk us through two projects.');
  expect(toYuki()?.parts?.facts?.map((f) => f.label)).toContain('When');
  // The invitation is attached for the candidate's calendar, addressed to them, not pasted as text.
  const invite = toYuki()?.attachments?.find((a) => a.filename === 'invite.ics');
  expect(Buffer.from(invite?.base64 ?? '', 'base64').toString('utf8')).toContain(
    'mailto:yuki@example.com',
  );
  expect(toYuki()?.text).not.toContain('BEGIN:VCALENDAR');
  // No link was made for it: the team adds one, and the candidate's invitation comes again with it.
  const linked = await asMailing('ada', async (ctx) =>
    value(await setInterviewLink(ctx, bookedFromLink.id, 'https://meet.google.com/abc-defg-hij')),
  );
  expect(linked.videoUrl).toBe('https://meet.google.com/abc-defg-hij');
  expect(toYuki()?.parts?.action?.href).toBe('https://meet.google.com/abc-defg-hij');
  expect(
    Buffer.from(
      toYuki()?.attachments?.find((a) => a.filename === 'invite.ics')?.base64 ?? '',
      'base64',
    ).toString('utf8'),
  ).toContain('LOCATION:https://meet.google.com/abc-defg-hij');
  expect(
    (await as('ada', (ctx) => setInterviewLink(ctx, bookedFromLink.id, 'not a link'))).ok,
  ).toBe(false);
  expect(await choosing()).toEqual([]);
  // The interview already booked for this step was moved, not doubled.
  expect((await uow.run(tenantId, (tx) => tx.interviews.get(interviewId)))?.state).toBe(
    'rescheduled',
  );
  await as('ada', async (ctx) =>
    value(await setInterviewState(ctx, bookedFromLink.id, 'cancelled')),
  );
  // The rest of the hire runs on the first booking: put it back as it was.
  await uow.run(tenantId, async (tx) => {
    const held = await tx.interviews.get(interviewId);
    if (held !== null) await tx.interviews.save({ ...held, state: 'scheduled' });
  });
  // At any stage, what to expect, from the job's own plan, edited in the composer and sent at once.
  const expect_ = await as('ada', async (ctx) =>
    value(
      await previewEmail(ctx, applied.applicationId, {
        purpose: 'stage_expectations',
        templateId: null,
        fill: true,
      }),
    ),
  );
  expect(expect_.body).toContain('Portfolio review, 60 minutes');
  await asMailing('ada', async (ctx) =>
    value(await sendStageExpectations(ctx, applied.applicationId, expect_)),
  );
  expect(toYuki()?.parts?.heading).toMatch(/^What to expect/u);
  const question = await asMailing('ada', async (ctx) =>
    value(
      await requestInformation(ctx, applied.applicationId, {
        label: 'Your notice period',
        detail: null,
      }),
    ),
  );
  const replied = await asMailing('public', async (ctx) =>
    value(await answerAsk(ctx, yukiId, question.id, { time: null, text: 'One month' })),
  );
  expect(replied.answer?.text).toBe('One month');
  const change = await asMailing('public', async (ctx) =>
    value(await requestChange(ctx, yukiId, interviewId, 'A clash at work')),
  );
  expect(change.kind).toBe('change');
  await as('ada', async (ctx) => value(await closeAsk(ctx, applied.applicationId, change.id)));
  const page = await as('public', async (ctx) =>
    candidatePage(ctx, (await ctx.tx.candidates.get(yukiId)) as never),
  );
  expect(page.applications[0]?.requests.map((r) => [r.kind, r.state])).toEqual([
    ['change', 'closed'],
    ['info', 'answered'],
    ['availability', 'answered'],
    ['availability', 'closed'],
    ['availability', 'closed'],
    ['slots', 'answered'],
  ]);

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
  // Without a key every AI feature says it is off, and nothing else changes (§22.3).
  const off = await as('ada', (ctx) => assessMatrix(ctx, applied.applicationId));
  expect(off.ok ? null : off.error.code).toBe('AI_OFF');
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
                        tone: 'positive',
                        direction: 'The panel leans towards the candidate on craft.',
                        suggestion: 'proceed',
                        why: 'The one scorecard in rates craft strongly and says strong yes.',
                      })
                    : prompt.instruction.startsWith('You estimate the market pay')
                      ? JSON.stringify({
                          low: 70_000,
                          median: 60_000,
                          high: 80_250,
                          basis: 'Typical published ranges for the role there.',
                          confidence: 'medium',
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
                              markdown:
                                '## The role\n\nDesign with us. You earn €99,000 a year.\n\n- Ship weekly',
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
  // The draft is rich text, the title the job's own, and no amount of money the model wrote survives.
  const drafted = value(
    await asWriter((ctx) =>
      draftAd(ctx, jobId, { language: 'en', intake: '', words: 200, tone: 'warm' }),
    ),
  );
  expect(drafted.html).toContain('<ul><li><p>Ship weekly</p></li></ul>');
  expect(drafted.html).not.toContain('99,000');
  expect(drafted.title).toBe(
    await uow.run(tenantId, async (tx) => (await tx.jobs.get(jobId))?.title),
  );
  // R4: the model estimates the market pay; the domain sorts it, rounds it and keeps it lawful.
  const fixedPay = value(await asWriter((ctx) => suggestPay(ctx, jobId, 'fixed')));
  expect(fixedPay.minMinor).toBe(fixedPay.maxMinor);
  const rangePay = value(await asWriter((ctx) => suggestPay(ctx, jobId, 'range')));
  expect(rangePay.minMinor).toBeLessThanOrEqual(fixedPay.minMinor);
  expect(rangePay.maxMinor).toBeGreaterThanOrEqual(fixedPay.maxMinor);
  expect(rangePay.maxMinor % 50_000).toBe(0);
  // The estimate is kept with the job, to show under the pay and go back to.
  const keptEstimate = await asWriter(async (ctx) => {
    const job = await ctx.tx.jobs.get(jobId);
    return job === null ? null : (await jobTerms(ctx, job)).terms.payEstimate;
  });
  expect(keptEstimate?.medianMinor).toBe(fixedPay.minMinor);
  // Where the setup was left, kept on its own.
  value(await asWriter((ctx) => saveJobTerms(ctx, jobId, { setupStep: 'pay' })));
  expect(
    await asWriter(async (ctx) => {
      const job = await ctx.tx.jobs.get(jobId);
      return job === null ? null : (await jobTerms(ctx, job)).terms.setupStep;
    }),
  ).toBe('pay');
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
  const planned = value(await planSearch(writing.model, 'remote jobs in Spain')).filters;
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
      send: (m: { to: string; text: string; parts?: { action?: { href: string } | null } }) => {
        // The link is the email's button now; its plain text carries it too.
        alertMail.push({ to: m.to, text: `${m.text}\n${m.parts?.action?.href ?? ''}` });
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
  // R17: a summary keeps only sentences that cite a scorecard; "Hire." is not a cited sentence.
  const summary = value(await asWriter((ctx) => summariseDebrief(ctx, applied.applicationId)));
  expect(summary.sentences.map((x) => x.text)).toEqual(['Craft was rated strong.']);
  // Its reading of the room is a suggestion with a why; the recruiter or hiring manager decides.
  expect(summary).toMatchObject({ tone: 'positive', suggestion: 'proceed' });
  expect(summary.why).toContain('strong yes');

  const offer = await as('ada', async (ctx) => {
    value(await moveApplication(ctx, applied.applicationId, offerStage));
    // Arriving at the offer stage opens a draft filled from the job. Going back withdraws it,
    // and coming back is a new offer, never the old one reopened.
    const opened = (await stageWork(ctx, applied.applicationId)).offerId;
    expect(opened).not.toBeNull();
    value(
      await moveApplication(ctx, applied.applicationId, interviewStage, {
        interviewType: 'portfolio',
      }),
    );
    expect((await stageWork(ctx, applied.applicationId)).offerId).toBeNull();
    expect((await ctx.tx.offers.get(opened ?? ''))?.state).toBe('withdrawn');
    value(await moveApplication(ctx, applied.applicationId, offerStage));
    const reopened = (await stageWork(ctx, applied.applicationId)).offerId;
    expect(reopened).not.toBeNull();
    expect(reopened).not.toBe(opened);
    // A new offer comes filled from the job: its terms, the law's notice, the middle of the ad's range.
    const started = value(await offerStart(ctx, applied.applicationId));
    const ad = (await ctx.tx.jobs.get(jobId))?.salary ?? null;
    expect(started.advertised).toEqual(ad);
    // Its benefits are the job's, as its ad shows them.
    expect(started.input.benefitIds).toEqual((await ctx.tx.jobs.get(jobId))?.benefitIds);
    expect(started.input.pay.baseMinor).toBe(
      Math.round(((ad?.minMinor ?? 0) + (ad?.maxMinor ?? 0)) / 2),
    );
    expect(started.input.terms).toMatchObject({ workMode: 'onsite', weeklyMinutes: 5 * 7.5 * 60 });
    // The region and the agreement the job carries go with it.
    expect(started.input.terms.agreement).toEqual({
      key: 'convenio_de_consultoria',
      group: 'Grupo 1',
    });
    if (started.input.terms.region !== null)
      expect(started.input.terms.region).toBe(place.office.region);
    expect(typeof started.input.terms.contractType).toBe('string');
    expect(started.input.terms.noticeEmployer).toBeDefined();
    expect(started.input.terms.annualPayMinor).toBe(started.input.pay.baseMinor);
    // The prefilled draft opens as it was made.
    const prefilled = value(await composeOffer(ctx, applied.applicationId, started.input));
    expect(value(await offerScreen(ctx, prefilled.id))).toMatchObject({
      offer: { id: prefilled.id },
    });
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
    // The approver's page reads the resolved terms themselves, not wrapped with their warnings.
    const read = value(await offerScreen(ctx, drafted.id)) as {
      checked: { terms: { contractType?: unknown } | null } | null;
    };
    expect(typeof read.checked?.terms?.contractType).toBe('string');
    expect(value(await submitOfferForApproval(ctx, drafted.id)).state).toBe('approved');
    return value(await sendTheOffer(ctx, drafted.id));
  });

  // Yuki accepts on her page; Ada uploads the signed contract.
  const token = applied.portalUrl.split('#')[1] ?? '';
  await as('public', async (ctx) => {
    const candidate = await candidateByToken(ctx, token);
    expect(candidate?.email).toBe('yuki@example.com');
    const read = value(await offerForCandidate(ctx, candidate?.id ?? '', offer.id));
    // The candidate reads the contract by its name in the country's pack, with the law that applies.
    expect(read.setting.contract?.contract).toEqual(expect.any(String));
    // Its own name, without the English gloss, and what it means said under it.
    expect(read.setting.contract?.contract).not.toContain('(');
    expect(read.setting.contract?.about).toEqual(expect.any(String));
    expect(read.setting.contract?.terms?.contractType).toEqual(expect.any(String));
    expect(read.setting.contract?.rules.length).toBeGreaterThan(0);
  });
  // Accepted with the company's host known, as identity announces it: the team's email opens the contract there.
  await uow.run(tenantId, (tx) =>
    tx.settings.set('host', { slug: 'acme-host', asOf: '2026-01-01T00:00:00.000Z' }),
  );
  const chatting: Deps = {
    ...deps,
    chat: { token: 't', appBase: 'https://{slug}.app.example', send: () => Promise.resolve() },
  };
  await uow.run(tenantId, async (tx) => {
    const ctx = await contextOf(chatting, tx, callerOf('public'), mailed);
    const candidate = await candidateByToken(ctx, token);
    const read = value(await offerForCandidate(ctx, candidate?.id ?? '', offer.id));
    expect(
      value(await candidateAccepts(ctx, candidate?.id ?? '', offer.id, read.hash, '203.0.113.9'))
        .state,
    ).toBe('accepted');
  });
  const toTeam = mailed.findLast((m) => m.subject.includes('accepted the offer'));
  expect(toTeam?.parts?.action?.href).toBe(
    `https://acme-host.app.example/recruiting/offers/${offer.id}/contract`,
  );
  // The contract changed by asking: the model reads it without a name, and the names come back.
  let read: string | null = null;
  const revising: Deps = {
    ...deps,
    model: {
      name: 'fake',
      complete: (_, prompt) => {
        read = JSON.stringify(prompt.context);
        return Promise.resolve(
          JSON.stringify({
            reply: 'Added a clause on working from home.',
            body: `${String(prompt.context['contract'])}\n\n9. Remote work\n[[EMPLOYEE]] may work from home.\nSignature: ____`,
          }),
        );
      },
    },
  };
  const revised = await uow.run(tenantId, async (tx) =>
    value(
      await reviseContract(
        await contextOf(revising, tx, callerOf('ada')),
        offer.id,
        '1. Parties\nAcme and Yuki Sato agree.',
        'Add a clause on working from home',
      ),
    ),
  );
  expect(read).not.toContain('Yuki');
  expect(revised.body).toContain('Yuki Sato may work from home.');
  expect(revised.body).not.toContain('Signature');
  // And a task in the Inbox, with the same way to the contract, until the contract is out.
  const toCreate = async () =>
    (await as('marco', (ctx) => recruitingInbox(ctx))).items.filter(
      (i) => i.kind === 'recruiting.create-contract',
    );
  const task = (await toCreate())[0];
  expect(task?.link).toBe(`/recruiting/offers/${offer.id}/contract`);
  expect(InboxItem.safeParse(task).success).toBe(true);
  // Accepted is the contract stage: the contract is prepared and signed there, and the signature hires.
  await as('ada', async (ctx) => {
    const app = await ctx.tx.applications.get(applied.applicationId);
    const stages = await ctx.tx.jobs.stages(app?.jobId ?? '');
    expect(app?.outcome).toBe('active');
    expect(stages.find((s) => s.id === app?.history.at(-1)?.to)?.category).toBe('contract');
  });
  await as('ada', async (ctx) => {
    const contract = await ctx.tx.contracts.forOffer(offer.id);
    expect(contract?.route).toBe('upload');
    const candidate = await ctx.tx.candidates.byEmail('yuki@example.com');
    const fileId = (await ctx.tx.files.of(candidate?.id ?? ''))[0]?.id ?? '';
    value(await uploadSignedContract(ctx, offer.id, fileId, CalendarDate.parse('2026-10-20')));
    const app = await ctx.tx.applications.get(applied.applicationId);
    expect(app?.outcome).toBe('hired');
  });
  expect(await toCreate()).toEqual([]);
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

  // §15.3, §17.2: providers through their ports. A check waits for the offer and the law.
  const providing = {
    ...deps,
    assessmentProvider: fakeAssessments(),
    backgroundChecks: fakeBackgroundChecks(),
  };
  const asProviding = <T>(fn: (ctx: Ctx) => Promise<T>) =>
    uow.run(tenantId, async (tx) => fn(await contextOf(providing, tx, callerOf('ada'))));
  value(await asProviding((ctx) => sendAssessment(ctx, applied.applicationId, 'design')));
  expect(
    value(await asProviding((ctx) => refreshAssessment(ctx, applied.applicationId))).scoreBp,
  ).toBe(7_200);
  const check = await asProviding((ctx) => startBackgroundCheck(ctx, applied.applicationId));
  expect(check.ok ? 'started' : check.error.code).toBe(
    place.country === 'ES' || place.country === 'DE' ? 'CHECK_NOT_ALLOWED' : 'started',
  );

  // The jobs list: a job someone applied to is archived, never deleted; an empty draft is deleted.
  await as('ada', async (ctx) => {
    const refused = await deleteJob(ctx, jobId);
    expect(refused.ok ? null : refused.error.code).toBe('HAS_APPLICATIONS');
    value(await archiveJob(ctx, jobId));
    const listed = (await jobsScreen(ctx)) as {
      jobs: { id: string; archivedAt: string | null; may: { delete: boolean } }[];
    };
    expect(listed.jobs.find((j) => j.id === jobId)).toMatchObject({ may: { delete: false } });
    expect(listed.jobs.find((j) => j.id === jobId)?.archivedAt).not.toBeNull();
    value(await unarchiveJob(ctx, jobId));
    expect(await archivedAt(ctx, jobId)).toBeNull();
    const draftId = randomUUID();
    value(
      await createJob(ctx, {
        id: draftId,
        title: 'A draft nobody applied to',
        internalTitle: 'Draft',
        requisitionIds: [requisitionId],
        entityId,
        locationIds: [locationId],
        department: 'Design',
        workMode: 'onsite',
        openings: 1,
        languages: ['en'],
        hiringManagerId: people.marco,
      }),
    );
    expect(value(await deleteJob(ctx, draftId)).id).toBe(draftId);
    expect(await ctx.tx.jobs.get(draftId)).toBeNull();
  });
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
