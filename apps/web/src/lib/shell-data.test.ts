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
      viewedAs: [viewed('2026-09-29T08:00:00.000Z', true), viewed('2026-09-01T08:00:00.000Z', false)],
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
