import { describe, expect, it } from 'vitest';

import { FINANCE, HR, PEOPLE_NAV } from './people-nav.fixture';
import { placesFor } from './remotes';
import { countsOf, type Overview } from './shell-data';

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
