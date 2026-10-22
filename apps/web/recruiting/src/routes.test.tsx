import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import manifest from '../public/routes.json';
import * as screens from './index';
import { axeViolations } from './test/axe';
import type {
  AnalyticsData,
  BoardData,
  CandidateData,
  DebriefData,
  HomeData,
  JobData,
  KitData,
  OffersData,
  PipelineData,
  Requisition,
  SettingsData,
  TermsCatalogue,
} from './types';
import { stillPending, viewOf } from './terms-view';

const ready = <T,>(data: T) => ({ status: 'ready' as const, data });
const routes = new Set(manifest.routes.map((r) => r.path));

describe('routes.json', () => {
  it('points every route at a screen index.ts exports', () => {
    const exported = new Set(Object.keys(screens));
    expect(manifest.routes.filter((r) => !exported.has(r.component))).toEqual([]);
  });

  it('lists every place and owned path as a route of its own', () => {
    const places: readonly { path: string; owns?: readonly string[] }[] = [
      ...manifest.sections,
      ...manifest.settings,
    ];
    expect(
      places.flatMap((p) => [p.path, ...(p.owns ?? [])]).filter((p) => !routes.has(p)),
    ).toEqual([]);
  });
});

const home: HomeData = {
  viewer: { personId: 'p-ada', admin: true, name: 'Ada Lovelace' },
  company: 'Acme',
  requisitionsOn: true,
  tasks: [
    {
      kind: 'approve_requisition',
      id: 'r1',
      title: 'Approve the requisition: Platform engineer',
      due: null,
    },
  ],
  jobs: [
    {
      id: 'j1',
      title: 'Senior Backend Engineer (m/w/d)',
      state: 'open',
      department: 'Engineering',
      openings: 2,
      hired: 0,
      counts: {
        total: 12,
        active: 10,
        newThisWeek: 3,
        byStage: [
          { stageId: 's1', name: 'Applied', category: 'applied', count: 6 },
          { stageId: 's2', name: 'Interview', category: 'interview', count: 4 },
        ],
      },
    },
  ],
};

describe('R1, home', () => {
  it('shows the tasks first and each job with its pipeline', async () => {
    const { container } = render(<screens.Home load={ready(home)} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Hello, Ada' })).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Approve the requisition: Platform engineer' })
        .getAttribute('href'),
    ).toBe('/recruiting/requisitions/r1/approve');
    expect(
      screen.getByRole('link', { name: 'Senior Backend Engineer (m/w/d)' }).getAttribute('href'),
    ).toBe('/recruiting/jobs/j1');
    expect(await axeViolations(container)).toEqual([]);
  });
});

const pipeline: PipelineData = {
  job: {
    id: 'j1',
    title: 'Senior Backend Engineer (m/w/d)',
    state: 'open',
    onKithenaJobs: false,
    publicUrl: 'https://jobs.example/acme/x',
  },
  stages: [
    { id: 's1', name: 'Applied', candidateName: 'Received', category: 'applied', automations: [] },
    {
      id: 's2',
      name: 'Interview',
      candidateName: 'Interviews',
      category: 'interview',
      automations: [],
    },
    { id: 's3', name: 'Offer', candidateName: 'Offer', category: 'offer', automations: [] },
    { id: 's4', name: 'Hired', candidateName: 'Hired', category: 'hired', automations: [] },
  ],
  cards: [
    {
      applicationId: 'a1',
      candidateId: 'c1',
      name: 'Yuki Sato',
      stageId: 's2',
      outcome: 'active',
      daysInStage: 4,
      flagged: false,
      duplicate: false,
      source: 'careers_page',
      appliedAt: '2026-10-02T09:00:00Z',
      score: null,
      unread: 1,
      nextInterview: null,
      lastMoveId: 'm1',
    },
    {
      applicationId: 'a2',
      candidateId: 'c2',
      name: 'Tom Becker',
      stageId: 's1',
      outcome: 'active',
      daysInStage: 6,
      flagged: true,
      duplicate: false,
      source: 'referral',
      appliedAt: '2026-10-05T09:00:00Z',
      score: null,
      unread: 0,
      nextInterview: null,
      lastMoveId: 'm2',
    },
  ],
  may: ['pipeline.view', 'pipeline.move'],
  rejectionReasons: ['not_qualified', 'better_candidate'],
  templates: [],
  pools: [],
};

describe('R10, the pipeline', () => {
  it('lays candidates out by stage, with a knockout to review', async () => {
    const { container } = render(<screens.Pipeline load={ready(pipeline)} />);
    expect(screen.getByRole('link', { name: 'Yuki Sato' }).getAttribute('href')).toBe(
      '/recruiting/candidates/c1',
    );
    expect(screen.getByText('Knockout to review')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('switches to the table from the address', () => {
    render(<screens.Pipeline load={ready(pipeline)} search={{ view: 'table' }} />);
    expect(screen.getByRole('checkbox', { name: 'Select Yuki Sato' })).toBeTruthy();
  });
});

const requisition: Requisition = {
  id: 'r1',
  title: 'Platform engineer',
  orgUnitId: null,
  hiringManagerId: 'p-ada',
  hiringManager: 'Ada Lovelace',
  legalEntityId: null,
  locationIds: [],
  openings: 2,
  filled: 0,
  targetStart: null,
  reason: 'growth',
  replacesPersonId: null,
  budget: null,
  justification: 'The platform team doubles next year.',
  state: 'pending_approval',
  approval: { step: 1, steps: 2, waitingOn: ['p-ada'], changes: [], mine: true },
};

describe('R2, requisitions', () => {
  it('sends an approver to the approval, filtered in the address', async () => {
    const { container } = render(<screens.Requisitions load={ready([requisition])} />);
    expect(screen.getByRole('link', { name: 'Platform engineer' }).getAttribute('href')).toBe(
      '/recruiting/requisitions/r1/approve',
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

const job: JobData = {
  job: {
    id: 'j1',
    internalTitle: 'Backend engineer II',
    title: 'Senior Backend Engineer (m/w/d)',
    requisitionIds: [],
    department: 'Engineering',
    countries: ['DE'],
    workMode: 'hybrid',
    salaryShown: true,
    languages: ['de', 'en'],
    internalOnly: false,
    confidential: false,
    openings: 2,
    hired: 0,
    targetHireDate: null,
    state: 'open',
    entityId: null,
    locationIds: [],
    slug: 'senior-backend-engineer',
    outline: { contractType: 'permanent', hours: 'full_time', seniority: 'senior' },
    salary: { minMinor: 7_000_000, maxMinor: 8_500_000, currency: 'EUR', period: 'year' },
    searchable: true,
    benefitIds: ['lib:e1:meal_allowance'],
    scorecardTemplateId: null,
  },
  may: [],
  team: [],
  stages: [],
  form: null,
  ads: [
    {
      language: 'de',
      title: 'Senior Backend Engineer (m/w/d)',
      html: '<p>Wir suchen einen jungen Kollegen.</p>',
      plain: 'Wir suchen einen jungen Kollegen.',
      checks: [
        {
          code: 'age',
          severity: 'error',
          message: 'Age is not a requirement (AGG §1).',
          source: 'DE',
          match: { text: 'jungen', index: 15, in: 'body' },
        },
      ],
    },
  ],
  preview: 'https://jobs.example/preview/acme/token',
  targets: [],
  boards: [],
  chat: null,
  criteria: [],
  plan: [],
  counts: { total: 0, active: 0, newThisWeek: 0, byStage: [] },
  locations: [],
  orgUnits: [],
  entities: [],
  questionnaires: [],
  scorecards: [],
  benefits: [],
  members: [],
  terms: {
    entityId: null,
    locationId: null,
    workMode: 'hybrid',
    hybridDaysOnsite: null,
    hybridOnsiteDays: null,
    relationship: null,
    contractType: null,
    fixedTermReason: null,
    workDays: [],
    dayStart: null,
    dayEnd: null,
    breakMinutes: 60,
    vacationDays: null,
    payKind: null,
    payEstimate: null,
    setupStep: null,
    benefitIds: [],
  },
  options: {
    country: null,
    entities: [],
    locations: [],
    places: [],
    relationships: [],
    contractTypes: [],
    fixedTermReasons: [],
    currency: null,
    minimumPayMinor: null,
    maxWeeklyMinutes: null,
    fullTimeWeeklyMinutes: null,
    weeklyMinutes: null,
    hours: null,
    leave: null,
    benefits: [
      {
        id: 'lib:e1:meal_allowance',
        name: 'Meal allowance',
        description: 'A monthly budget for lunch.',
        category: 'meal',
        statutory: false,
      },
      {
        id: 'lib:e1:gym',
        name: 'Gym or sports membership',
        description: 'A membership, paid or subsidised.',
        category: 'wellbeing',
        statutory: false,
      },
    ],
    categories: [
      { key: 'meal', name: 'Food', icon: 'break', custom: false },
      { key: 'wellbeing', name: 'Wellbeing', icon: 'favourite', custom: false },
    ],
    reviewed: true,
  },
};

describe('R4–R7, a job’s setup', () => {
  it('shows the ad as a candidate reads it, every part pressed to edit it', async () => {
    const { container } = render(
      <screens.JobSetup
        load={ready({ ...job, company: { name: 'Meridian Freight', logoUrl: null } })}
        params={{ id: 'j1' }}
      />,
    );
    // Under the company's name, not the product's.
    expect(screen.getByText('Meridian Freight')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit the title' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Edit the pay' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Edit the workplace' })).toBeTruthy();
    // The chosen benefits, by category with its name, each with its line.
    expect(screen.getByRole('heading', { name: 'Food' })).toBeTruthy();
    expect(screen.getByText('A monthly budget for lunch.')).toBeTruthy();
    expect(screen.queryByText('Gym or sports membership')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Only your team sees this' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('edits one part of the ad on its own, from the preview', () => {
    render(<screens.JobSetup load={ready(job)} params={{ id: 'j1' }} search={{ edit: 'title' }} />);
    expect(screen.getByRole('dialog', { name: 'Title' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /^Job title/u })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.queryByText(/Step \d of/u)).toBeNull();
  });

  it('shows the ad’s checks that block publishing, in the ad’s sheet', () => {
    render(<screens.JobSetup load={ready(job)} params={{ id: 'j1' }} search={{ edit: 'ad' }} />);
    expect(screen.getByText('1 block publishing')).toBeTruthy();
    expect(screen.getByText('“jungen”')).toBeTruthy();
  });

  it('walks a new job through its steps on a page of its own', async () => {
    render(<screens.JobSetup load={ready(job)} params={{ id: 'j1' }} search={{ setup: '1' }} />);
    expect(screen.getByRole('dialog', { name: /Set up/u })).toBeTruthy();
    expect(screen.getByText('Step 1 of 8')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What is the job?' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /^Job title/u })).toBeTruthy();
    // No step list: the foot says where you are.
    expect(screen.queryByRole('navigation', { name: 'Set-up steps' })).toBeNull();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('offers benefits as tiles by category, the chosen ones ticked', async () => {
    render(
      <screens.JobSetup
        load={ready({
          ...job,
          terms: { ...job.terms, entityId: 'e1', benefitIds: ['lib:e1:meal_allowance'] },
        })}
        params={{ id: 'j1' }}
        search={{ setup: '1', step: 'benefits' }}
      />,
    );
    expect(screen.getByRole('group', { name: 'Food' })).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Meal allowance' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen
        .getByRole('checkbox', { name: 'Gym or sports membership' })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('puts the hiring team and the criteria on one page, a criterion with room to write it', () => {
    render(
      <screens.JobSetup
        load={ready(job)}
        params={{ id: 'j1' }}
        search={{ setup: '1', step: 'hiring' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Who hires, and for what?' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Hiring team' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'A criterion' }).tagName).toBe('TEXTAREA');
    // Kept when the page moves on: no separate save on this page.
    expect(screen.queryByRole('button', { name: 'Save criteria' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save team' })).toBeNull();
  });

  it('shows the title in the bar as it is typed', () => {
    render(<screens.JobSetup load={ready(job)} params={{ id: 'new' }} />);
    fireEvent.change(screen.getByRole('textbox', { name: /^Job title/u }), {
      target: { value: 'Staff designer' },
    });
    expect(screen.getByRole('dialog', { name: 'Set up Staff designer' })).toBeTruthy();
  });

  it('opens where it was left last time', () => {
    render(
      <screens.JobSetup
        load={ready({ ...job, terms: { ...job.terms, setupStep: 'process' } })}
        params={{ id: 'j1' }}
        search={{ setup: '1' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'How do they apply and interview?' })).toBeTruthy();
    expect(screen.getByText('Step 7 of 8')).toBeTruthy();
  });

  it('lets a hybrid week have set days on site or any the person chooses', () => {
    render(
      <screens.JobSetup
        load={ready({
          ...job,
          terms: {
            ...job.terms,
            entityId: 'e1',
            locationId: 'l1',
            workMode: 'hybrid',
            hybridDaysOnsite: 2,
            hybridOnsiteDays: [1],
          },
        })}
        params={{ id: 'j1' }}
        search={{ setup: '1', step: 'where' }}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Set days' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Mon' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('1 of 2 chosen.')).toBeTruthy();
  });

  it('ticks each part of the first page as it is filled, the start date included', () => {
    render(
      <screens.JobSetup
        load={ready({
          ...job,
          job: {
            ...job.job,
            department: 'Engineering',
            targetHireDate: '2026-12-01',
            outline: { ...job.job.outline, seniority: 'senior' },
          },
        })}
        params={{ id: 'j1' }}
        search={{ setup: '1' }}
      />,
    );
    const parts = within(screen.getByRole('list', { name: 'On this page' }));
    expect(parts.getAllByText('Answered')).toHaveLength(3);
  });

  it('starts a new job on the same page, with its title', async () => {
    render(<screens.JobSetup load={ready(job)} params={{ id: 'new' }} />);
    expect(screen.getByRole('dialog', { name: 'New job' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What is the job?' })).toBeTruthy();
    // The whole first page, its parts unfolding in turn: the team and level once there is a title.
    expect(screen.queryByRole('region', { name: 'Team and level' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: /^Job title/u }), {
      target: { value: 'Staff designer' },
    });
    expect(screen.getByRole('region', { name: 'Team and level' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Openings and start' })).toBeNull();
    expect(screen.getByText('Step 1 of 8')).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('asks for the workplace before the work type, and the work type before the contract', () => {
    render(
      <screens.JobSetup
        load={ready(job)}
        params={{ id: 'j1' }}
        search={{ setup: '1', step: 'contract' }}
      />,
    );
    // Nothing here can be asked before the workplace is set: the page says so.
    expect(screen.getByText('This page follows from the one before')).toBeTruthy();
  });
});

const candidate: CandidateData = {
  candidate: { id: 'c1', name: 'Yuki Sato', email: 'yuki@example.com', tags: [] },
  files: [],
  notes: [],
  messages: [],
  consents: [],
  pools: [],
  rejectionReasons: ['not_qualified'],
  templates: [],
  allPools: [],
  applications: [
    {
      applicationId: 'a1',
      job: { id: 'j1', title: 'Senior Backend Engineer (m/w/d)' },
      stageId: 's1',
      stages: pipeline.stages,
      reached: 'interview',
      outcome: 'active',
      rejection: null,
      source: 'careers_page',
      flagged: false,
      answers: {},
      adjustments: null,
      history: [],
      interviews: [],
      asks: [],
      scorecards: [],
      offers: [],
      prehire: null,
      references: [],
      may: ['pipeline.move'],
    },
  ],
};

describe('R11, a candidate', () => {
  it('shows each application beside the profile', async () => {
    const { container } = render(
      <screens.Candidate load={ready(candidate)} params={{ id: 'c1' }} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Yuki Sato' })).toBeTruthy();
    expect(screen.getByText('Senior Backend Engineer (m/w/d)')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

const interview = {
  id: 'i1',
  applicationId: 'a1',
  planKey: 'technical',
  title: 'Technical interview',
  startsAt: '2026-10-16T08:00:00Z',
  minutes: 60,
  interviewerIds: ['p-adam'],
  state: 'completed' as const,
  place: null,
  videoUrl: 'https://meet.example.com/abc',
};

describe('R15, the kit and scorecard', () => {
  const kit: KitData = {
    interview,
    competencies: [
      {
        key: 'system_design',
        name: 'System design',
        description: 'Designs services that stay correct under failure.',
        questions: ['Walk me through making a ledger idempotent.'],
      },
    ],
    scorecards: [],
    candidate: { id: 'c1', name: 'Yuki Sato' },
    job: { id: 'j1', title: 'Senior Backend Engineer (m/w/d)' },
    names: { 'p-adam': 'Adam Novak' },
    me: 'p-adam',
  };

  it('rates each competency on four labelled anchors, and hides the others until submitted', async () => {
    const { container } = render(<screens.Kit load={ready(kit)} params={{ id: 'i1' }} />);
    expect(screen.getByRole('radiogroup', { name: 'System design' })).toBeTruthy();
    expect(screen.getAllByRole('radio', { name: '4 · Strong yes' }).length).toBe(2);
    expect(screen.getByText('Hidden until you submit')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('R17, the debrief', () => {
  const debrief: DebriefData = {
    rows: [
      {
        competency: 'on_call',
        average: '3.00',
        ratings: [
          { interviewerId: 'p-adam', rating: 4 },
          { interviewerId: 'p-lina', rating: 2 },
        ],
        disagreement: true,
      },
    ],
    recommendations: { strong_no: 0, no: 0, yes: 1, strong_yes: 1 },
    submitted: 2,
    expected: 2,
    competencies: [{ key: 'on_call', name: 'On call' }],
    names: { 'p-adam': 'Adam Novak', 'p-lina': 'Lina Park' },
    candidate: { id: 'c1', name: 'Yuki Sato' },
    job: { id: 'j1', title: 'Senior Backend Engineer (m/w/d)' },
    decider: false,
  };

  it('shows Recruiting’s average and flags a two-point disagreement', async () => {
    const { container } = render(<screens.Debrief load={ready(debrief)} params={{ id: 'a1' }} />);
    expect(screen.getByText('3.00')).toBeTruthy();
    expect(screen.getByText('Disagree by 2+')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record decision' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('offers', () => {
  const offers: OffersData = {
    rows: [
      {
        id: 'o1',
        state: 'pending_approval',
        candidate: 'Yuki Sato',
        job: 'Senior Backend Engineer (m/w/d)',
        startDate: '2027-02-01',
        expiresOn: '2026-10-24',
        baseMinor: 8_600_000,
        currency: 'EUR',
        needsMe: true,
      },
    ],
  };

  it('sends an approver to the approval', async () => {
    const { container } = render(<screens.Offers load={ready(offers)} />);
    expect(screen.getByRole('link', { name: 'Yuki Sato' }).getAttribute('href')).toBe(
      '/recruiting/offers/o1/approve',
    );
    expect(screen.getByText('€86,000')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('R23, analytics', () => {
  const analytics: AnalyticsData = {
    overview: {
      openJobs: 5,
      applications: 120,
      hires: 4,
      offersOut: 2,
      funnel: [
        { category: 'applied', count: 120, ofPrevious: null },
        { category: 'interview', count: 30, ofPrevious: '25.0' },
      ],
      hiresByMonth: [{ month: '2026-09', hires: 4 }],
      timeToHire: { median: 34, p85: 50 },
      sources: [
        { key: 'careers_page', value: 80, n: 80, suppressed: false },
        { key: 'agency', value: null, n: 3, suppressed: true },
      ],
      rejectionReasons: [],
    },
    speed: [],
    timeInStage: [],
    offers: { sent: 5, accepted: 4, declined: 1, rate: '80' },
    filters: { period: 'last_90_days' },
  };

  it('opens on the overview, and says when a small group is withheld', async () => {
    const { container } = render(
      <screens.Analytics load={ready(analytics)} search={{ dashboard: 'sources' }} />,
    );
    expect(screen.getByText('1 group under five people withheld.')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('R24: opens one tile with the rows behind it, and goes back to its dashboard', async () => {
    const { container } = render(
      <screens.AnalyticsTile
        load={ready(analytics)}
        params={{ id: 'sources' }}
        search={{ period: 'this_year' }}
      />,
    );
    expect(screen.getAllByRole('cell', { name: '80' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Back to sources').getAttribute('href')).toBe(
      '/recruiting/analytics?period=this_year&dashboard=sources',
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('R8, the internal board', () => {
  const board: BoardData = {
    jobs: [
      {
        id: 'j1',
        title: 'Senior Backend Engineer (m/w/d)',
        department: 'Engineering',
        workMode: 'hybrid',
        slug: 'senior-backend',
      },
    ],
    referrals: [
      {
        id: 'r1',
        name: 'Priya Nair',
        job: 'Senior Backend Engineer (m/w/d)',
        at: '2026-10-01T09:00:00Z',
        outcome: 'invited',
      },
    ],
    bonus: { amountMinor: 200_000, currency: 'EUR', after: 'probation' },
  };

  it('offers refer and apply on each job', async () => {
    const { container } = render(<screens.Board load={ready(board)} />);
    expect(screen.getByRole('button', { name: 'Refer someone' })).toBeTruthy();
    expect(screen.getByText('Priya Nair')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('S6, the benefits catalogue', () => {
  const settings = {
    admin: true,
    general: { ai: { assistant: false } },
    entities: [{ id: 'e1', name: 'Acme GmbH', country: 'DE', currency: 'EUR' }],
    benefitCategories: [
      { key: 'meal', name: 'Food', icon: 'break', custom: false },
      { key: 'custom_club', name: 'Club life', icon: 'team', custom: true },
    ],
    categoryIcons: ['break', 'team', 'starred'],
    benefits: [
      {
        id: 'lib:e1:meal_allowance',
        key: 'meal_allowance',
        legalEntityId: 'e1',
        category: 'meal',
        statutory: false,
        names: { en: 'Meal allowance' },
        description: 'A monthly budget for lunch.',
        value: { kind: 'descriptive' },
        eligibility: {
          employmentTypes: null,
          minWeeklyMinutes: null,
          waiting: { kind: 'none' },
          workModes: null,
          locationIds: null,
        },
        taxNote: null,
      },
    ],
  } as unknown as SettingsData;

  it('lists every category with its benefits, and lets a category or a benefit be added', async () => {
    const { container } = render(
      <screens.Settings load={ready(settings)} path="/settings/recruiting/benefits" />,
    );
    expect(screen.getByRole('heading', { name: 'Food' })).toBeTruthy();
    expect(screen.getByText('A monthly budget for lunch.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Club life' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add category' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add benefit' })).toHaveLength(2);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('R4, the setup’s terms ahead of the server', () => {
  const catalogue: TermsCatalogue = {
    country: 'DE',
    reviewed: true,
    relationships: [{ key: 'employee', label: 'Arbeitnehmer (employee)', note: 'On the payroll.' }],
    contracts: {
      employee: [
        { key: 'unbefristet', label: 'Unbefristet', fixedTerm: false, maxWeeklyMinutes: 2880 },
        {
          key: 'befristet_mit_sachgrund',
          label: 'Befristet',
          fixedTerm: true,
          maxWeeklyMinutes: 2880,
        },
      ],
    },
    reasons: { befristet_mit_sachgrund: [{ key: 'substitution', label: 'Covering for another' }] },
    leave: {
      employee: [1, 2, 3, 4, 5, 6, 7].map((d) => ({
        days: 4 * d,
        unit: 'working_days' as const,
        source: 'BUrlG § 3',
        note: '',
      })),
    },
  };
  const german = {
    ...job,
    options: {
      ...job.options,
      entities: [
        {
          id: 'e1',
          name: 'Acme GmbH',
          country: 'DE',
          currency: 'EUR',
          fullTimeWeeklyMinutes: 2400,
        },
      ],
      places: [{ id: 'l1', name: 'Berlin', city: 'Berlin', country: 'DE', entityId: 'e1' }],
    },
  };

  it('lists the workplaces of an entity the moment it is chosen, before Recruiting answers', () => {
    const view = viewOf(german, { entityId: 'e1' }, null);
    expect(view.options.locations.map((l) => l.name)).toEqual(['Berlin']);
    expect(view.options.currency).toBe('EUR');
  });

  it('lists the country’s contracts for a kind of work from its catalogue, with their reasons and leave', () => {
    const view = viewOf(
      german,
      {
        entityId: 'e1',
        locationId: 'l1',
        workMode: 'onsite',
        relationship: 'employee',
        contractType: 'befristet_mit_sachgrund',
        workDays: [1, 2, 3, 4, 5],
        dayStart: 540,
        dayEnd: 1020,
        breakMinutes: 60,
      },
      catalogue,
    );
    expect(view.options.contractTypes.map((t) => t.key)).toEqual([
      'unbefristet',
      'befristet_mit_sachgrund',
    ]);
    expect(view.options.fixedTermReasons.map((r) => r.key)).toEqual(['substitution']);
    expect(view.options.leave?.days).toBe(20);
    expect(view.options.weeklyMinutes).toBe(5 * 7 * 60);
    // 35 hours against the entity's 40: part time.
    expect(view.options.hours).toBe('part_time');
  });

  it('keeps only the picks Recruiting has not answered yet', () => {
    expect(
      stillPending({ entityId: 'e1', locationId: 'l1' }, { ...job.terms, entityId: 'e1' }),
    ).toEqual({
      locationId: 'l1',
    });
  });
});
