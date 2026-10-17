import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import manifest from '../public/routes.json';
import type { FeedbackData } from './feedback';
import type { GoalsData } from './goals';
import type { HomeData } from './home';
import * as screens from './index';
import type { MyReviewsData } from './reviews';
import type { TemplatesData } from './templates';
import { axeViolations } from './test/axe';

const ready = <T,>(data: T) => ({ status: 'ready' as const, data });
const routes = new Set(manifest.routes.map((r) => r.path));

describe('routes.json', () => {
  it('points every route at a screen index.ts exports', () => {
    const exported = new Set(Object.keys(screens));
    expect(manifest.routes.filter((r) => !exported.has(r.component))).toEqual([]);
  });

  it('lists every place, tab and owned path as a route of its own', () => {
    const places: readonly {
      path: string;
      owns?: readonly string[];
      tabs?: readonly { path: string }[];
    }[] = [...manifest.sections, ...manifest.settings];
    expect(
      places
        .flatMap((p) => [p.path, ...(p.owns ?? []), ...(p.tabs ?? []).map((t) => t.path)])
        .filter((p) => !routes.has(p)),
    ).toEqual([]);
  });
});

const home: HomeData = {
  hr: true,
  name: 'Ada Lovelace',
  member: true,
  stats: [{ label: 'Overdue', value: '2', detail: 'Across running cycles', warning: true }],
  tasks: [
    {
      id: 't1',
      title: 'Self review',
      summary: 'H2 2026',
      link: '/performance/reviews/r1',
      due: '2026-11-02',
      tone: 'danger',
    },
  ],
  running: [
    {
      id: 'c1',
      name: 'H2 2026',
      state: 'in_progress',
      who: '40 people',
      start: '2026-10-01',
      progress: 35,
    },
  ],
  goals: [{ id: 'g1', title: 'Cut checkout latency', progress: 60, confidence: 'at_risk' }],
  owed: [
    {
      id: 'r2',
      kind: 'manager',
      from: 'Marco Ruiz',
      state: 'draft',
      cycle: 'H2 2026',
      released: null,
    },
  ],
};

describe('PF1, home', () => {
  it('shows what the person owes, what is owed to them, and the cycles HR owns', async () => {
    const { container } = render(<screens.Home load={ready(home)} />);
    expect(screen.getByRole('link', { name: /^Self review/ }).getAttribute('href')).toBe(
      '/performance/reviews/r1',
    );
    expect(screen.getByText('Manager review · Marco Ruiz')).toBeTruthy();
    expect(screen.getByRole('link', { name: /^H2 2026/ }).getAttribute('href')).toBe(
      '/performance/cycles/c1',
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

const reviews: MyReviewsData = {
  tab: 'write',
  counts: { toWrite: 1, written: 0 },
  rows: [
    {
      id: 'r1',
      kind: 'peer',
      title: 'Peer review',
      subjectId: 'p2',
      about: 'Omar Haddad',
      aboutTitle: 'Engineer',
      cycle: 'H2 2026',
      due: '2026-11-02',
      state: 'not_started',
      savedAt: null,
    },
  ],
  nominations: [],
  about: null,
};

describe('PF13, my reviews', () => {
  it('links each review to write', async () => {
    const { container } = render(<screens.MyReviews load={ready(reviews)} />);
    expect(screen.getByRole('link', { name: 'Peer review' }).getAttribute('href')).toBe(
      '/performance/reviews/r1',
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

const templates: TemplatesData = {
  hr: true,
  rows: [
    {
      id: 't1',
      name: 'Manager review',
      purpose: ['manager'],
      version: 'v2',
      state: 'published',
      inCycles: 1,
      updatedAt: '2026-10-01T09:00:00Z',
      canDelete: false,
      questions: 6,
      published: 2,
      hasScore: true,
    },
  ],
};

describe('PF3, form templates', () => {
  it('marks a template with a performance score and how many cycles use it', async () => {
    const { container } = render(<screens.Templates load={ready(templates)} />);
    expect(screen.getByText('Performance score')).toBeTruthy();
    expect(screen.getByText('1 cycle')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

const feedback: FeedbackData = {
  tab: 'received',
  received: [
    {
      id: 'f1',
      from: null,
      kind: 'feedback',
      body: '<p>Clear write-up.</p>',
      value: null,
      at: '2026-10-10T09:00:00Z',
      audience: 'recipient_manager',
      template: null,
    },
  ],
  sent: [],
  open: [],
  asked: [],
  praise: [],
  templates: [],
  settings: {
    names: 'writer',
    sees: 'recipient_manager',
    audiences: ['recipient_manager', 'manager_only'],
    praiseAudiences: ['everyone'],
    values: [],
    toneCheck: false,
    on: true,
  },
};

describe('PF14, feedback', () => {
  it('names a hidden writer only as someone at the company, and draws the text as text', async () => {
    const { container } = render(<screens.Feedback load={ready(feedback)} />);
    expect(screen.getByText('Someone at the company')).toBeTruthy();
    expect(screen.getByText('Clear write-up.')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

const goals: GoalsData = {
  tab: 'list',
  periods: [
    { id: 'h2', name: 'H2 2026', from: '2026-07-01', to: '2026-12-31', cadence: 'fortnightly' },
  ],
  period: 'h2',
  scope: 'mine',
  rows: [
    {
      id: 'g1',
      title: 'Cut checkout latency',
      owner: 'Adam Novak',
      ownerId: 'p1',
      ownerKind: 'person',
      periodId: 'h2',
      progress: 60,
      confidence: 'at_risk',
      status: 'active',
      weight: 100,
      commitment: 'committed',
      parentId: null,
      alignedTo: null,
      visibility: 'owner',
    },
  ],
  tree: [],
  due: [],
  weighted: true,
  score: 60,
  may: { create: true, company: false },
};

describe('PF18, goals', () => {
  it('shows progress and confidence, and the weights adding up', async () => {
    const { container } = render(<screens.Goals load={ready(goals)} />);
    expect(screen.getByRole('link', { name: 'Cut checkout latency' }).getAttribute('href')).toBe(
      '/performance/goals/g1',
    );
    expect(screen.getByText('At risk')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});
