import type { CalendarDate } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { countryTasks } from './country.js';
import {
  buildPlan,
  cancelPlan,
  completeTask,
  matches,
  moveStart,
  parseDue,
  progress,
  reopenTask,
  type HireFacts,
  type Template,
} from './plan.js';
import { decideProbation } from './probation.js';

const d = (s: string) => s as CalendarDate;
let n = 0;
const newId = () => `00000000-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`;

const hire: HireFacts = {
  country: 'DE',
  legalEntityId: null,
  department: 'Engineering',
  workMode: 'hybrid',
  contractType: 'unbefristet',
  startDate: d('2026-11-02'), // a Monday
  probationEnd: d('2027-05-01'),
  managerId: 'p-marco',
};

const template: Template = {
  id: 't1',
  name: 'Everyone',
  active: true,
  conditions: {},
  tasks: [
    {
      key: 'laptop',
      title: 'Order a laptop',
      phase: 'before_start',
      ownerRole: 'it',
      ownerPersonId: null,
      kind: 'equipment',
      due: parseDue('-7d'),
      link: null,
    },
    {
      key: 'welcome',
      title: 'Welcome meeting',
      phase: 'day_one',
      ownerRole: 'manager',
      ownerPersonId: null,
      kind: 'meeting',
      due: parseDue('0'),
      link: null,
    },
    {
      key: 'checkin_30',
      title: '30-day check-in',
      phase: 'first_month',
      ownerRole: 'manager',
      ownerPersonId: null,
      kind: 'meeting',
      due: parseDue('+30d'),
      link: null,
    },
  ],
};

describe('due rules (§O3)', () => {
  it('reads days from the start or from probation’s end', () => {
    expect(parseDue('-14d')).toEqual({ from: 'start', days: -14 });
    expect(parseDue('0')).toEqual({ from: 'start', days: 0 });
    expect(parseDue('+30d')).toEqual({ from: 'start', days: 30 });
    expect(parseDue('probation-14d')).toEqual({ from: 'probation_end', days: -14 });
    expect(() => parseDue('soon')).toThrow();
  });
});

describe('templates match on their conditions, empty meaning any', () => {
  it('matches a country and a department, and not another country', () => {
    expect(matches({}, hire)).toBe(true);
    expect(matches({ countries: ['DE'], departments: ['Engineering'] }, hire)).toBe(true);
    expect(matches({ countries: ['ES'] }, hire)).toBe(false);
    expect(matches({ workModes: ['remote'] }, hire)).toBe(false);
  });
});

describe('a plan (§O4)', () => {
  const plan = buildPlan({
    id: 'plan1',
    hireId: 'h1',
    hire,
    templates: [template],
    country: countryTasks('DE'),
    holidays: new Set([d('2026-12-02')]),
    newId,
  });

  it('merges the templates and the country’s tasks, with dates from the start, never on a weekend', () => {
    const laptop = plan.tasks.find((t) => t.key === 'laptop');
    // 7 days before Monday 2 Nov is Monday 26 Oct.
    expect(laptop?.dueOn).toBe('2026-10-26');
    expect(plan.tasks.find((t) => t.key === 'welcome')?.dueOn).toBe('2026-11-02');
    // +30 days is Wednesday 2 Dec, a holiday: the next working day.
    expect(plan.tasks.find((t) => t.key === 'checkin_30')?.dueOn).toBe('2026-12-03');
    expect(plan.tasks.filter((t) => t.locked).length).toBeGreaterThan(0);
    expect(plan.state).toBe('scheduled');
  });

  it('asks the manager for a probation review thirty days before it ends', () => {
    const review = plan.tasks.find((t) => t.key === 'probation_review');
    expect(review).toMatchObject({ ownerRole: 'manager', dueOn: '2027-04-01' });
  });

  it('moves every task hanging off the start when the start moves', () => {
    const moved = moveStart(plan, d('2026-11-09'), new Set());
    expect(moved.tasks.find((t) => t.key === 'welcome')?.dueOn).toBe('2026-11-09');
    expect(moved.tasks.find((t) => t.key === 'laptop')?.dueOn).toBe('2026-11-02');
    expect(moved.probationEnd).toBe('2027-05-08');
  });

  it('completes a task, says whether it was late, and completes the plan with the last one', () => {
    const laptop = plan.tasks.find((t) => t.key === 'laptop');
    const done = completeTask(
      plan,
      laptop?.id ?? '',
      'p-it',
      '2026-10-28T09:00:00Z',
      d('2026-10-28'),
    );
    expect(done.ok && done.value.late).toBe(true);
    expect(done.ok && done.value.plan.state).toBe('in_progress');
    let all = done.ok ? done.value.plan : plan;
    for (const t of all.tasks) {
      const r = completeTask(all, t.id, 'p', '2027-05-01T00:00:00Z', d('2027-05-01'));
      if (r.ok) all = r.value.plan;
    }
    expect(all.state).toBe('completed');
    expect(progress(all, d('2027-05-01'))).toMatchObject({ done: all.tasks.length, late: 0 });
  });

  it('reopens a task, and refuses to touch a cancelled plan', () => {
    const laptop = plan.tasks.find((t) => t.key === 'laptop')?.id ?? '';
    const done = completeTask(plan, laptop, 'p', '2026-10-20T09:00:00Z', d('2026-10-20'));
    const open = done.ok ? reopenTask(done.value.plan, laptop) : null;
    expect(open?.ok && open.value.tasks.find((t) => t.id === laptop)?.state).toBe('open');
    const cancelled = cancelPlan(plan);
    expect(completeTask(cancelled, laptop, 'p', '2026-10-20T09:00:00Z', d('2026-10-20')).ok).toBe(
      false,
    );
  });
});

describe('probation (§O8)', () => {
  it('passes, extends within what the pack allows, or ends; only the manager or HR decides', () => {
    expect(
      decideProbation(
        { end: d('2027-05-01'), managerId: 'm', allowedExtensionMonths: 0 },
        'm',
        false,
        'passed',
        null,
      ),
    ).toMatchObject({ ok: true, value: { outcome: 'passed', probationEnd: null } });
    expect(
      decideProbation(
        { end: d('2027-05-01'), managerId: 'm', allowedExtensionMonths: 3 },
        'm',
        false,
        'extended',
        2,
      ),
    ).toMatchObject({ ok: true, value: { probationEnd: '2027-07-01' } });
    expect(
      decideProbation(
        { end: d('2027-05-01'), managerId: 'm', allowedExtensionMonths: 3 },
        'm',
        false,
        'extended',
        4,
      ).ok,
    ).toBe(false);
    expect(
      decideProbation(
        { end: d('2027-05-01'), managerId: 'm', allowedExtensionMonths: null },
        'm',
        false,
        'extended',
        1,
      ).ok,
    ).toBe(false);
    expect(
      decideProbation(
        { end: d('2027-05-01'), managerId: 'm', allowedExtensionMonths: 3 },
        'someone',
        false,
        'passed',
        null,
      ).ok,
    ).toBe(false);
    expect(
      decideProbation(
        { end: d('2027-05-01'), managerId: 'm', allowedExtensionMonths: 3 },
        'someone',
        true,
        'failed',
        null,
      ).ok,
    ).toBe(true);
  });
});

describe('country tasks (§O7)', () => {
  it('has the launch countries’ statutory steps, locked', () => {
    for (const c of ['DE', 'ES', 'GB', 'IN', 'US'] as const)
      expect(countryTasks(c).length).toBeGreaterThan(1);
    expect(countryTasks('US').map((t) => t.key)).toContain('us_i9_section_1');
  });
});
