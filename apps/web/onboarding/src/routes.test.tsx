import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import manifest from '../public/routes.json';
import * as screens from './index';
import { axeViolations } from './test/axe';
import type { BoardData, PlanData } from './types';

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

const board: BoardData = {
  rows: [
    {
      id: 'p1',
      name: 'Yuki Sato',
      state: 'scheduled',
      startDate: '2026-12-01',
      department: 'Engineering',
      country: 'ES',
      manager: 'Marco Ruiz',
      done: 2,
      total: 10,
      late: 1,
      next: { title: 'Order laptop', dueOn: '2026-11-24' },
    },
  ],
  hr: true,
};

describe('O1, who is arriving', () => {
  it('links each plan, with its progress and what is late', async () => {
    const { container } = render(<screens.Home load={ready(board)} />);
    expect(screen.getByRole('link', { name: 'Yuki Sato' }).getAttribute('href')).toBe(
      '/onboarding/plans/p1',
    );
    expect(screen.getByText('1 late')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});

const plan: PlanData = {
  plan: {
    id: 'p1',
    name: 'Yuki Sato',
    state: 'in_progress',
    startDate: '2026-12-01',
    probationEnd: '2027-05-31',
    department: null,
    location: 'Madrid',
    country: 'ES',
    workMode: 'hybrid',
    managerId: 'm',
    buddyId: null,
    personId: null,
    allowedExtensionMonths: 3,
  },
  manager: 'Marco Ruiz',
  buddy: null,
  progress: { done: 1, total: 2, late: 1 },
  tasks: [
    {
      id: 't1',
      key: 'equipment',
      title: 'Prepare the laptop',
      phase: 'before_start',
      ownerRole: 'it',
      kind: 'equipment',
      dueOn: '2026-11-24',
      due: '-5d',
      state: 'open',
      doneAt: null,
      locked: false,
      link: null,
      late: true,
      mine: true,
    },
    {
      id: 't2',
      key: 'es_social_security_alta',
      title: 'Register with Social Security',
      phase: 'before_start',
      ownerRole: 'hr',
      kind: 'todo',
      dueOn: '2026-11-26',
      due: '-3d',
      state: 'done',
      doneAt: '2026-11-20T09:00:00Z',
      locked: true,
      link: null,
      late: false,
      mine: false,
    },
  ],
  checkIns: [],
  reviews: [],
  members: [{ personId: 'b', name: 'Adam Novak' }],
  may: { setBuddy: true, moveStart: true, review: true, checkIn: false },
};

describe('O3, a plan', () => {
  it('lets the viewer tick only their own tasks, marks the country’s, and offers the review', async () => {
    const { container } = render(<screens.Plan load={ready(plan)} params={{ id: 'p1' }} />);
    expect(
      screen.getByRole('checkbox', { name: 'Prepare the laptop' }).hasAttribute('disabled'),
    ).toBe(false);
    expect(
      screen
        .getByRole('checkbox', { name: 'Register with Social Security' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByText('Country')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record review' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});
