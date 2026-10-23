import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const performance = vi.fn();
const people = vi.fn();
const timeOff = vi.fn();
const currentPerson = vi.fn();
vi.mock('./people', () => ({ performance, people, timeOff }));
vi.mock('./session', () => ({ currentPerson }));
const { loadScreen } = await import('./performance-screens');

/**
 * What the shell adds to a Performance screen from another module. Each
 * answer comes back as `call` hands it: the query's one top-level field,
 * already unwrapped.
 */

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: Date.parse('2026-10-18T10:00:00.000Z'), toFake: ['Date'] });
});

describe('a cycle being set up', () => {
  it('names work locations and legal entities from People', async () => {
    performance.mockResolvedValue({ ok: true, data: { id: 'c1' } });
    currentPerson.mockResolvedValue({ entitlements: ['module.people'] });
    people.mockResolvedValue({
      ok: true,
      data: {
        locations: [{ id: 'l1', name: 'Rotterdam' }],
        legalEntities: [{ id: 'e1', name: 'Meridian BV' }],
      },
    });
    const load = await loadScreen('Setup', { params: { id: 'c1' }, search: {} }, '/setup');
    expect(load).toEqual({
      status: 'ready',
      data: {
        id: 'c1',
        places: { locations: { l1: 'Rotterdam' }, entities: { e1: 'Meridian BV' } },
      },
    });
  });
});

describe('a cycle', () => {
  it('marks who is away, from Time Off', async () => {
    performance.mockResolvedValue({ ok: true, data: { id: 'c1' } });
    currentPerson.mockResolvedValue({ entitlements: ['module.timeoff'] });
    timeOff.mockResolvedValue({
      ok: true,
      data: {
        entries: [
          { personId: 'p1', status: 'approved', span: { from: '2026-10-20', to: '2026-10-24' } },
          { personId: 'p2', status: 'rejected', span: { from: '2026-10-20', to: '2026-10-24' } },
        ],
      },
    });
    const load = await loadScreen('Overview', { params: { id: 'c1' }, search: {} }, '/c1');
    expect(load).toEqual({ status: 'ready', data: { id: 'c1', away: { p1: '2026-10-24' } } });
  });
});
