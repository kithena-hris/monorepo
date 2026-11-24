import { describe, expect, it } from 'vitest';

import { cut, DEFAULT_VIEW, viewOf, type ViewTask } from './task-view';

const WORDS = {
  overdue: 'Overdue',
  week: 'This week',
  later: 'Later',
  noDue: 'No due date',
  noArea: 'General',
  noSender: 'Nobody',
  noModule: 'Other',
};
const TODAY = '2026-11-24';
const task = (id: string, more: Partial<ViewTask>): ViewTask => ({ id, title: id, ...more });
const TASKS = [
  task('late-perf', { module: 'Performance', area: 'Cycle 1', dueDay: '2026-11-01' }),
  task('soon-perf', { module: 'Performance', area: 'Cycle 2', dueDay: '2026-11-26' }),
  task('late-rec', { module: 'Recruiting', dueDay: '2026-10-20' }),
  task('later-rec', { module: 'Recruiting', dueDay: '2027-01-10' }),
  task('none-people', { module: 'People' }),
];
const ids = (r: ReturnType<typeof cut<ViewTask>>): string[][] =>
  r.sections.map((s) => s.tasks.map((t) => t.id));

describe('how Home cuts To do', () => {
  it('sorts by when it is due and draws no more than the limit, counting what matched', () => {
    const r = cut(TASKS, DEFAULT_VIEW, TODAY, WORDS, 3);
    expect(ids(r)).toEqual([['late-rec', 'late-perf', 'soon-perf']]);
    expect(r.matched).toBe(5);
  });

  it('filters by module and by when it is due', () => {
    expect(ids(cut(TASKS, { ...DEFAULT_VIEW, module: 'Recruiting' }, TODAY, WORDS, 5))).toEqual([
      ['late-rec', 'later-rec'],
    ]);
    expect(ids(cut(TASKS, { ...DEFAULT_VIEW, due: 'overdue' }, TODAY, WORDS, 5))).toEqual([
      ['late-rec', 'late-perf'],
    ]);
    expect(cut(TASKS, { ...DEFAULT_VIEW, due: 'week' }, TODAY, WORDS, 5).matched).toBe(3);
  });

  it('groups by module, then inside a module, keeping a module’s sections together', () => {
    const r = cut(TASKS, { ...DEFAULT_VIEW, group: 'module', inside: 'area' }, TODAY, WORDS, 5);
    expect(r.sections.map((s) => [s.group, s.sub, s.count])).toEqual([
      ['Recruiting', 'General', 2],
      ['Performance', 'Cycle 1', 1],
      ['Performance', 'Cycle 2', 1],
      ['People', 'General', 1],
    ]);
  });

  it('puts groups by when they are due soonest first, and says how many each holds', () => {
    const r = cut(TASKS, { ...DEFAULT_VIEW, group: 'due', sort: 'newest' }, TODAY, WORDS, 2);
    expect(r.sections.map((s) => [s.group, s.tasks.length, s.count])).toEqual([['Overdue', 2, 2]]);
  });

  it('reads a kept view back safely', () => {
    expect(viewOf(null)).toEqual(DEFAULT_VIEW);
    expect(viewOf({ group: 'module', inside: 'module', sort: 'sideways' })).toEqual({
      ...DEFAULT_VIEW,
      group: 'module',
    });
  });
});
