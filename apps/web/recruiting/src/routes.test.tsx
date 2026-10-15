import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import manifest from '../public/routes.json';
import * as screens from './index';
import { axeViolations } from './test/axe';
import type { HomeData, PipelineData } from './types';

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
  job: { id: 'j1', title: 'Senior Backend Engineer (m/w/d)', state: 'open' },
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
