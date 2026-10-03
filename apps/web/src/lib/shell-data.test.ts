import { describe, expect, it } from 'vitest';

import { FINANCE, HR, PEOPLE_NAV } from './people-nav.fixture';
import timeOffManifest from '../../timeoff/public/routes.json';
import { headerFrame, matchRoute, placesFor } from './remotes';
import {
  countsOf,
  noticesOf,
  timeOffCounts,
  timeOffRoles,
  type Overview,
  type TimeOffViewer,
} from './shell-data';

const overview = (roles: Overview['roles'], approvals: number): Overview => ({
  roles,
  now: '2026-09-29T09:00:00Z',
  approvals: { isHr: roles.hr, total: approvals, items: [] },
  missing: [],
  team: roles.hr ? { waiting: 61, toFill: 27 } : null,
});

describe('countsOf', () => {
  it('counts each tab’s queue, and a section only what needs a decision', () => {
    const { sections, tabs } = countsOf(
      overview(HR, 4),
      { identifiers: 3, duplicates: 2, accessRequests: 1 },
      placesFor(PEOPLE_NAV, HR).sections,
    );
    expect(tabs).toEqual({
      '/people/data-health/completeness': 88,
      '/people/data-health/id-checks': 3,
      '/people/data-health/duplicates': 2,
      '/people/data-health/access-requests': 1,
    });
    // Completeness is a backlog, not a decision: Data health is 3 + 2 + 1.
    expect(sections).toEqual({ '/people/approvals': 4, '/people/data-health/completeness': 6 });
  });

  it('leaves out what People refused and every zero, and keys by the viewer’s own link', () => {
    const { sections, tabs } = countsOf(
      overview(FINANCE, 0),
      { identifiers: null, duplicates: null, accessRequests: 2 },
      placesFor(PEOPLE_NAV, FINANCE).sections,
    );
    expect(tabs).toEqual({ '/people/data-health/access-requests': 2 });
    expect(sections).toEqual({ '/people/data-health/access-requests': 2 });
    expect(countsOf(overview(FINANCE, 0), null, [])).toEqual({ sections: {}, tabs: {} });
  });
});

describe('telling somebody they were viewed as', () => {
  const viewed = (endedAt: string, specialCategory: boolean) => ({
    id: `v-${endedAt}`,
    by: 'Grace Hopper',
    at: new Date(Date.parse(endedAt) - 12 * 60_000).toISOString(),
    endedAt,
    specialCategory,
  });

  it('is a notice for a fortnight after it ended, saying who, how long, and what showed', () => {
    const notices = noticesOf({
      ...overview(HR, 0),
      viewedAs: [
        viewed('2026-09-29T08:00:00.000Z', true),
        viewed('2026-09-01T08:00:00.000Z', false),
      ],
    });
    expect(notices).toEqual([
      {
        id: 'viewed:v-2026-09-29T08:00:00.000Z',
        title: 'Grace Hopper viewed Kithena as you',
        detail:
          'For 12 min, read-only: nothing was changed. Your sensitive personal details were visible.',
        at: '2026-09-29T08:00:00.000Z',
        href: '/inbox',
        person: 'Grace Hopper',
        kind: 'viewed',
      },
    ]);
  });
});

describe('a question about one’s own change (AI7)', () => {
  it('becomes a notice that opens the change to answer it', () => {
    const [notice] = noticesOf({
      ...overview({ hr: false, admin: false, finance: false }, 1),
      approvals: {
        isHr: false,
        total: 1,
        items: [
          {
            id: 'c1',
            name: 'Tom Fischer',
            label: 'Base salary',
            requestedAt: '2026-09-28T09:00:00.000Z',
            requestedBy: 'You',
            asked: true,
          },
        ],
      },
    });
    expect(notice).toMatchObject({
      title: 'HR asked about your base salary change',
      detail: 'Tom Fischer · answer it to move it on',
      href: '/people/approvals?tab=asked&change=c1',
    });
  });
});

describe('Time Off for its approvers (TOF-058a)', () => {
  const nav = matchRoute(timeOffManifest, '/time-off/overview')?.nav ?? {
    sections: [],
    actions: [],
    settings: [],
  };
  const employee = { hr: false, admin: false, finance: false };
  const viewer = (approves: boolean): TimeOffViewer => ({
    approves,
    hrAdmin: false,
    counts: { requestsWaiting: approves ? 3 : 0, attendanceExceptions: 0 },
  });
  const requests = (v: TimeOffViewer) => {
    const places = placesFor(nav, timeOffRoles(employee, v));
    const frame = headerFrame(
      places,
      '/time-off/requests/upcoming',
      '/time-off',
      { tabs: timeOffCounts(v, places.sections).tabs },
      'Time off',
    );
    return { section: frame.section, tabs: frame.tabs?.map((t) => t.label + (t.count ?? '')) };
  };

  it('shows Marco, who approves with no admin role, the queue tabs and what waits', () => {
    expect(requests(viewer(true))).toEqual({
      section: 'Requests',
      tabs: [
        'Waiting for me3',
        'Coming up',
        'Decided',
        'Delegation',
        'Upcoming',
        'Past',
        'Cancelled',
      ],
    });
  });

  it('shows Adam, who approves nobody, his own requests and none of the queue', () => {
    expect(requests(viewer(false))).toEqual({
      section: 'My requests',
      tabs: ['Upcoming', 'Past', 'Cancelled'],
    });
  });

  it('keeps the shell’s roles when Time Off does not answer', () => {
    expect(timeOffRoles(employee, null)).toBe(employee);
    expect(timeOffCounts(null, [])).toEqual({ sections: {}, tabs: {} });
  });
});
