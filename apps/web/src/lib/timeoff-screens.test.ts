import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const timeOff = vi.fn();
vi.mock('./people', () => ({ timeOff }));
const { loadScreen } = await import('./timeoff-screens');

/**
 * The employee's screens' reads (TOF-062 to TOF-067): what each asks Time
 * Off for, from the address, and what it does with a refusal.
 */

type Answer = { ok: true; data: unknown } | { ok: false; code: string; message: string };
/** Time Off as a table of answers by operation; anything else answers nothing useful. */
function answering(answers: Record<string, (variables: Record<string, unknown>) => Answer>): void {
  timeOff.mockImplementation((name: string, variables: Record<string, unknown> = {}) =>
    Promise.resolve(
      answers[name]?.(variables) ?? { ok: false, code: 'UNAVAILABLE', message: 'not here' },
    ),
  );
}
const asked = (name: string): Record<string, unknown>[] =>
  timeOff.mock.calls.filter(([n]) => n === name).map(([, v]) => v as Record<string, unknown>);

beforeEach(() => {
  timeOff.mockReset();
  vi.useFakeTimers({ now: Date.parse('2026-10-01T10:33:00.000Z'), toFake: ['Date'] });
});

describe('the request panel', () => {
  it('asks the preview for what the address says, and the team’s month on show', async () => {
    answering({ TimeOffRequestPanel: () => ({ ok: true, data: { leaveTypes: [], preview: {} } }) });
    const load = await loadScreen('RequestTimeOff', {
      params: {},
      search: { type: 'vacation', from: '2026-10-19', to: '2026-10-23', half: '1' },
    });
    expect(asked('TimeOffRequestPanel')).toEqual([
      { leaveTypeKey: 'vacation', from: '2026-10-19', to: '2026-10-23', endsHalfDay: true },
    ]);
    expect(asked('TimeOffCalendarMonth')).toEqual([{ month: '2026-10', scope: 'team' }]);
    expect(load).toMatchObject({
      status: 'ready',
      data: {
        asked: {
          type: 'vacation',
          from: '2026-10-19',
          to: '2026-10-23',
          half: true,
          step: null,
          month: '2026-10',
        },
        overview: null,
        team: null,
        problem: null,
      },
    });
  });

  it('draws the panel without dates Time Off refuses, and says why', async () => {
    answering({
      TimeOffRequestPanel: (v) =>
        'from' in v
          ? { ok: false, code: 'INVALID_PERIOD', message: 'Leave cannot end before it starts' }
          : { ok: true, data: { leaveTypes: [{ key: 'vacation' }], preview: null } },
    });
    const load = await loadScreen('RequestTimeOff', {
      params: {},
      search: { type: 'vacation', from: '2026-10-23', to: '2026-10-19', month: 'nonsense' },
    });
    expect(load).toMatchObject({
      status: 'ready',
      data: {
        preview: null,
        problem: 'Leave cannot end before it starts',
        asked: { month: '2026-10' },
      },
    });
  });
});

describe('my requests', () => {
  it('reads the tab its name says, and the first request in full', async () => {
    answering({
      TimeOffMyRequests: () => ({
        ok: true,
        data: { items: [{ requestId: 'r1' }, { requestId: 'r2' }] },
      }),
      TimeOffRequest: (v) => ({ ok: true, data: { request: { requestId: v['requestId'] } } }),
    });
    const load = await loadScreen('MyRequestsPast', { params: {}, search: {} });
    expect(asked('TimeOffMyRequests')).toEqual([{ tab: 'past' }]);
    expect(load).toMatchObject({
      status: 'ready',
      data: { tab: 'past', selected: { request: { requestId: 'r1' } }, single: false },
    });
  });

  it('puts a request at its own address beside the tab it belongs to; someone else’s alone', async () => {
    const request = { requestId: 'r9', status: 'approved', span: { to: '2026-11-12' } };
    answering({
      TimeOffRequest: () => ({ ok: true, data: { mine: true, request } }),
      TimeOffMyRequests: () => ({ ok: true, data: { items: [request] } }),
    });
    expect(await loadScreen('RequestDetail', { params: { id: 'r9' }, search: {} })).toMatchObject({
      status: 'ready',
      data: { tab: 'upcoming', items: [request], single: true },
    });
    answering({ TimeOffRequest: () => ({ ok: true, data: { mine: false, request } }) });
    expect(await loadScreen('RequestDetail', { params: { id: 'r9' }, search: {} })).toMatchObject({
      data: { items: [], single: true },
    });
  });
});

describe('holidays', () => {
  it('reads the year in the address, this year for one it cannot read, with the bridge days', async () => {
    answering({
      TimeOffHolidays: () => ({
        ok: true,
        data: {
          holidays: [{ date: '2026-12-08', name: 'Inmaculada Concepción', layer: 'national' }],
        },
      }),
    });
    const load = await loadScreen('Holidays', { params: { year: 'soon' }, search: {} });
    expect(asked('TimeOffHolidays')).toEqual([{ year: 2026 }]);
    expect(load).toMatchObject({
      status: 'ready',
      data: { bridges: [{ take: '2026-12-07', holiday: 'Inmaculada Concepción', days: 4 }] },
    });
  });
});

describe('HR’s attendance pages (TOF-095 onwards)', () => {
  it('asks for the month in the address, this month without one, and says when it was not one', async () => {
    answering({ TimeOffAttendanceExceptions: () => ({ ok: true, data: { items: [] } }) });
    await loadScreen('Exceptions', {
      params: {},
      search: { month: '2026-02', kind: 'short_rest' },
    });
    const odd = await loadScreen('Exceptions', { params: {}, search: { month: 'soon' } });
    expect(asked('TimeOffAttendanceExceptions')).toEqual([
      { from: '2026-02-01', to: '2026-02-28' },
      { from: '2026-10-01', to: '2026-10-31' },
    ]);
    expect(odd).toMatchObject({
      status: 'ready',
      data: { month: '2026-10', kind: null },
      notice: '“soon” is not a month',
    });
  });
});
