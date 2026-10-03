import { describe, expect, it } from 'vitest';

import { FINANCE, HR, PEOPLE_NAV } from './people-nav.fixture';
import { placesFor } from './remotes';
import { countsOf, noticesOf, type Overview } from './shell-data';

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
