import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPLOYEE, FINANCE, HR, PEOPLE_NAV } from './people-nav.fixture';
import {
  AREAS,
  areaOf,
  currentPlace,
  currentTab,
  firstUnder,
  headerFrame,
  matchPath,
  matchRoute,
  placesFor,
  remoteNav,
  remoteRoute,
} from './remotes';
import timeOff from '../../timeoff/public/routes.json';

describe('matchRoute', () => {
  const manifest = {
    routes: [
      { path: '/people', component: 'PeopleHome' },
      { path: '/people/:id', component: 'Profile' },
      { path: '/people/directory/list', component: 'Directory' },
    ],
  };

  it('names the component for a listed path', () => {
    expect(matchRoute(manifest, '/people')).toMatchObject({ component: 'PeopleHome', params: {} });
  });

  it('prefers a literal path to a pattern listed before it', () => {
    expect(matchRoute(manifest, '/people/directory/list')?.component).toBe('Directory');
  });

  it('reads a parameter out of a pattern', () => {
    expect(matchRoute(manifest, '/people/0190a3c4-0000-7000-8000-000000000001')).toMatchObject({
      component: 'Profile',
      path: '/people/:id',
      params: { id: '0190a3c4-0000-7000-8000-000000000001' },
    });
  });

  it('refuses a parameter that is not one plain segment', () => {
    expect(matchRoute(manifest, '/people/a.b')).toBeUndefined();
    expect(matchRoute(manifest, '/people/x/y')).toBeUndefined();
  });

  it('is undefined for a path the remote does not list', () => {
    expect(matchRoute(manifest, '/people/nobody/at-all')).toBeUndefined();
  });

  it('lists every path, for the shell to match the address against in the browser', () => {
    expect(matchRoute(manifest, '/people')?.routes).toEqual([
      '/people',
      '/people/:id',
      '/people/directory/list',
    ]);
  });

  it('is null for something that is not a manifest', () => {
    expect(matchRoute({ routes: [{ path: 'people' }] }, '/people')).toBeNull();
    expect(matchRoute('<html>', '/people')).toBeNull();
  });

  it('carries the sections, actions and settings, and none when a manifest lists none', () => {
    const nav = {
      sections: [
        { path: '/people/directory/list', label: 'Directory', summary: 'List, cards or org chart' },
        {
          path: '/people/insights/headcount',
          label: 'Insights',
          tabs: [
            { path: '/people/insights/headcount', label: 'Headcount' },
            { path: '/people/insights/pay', label: 'Pay & diversity', for: ['hr'] },
          ],
        },
      ],
      actions: [{ path: '/people/new', label: 'Add employee', for: ['hr'] }],
      settings: [
        {
          path: '/settings/people/roles',
          label: 'Roles',
          description: 'Who holds which role.',
          for: ['hr'],
        },
      ],
    };
    expect(matchRoute({ ...manifest, ...nav }, '/people')?.nav).toEqual(nav);
    expect(matchRoute(manifest, '/people')?.nav).toEqual({
      sections: [],
      actions: [],
      settings: [],
    });
  });

  it('opens a setting only to the roles it lists', () => {
    const settings = [
      { path: '/settings/people/organisation', label: 'Organisation' },
      { path: '/settings/people/fields', label: 'Employee fields', for: ['admin'] },
    ];
    const cut = (roles: Record<string, boolean>) =>
      placesFor({ sections: [], actions: [], settings }, roles).settings.map((s) => s.label);
    expect(cut({ admin: true })).toEqual(['Organisation', 'Employee fields']);
    expect(cut({ hr: true })).toEqual(['Organisation']);
  });
});

describe('matchPath', () => {
  const paths = ['/people', '/people/:id', '/people/me', '/people/:id/history'];

  it('is the route the address is, a literal before a pattern', () => {
    expect(matchPath(paths, '/people/me')?.path).toBe('/people/me');
    expect(matchPath(paths, '/people/01a0')?.path).toBe('/people/:id');
    expect(matchPath(paths, '/people/01a0/history')?.path).toBe('/people/:id/history');
  });

  it('marks the section the server would, from the address alone', () => {
    const hr = placesFor(PEOPLE_NAV, HR).sections;
    const at = (address: string) => currentPlace(hr, matchPath(paths, address)?.path ?? null);
    expect(at('/people/01a0')?.label).toBe('Directory');
    expect(at('/people/me')).toBeUndefined();
  });
});

describe('placesFor', () => {
  const nav = {
    sections: [
      { path: '/people', label: 'Overview' },
      { path: '/people/import', label: 'Import', for: ['hr'] },
      {
        path: '/people/data-health/access-requests',
        label: 'Access requests',
        for: ['finance', 'hr'],
      },
    ],
    actions: [{ path: '/people/new', label: 'Add employee', for: ['hr'] }],
  };

  it('opens a place to any one of its roles, and everything unmarked to everybody', () => {
    const labels = (roles: Record<string, boolean>) => {
      const open = placesFor(nav, roles);
      return [...open.sections, ...open.actions].map((p) => p.label);
    };
    expect(labels({ hr: true })).toEqual(['Overview', 'Import', 'Access requests', 'Add employee']);
    expect(labels({ finance: true, hr: false })).toEqual(['Overview', 'Access requests']);
    expect(labels({})).toEqual(['Overview']);
  });

  it('keeps an umbrella page’s tabs the viewer opens, and links it to the first of them', () => {
    const health = (roles: Record<string, boolean>) =>
      placesFor(PEOPLE_NAV, roles).sections.find((s) => s.label === 'Data health');
    expect(health(HR)?.path).toBe('/people/data-health/completeness');
    expect(health(HR)?.tabs?.map((t) => t.label)).toEqual([
      'Completeness',
      'ID checks',
      'Duplicates',
      'Access requests',
    ]);
    // Finance opens Data health for its access requests alone, and lands there.
    expect(health(FINANCE)?.path).toBe('/people/data-health/access-requests');
    expect(health(FINANCE)?.tabs?.map((t) => t.label)).toEqual(['Access requests']);
    expect(health(EMPLOYEE)).toBeUndefined();
  });

  it('drops an umbrella page none of whose tabs the viewer opens', () => {
    const one = {
      sections: [
        {
          path: '/people/a/one',
          label: 'A',
          tabs: [{ path: '/people/a/one', label: 'One', for: ['hr'] }],
        },
      ],
      actions: [],
    };
    expect(placesFor(one, { finance: true }).sections).toEqual([]);
  });
});

describe('currentPlace', () => {
  const hr = placesFor(PEOPLE_NAV, HR).sections;
  const at = (route: string | null) => currentPlace(hr, route)?.label;

  it('is the section of a tab, of what a section owns, and of a directory view', () => {
    expect(at('/people')).toBe('Overview');
    expect(at('/people/data-health/duplicates')).toBe('Data health');
    expect(at('/people/insights/pay')).toBe('Insights');
    expect(at('/people/reports/:id')).toBe('Insights');
    expect(at('/people/directory/list')).toBe('Directory');
    expect(at('/people/directory/org-chart')).toBe('Directory');
    expect(at('/people/:id/history')).toBe('Directory');
    expect(at('/people/import')).toBe('Import & export');
  });

  it('is nothing for a route no place claims', () => {
    expect(at(null)).toBeUndefined();
    expect(at('/people/me')).toBeUndefined();
    expect(at('/people/new')).toBeUndefined();
  });

  it('finds the tab a route is, and none off an umbrella page', () => {
    const health = currentPlace(hr, '/people/data-health/id-checks');
    expect(currentTab(health, '/people/data-health/id-checks')?.label).toBe('ID checks');
    expect(currentTab(currentPlace(hr, '/people/reports'), '/people/reports')).toBeUndefined();
    expect(currentTab(currentPlace(hr, '/people/:id'), '/people/:id')).toBeUndefined();
  });
});

describe('headerFrame', () => {
  const hr = placesFor(PEOPLE_NAV, HR);
  const counts = {
    sections: { '/people/approvals': 4, '/people/data-health/completeness': 6 },
    tabs: { '/people/data-health/completeness': 88, '/people/data-health/duplicates': 2 },
  };

  it('titles an umbrella page by its section, with its tabs, counts and the one you are on', () => {
    const frame = headerFrame(hr, '/people/data-health/duplicates', '/people', counts);
    expect(frame.section).toBe('Data health');
    expect(frame.tabs).toEqual([
      {
        href: '/people/data-health/completeness',
        label: 'Completeness',
        current: false,
        count: 88,
      },
      { href: '/people/data-health/id-checks', label: 'ID checks', current: false },
      { href: '/people/data-health/duplicates', label: 'Duplicates', current: true, count: 2 },
      {
        href: '/people/data-health/access-requests',
        label: 'Access requests',
        short: 'Access',
        current: false,
      },
    ]);
  });

  it('lists the sections as one group, each with its icon and count, this one marked', () => {
    const frame = headerFrame(hr, '/people/data-health/duplicates', '/people', counts);
    expect(frame.siblingsLabel).toBe('People sections');
    expect(frame.siblings.map((g) => g.label)).toEqual(['People']);
    const items = frame.siblings[0]?.items ?? [];
    expect(items.map((i) => i.label)).toEqual([
      'Overview',
      'Directory',
      'Approvals',
      'Data health',
      'Import & export',
      'Insights',
    ]);
    expect(items.find((i) => i.current)?.label).toBe('Data health');
    expect(items.find((i) => i.label === 'Approvals')).toMatchObject({ icon: 'approve', count: 4 });
    expect(items.find((i) => i.label === 'Data health')?.count).toBe(6);
  });

  it('has no tabs off an umbrella page, and on a page an umbrella tab only owns', () => {
    expect(headerFrame(hr, '/people/directory/list', '/people').tabs).toBeUndefined();
    const reports = headerFrame(hr, '/people/reports', '/people');
    expect(reports.section).toBe('Insights');
    expect(reports.tabs?.some((t) => t.current)).toBe(false);
  });

  it('offers adding somebody where it belongs, and not on its own form or a profile', () => {
    expect(headerFrame(hr, '/people', '/people').actions).toEqual([
      { href: '/people/new', label: 'Add person', icon: 'hire' },
    ]);
    expect(headerFrame(hr, '/people/new', '/people')).toMatchObject({
      section: 'Add person',
      actions: [],
    });
    expect(headerFrame(placesFor(PEOPLE_NAV, EMPLOYEE), '/people', '/people').actions).toEqual([]);
  });
});

describe('firstUnder', () => {
  const sections = (roles: Record<string, boolean>) => placesFor(PEOPLE_NAV, roles).sections;

  it('sends a bare section to the first tab or view the viewer opens', () => {
    expect(firstUnder(sections(HR), '/people/data-health')).toBe(
      '/people/data-health/completeness',
    );
    expect(firstUnder(sections(FINANCE), '/people/data-health')).toBe(
      '/people/data-health/access-requests',
    );
    expect(firstUnder(sections(HR), '/people/insights/')).toBe('/people/insights/what-changed');
    expect(firstUnder(sections(EMPLOYEE), '/people/directory')).toBe('/people/directory/list');
  });

  it('sends nothing else anywhere', () => {
    expect(firstUnder(sections(EMPLOYEE), '/people/data-health')).toBeUndefined();
    expect(firstUnder(sections(HR), '/people/data')).toBeUndefined();
    expect(firstUnder(sections(HR), '/people/nobody')).toBeUndefined();
  });
});

describe('remoteRoute', () => {
  const asked: string[] = [];

  beforeEach(() => {
    asked.length = 0;
    vi.stubEnv('PEOPLE_REMOTE_URL', 'https://people.example/');
    vi.stubEnv('TIMEOFF_REMOTE_URL', 'https://timeoff.example');
    const manifests: Record<string, unknown> = {
      'https://people.example/routes.json': {
        routes: [{ path: '/people/:id', component: 'Profile' }],
      },
      'https://timeoff.example/routes.json': {
        routes: [
          { path: '/time-off/overview', component: 'Overview' },
          { path: '/settings/time-off/leave-types', component: 'LeaveTypes' },
        ],
        slots: { topBar: 'TopBarClock', sideBar: 'NotYet' },
      },
    };
    vi.stubGlobal('fetch', (url: string) => {
      asked.push(url);
      const body = manifests[url];
      return Promise.resolve(
        body === undefined ? new Response(null, { status: 404 }) : Response.json(body),
      );
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reads a /time-off path, and a Time Off setting, from the Time Off remote', async () => {
    expect(await remoteRoute('/time-off/overview')).toMatchObject({
      area: AREAS.timeoff,
      base: 'https://timeoff.example',
      entry: '/_timeoff/remoteEntry.js',
      component: 'Overview',
    });
    expect(await remoteRoute('/settings/time-off/leave-types')).toMatchObject({
      component: 'LeaveTypes',
    });
    expect(asked).toEqual([
      'https://timeoff.example/routes.json',
      'https://timeoff.example/routes.json',
    ]);
  });

  it('reads a People path from the People remote, as it always has', async () => {
    expect(await remoteRoute('/people/p-1')).toMatchObject({
      area: AREAS.people,
      base: 'https://people.example',
      entry: '/_people/remoteEntry.js',
      component: 'Profile',
      params: { id: 'p-1' },
    });
    expect(asked).toEqual(['https://people.example/routes.json']);
  });

  it('finds the People remote on its local port when its URL is unset', async () => {
    vi.stubEnv('PEOPLE_REMOTE_URL', undefined);
    await remoteRoute('/people/p-1');
    expect(asked).toEqual(['http://localhost:3002/routes.json']);
  });

  it('finds the Time Off remote on its local port when its URL is unset', async () => {
    vi.stubEnv('TIMEOFF_REMOTE_URL', undefined);
    await remoteRoute('/time-off/overview');
    expect(asked).toEqual(['http://localhost:3003/routes.json']);
  });

  it('reads an area’s places whichever path is asked, and nothing from a remote that is down', async () => {
    expect(await remoteNav(AREAS.timeoff)).toMatchObject({
      routes: ['/time-off/overview', '/settings/time-off/leave-types'],
      nav: { sections: [], actions: [], settings: [] },
    });
    // The places in the chrome it fills; one this shell does not draw is left out.
    expect((await remoteNav(AREAS.timeoff))?.slots).toEqual({ topBar: 'TopBarClock' });
    vi.stubEnv('TIMEOFF_REMOTE_URL', 'https://down.example');
    expect(await remoteNav(AREAS.timeoff)).toBeNull();
  });

  it('is no screen for a path no remote owns', async () => {
    expect(areaOf('/time-offer')).toBeUndefined();
    expect(await remoteRoute('/settings/shortcuts')).toBeUndefined();
    expect(asked).toEqual([]);
  });
});

describe('the Time Off manifest', () => {
  const nav = matchRoute(timeOff, '/time-off/overview')?.nav ?? {
    sections: [],
    actions: [],
    settings: [],
  };
  const employee = placesFor(nav, { hr: false, admin: false, finance: false });
  const hr = placesFor(nav, { hr: true, admin: false, finance: false });

  it('is a manifest the shell reads, every route its own screen', () => {
    expect(matchRoute(timeOff, '/time-off/overview')).toMatchObject({ component: 'Overview' });
    expect(matchRoute(timeOff, '/time-off/requests/r-1')).toMatchObject({
      component: 'RequestDetail',
      params: { id: 'r-1' },
    });
    expect(matchRoute(timeOff, '/time-off/requests/past')?.component).toBe('MyRequestsPast');
    expect(matchRoute(timeOff, '/time-off')).toBeUndefined();
  });

  it('sends a bare /time-off to the overview, and a bare section to its first tab for the viewer', () => {
    expect(firstUnder(employee.sections, '/time-off')).toBe('/time-off/overview');
    expect(firstUnder(employee.sections, '/time-off/attendance')).toBe(
      '/time-off/attendance/timesheet',
    );
    expect(firstUnder(hr.sections, '/time-off/attendance')).toBe('/time-off/attendance/now');
    expect(firstUnder(employee.sections, '/time-off/insights')).toBeUndefined();
  });

  it('frames a screen as Time off › section, with the section’s tabs', () => {
    const frame = headerFrame(hr, '/time-off/approvals/decided', '/time-off', {}, 'Time off');
    expect(frame).toMatchObject({ section: 'Requests', siblingsLabel: 'Time off sections' });
    expect(frame.tabs?.find((t) => t.current)?.label).toBe('Decided');
    expect(frame.siblings[0]?.label).toBe('Time off');
  });
});
