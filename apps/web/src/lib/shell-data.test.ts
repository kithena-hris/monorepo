import { describe, expect, it } from 'vitest';

import { FINANCE, HR, PEOPLE_NAV } from './people-nav.fixture';
import timeOffManifest from '../../timeoff/public/routes.json';
import { matchRoute } from './remote-manifest';
import { headerFrame, placesFor } from './remotes';
import {
  countsOf,
  noticesOf,
  reviewItem,
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
  it('counts every decision waiting in Review as its one count, and not its missing details', () => {
    const { sections, tabs } = countsOf(
      overview(HR, 4),
      { identifiers: 3, duplicates: 2, accessRequests: 1 },
      placesFor(PEOPLE_NAV, HR).sections,
    );
    // 4 changes + 3 ID checks + 2 duplicates + 1 request; the 88 missing details are a backlog.
    expect(sections).toEqual({ '/people/review/waiting': 10 });
    expect(tabs).toEqual({ '/people/review/waiting': 10 });
  });

  it('leaves out what People refused and every zero, and counts nothing off Review', () => {
    const { sections, tabs } = countsOf(
      overview(FINANCE, 0),
      { identifiers: null, duplicates: null, accessRequests: 2 },
      placesFor(PEOPLE_NAV, FINANCE).sections,
    );
    expect(tabs).toEqual({ '/people/review/waiting': 2 });
    expect(sections).toEqual({ '/people/review/waiting': 2 });
    expect(
      countsOf(
        overview(FINANCE, 0),
        { identifiers: 0, duplicates: 0, accessRequests: 0 },
        placesFor(PEOPLE_NAV, FINANCE).sections,
      ),
    ).toEqual({ sections: {}, tabs: {} });
    expect(countsOf(overview(FINANCE, 3), null, [])).toEqual({ sections: {}, tabs: {} });
  });

  it('counts exports to send in Waiting, and Flagged and I asked on their own tabs (E1)', () => {
    const { sections, tabs } = countsOf(
      overview(HR, 4),
      { identifiers: 3, duplicates: 2, accessRequests: 1, exports: 1, flagged: 1, asked: 2 },
      placesFor(PEOPLE_NAV, HR).sections,
    );
    expect(sections).toEqual({ '/people/review/waiting': 11 });
    expect(tabs).toEqual({
      '/people/review/waiting': 11,
      '/people/review/flagged': 1,
      '/people/review/asked': 2,
    });
  });
});

describe('reviewItem', () => {
  it('opens an item of Review, its chip chosen, from a link', () => {
    expect(reviewItem('flagged', 'changes', 'change-c1')).toBe(
      '/people/review/flagged?kind=changes&item=change-c1',
    );
    expect(reviewItem('waiting', null, null)).toBe('/people/review/waiting');
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
      href: '/people/review/waiting?kind=changes&item=change-c1',
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
  const viewer = (approves: boolean, member = true): TimeOffViewer => ({
    approves,
    hrAdmin: false,
    member,
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
    return {
      section: frame.section,
      tabs: frame.tabs?.map((t) => `${t.label}${String(t.count ?? '')}`),
    };
  };

  it('shows Marco, who approves with no admin role, the queue tabs and what waits', () => {
    expect(requests(viewer(true))).toEqual({
      section: 'Requests',
      tabs: [
        'Waiting for me3',
        'Coming up',
        'Decided',
        'Delegation',
        'Balance adjustments',
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

  it('offers Request time off only to somebody Time Off holds as an employee', () => {
    const actions = (v: TimeOffViewer | null) =>
      placesFor(nav, timeOffRoles(employee, v)).actions.map((a) => a.label);
    expect(actions(viewer(false))).toEqual(['Request time off']);
    // A provisional record People has not hired: nothing to request from.
    expect(actions(viewer(false, false))).toEqual([]);
    // Time Off did not answer: offered, as before it could say.
    expect(actions(null)).toEqual(['Request time off']);
  });

  it('keeps the shell’s roles when Time Off does not answer', () => {
    expect(timeOffRoles(employee, null)).toEqual({ ...employee, member: true });
    expect(timeOffCounts(null, [])).toEqual({ sections: {}, tabs: {} });
  });
});

describe('an import one approved, over', () => {
  it('becomes a notice that opens it: Import finished with how many, or Import failed', () => {
    const notices = noticesOf({
      ...overview(HR, 0),
      imports: [
        {
          id: 'r1',
          status: 'succeeded',
          finishedAt: '2026-09-29T08:00:00Z',
          people: 1000,
          fields: 95,
          fileName: 'meridian-people.xlsx',
        },
        {
          id: 'r2',
          status: 'succeeded',
          finishedAt: '2026-09-28T08:00:00Z',
          people: 1,
          fields: 0,
          fileName: null,
        },
        {
          id: 'r3',
          status: 'failed',
          finishedAt: '2026-09-27T08:00:00Z',
          people: 312,
          fields: 0,
          fileName: 'again.csv',
        },
      ],
    });
    expect(notices.map((n) => [n.title, n.detail, n.href, n.kind, n.failed ?? false])).toEqual([
      [
        'Import finished: 1,000 people, 95 new fields',
        'meridian-people.xlsx',
        '/people/import?run=r1',
        'import',
        false,
      ],
      ['Import finished: 1 person', 'An imported file', '/people/import?run=r2', 'import', false],
      ['Import failed', 'again.csv', '/people/import?run=r3', 'import', true],
    ]);
  });

  it('is none from a People that does not say', () => {
    expect(noticesOf(overview(HR, 0))).toEqual([]);
  });
});
