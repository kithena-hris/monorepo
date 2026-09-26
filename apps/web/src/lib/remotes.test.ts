import { describe, expect, it } from 'vitest';

import { matchRoute, placesFor } from './remotes';

describe('matchRoute', () => {
  const manifest = {
    routes: [
      { path: '/people', component: 'PeopleHome' },
      { path: '/people/:id', component: 'Profile' },
      { path: '/people/directory', component: 'Directory' },
    ],
  };

  it('names the component for a listed path', () => {
    expect(matchRoute(manifest, '/people')).toMatchObject({ component: 'PeopleHome', params: {} });
  });

  it('prefers a literal path to a pattern listed before it', () => {
    expect(matchRoute(manifest, '/people/directory')?.component).toBe('Directory');
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

  it('is null for something that is not a manifest', () => {
    expect(matchRoute({ routes: [{ path: 'people' }] }, '/people')).toBeNull();
    expect(matchRoute('<html>', '/people')).toBeNull();
  });

  it('carries the sections and actions, and none when a manifest lists none', () => {
    const nav = {
      sections: [{ path: '/people/directory', label: 'Directory' }],
      actions: [{ path: '/people/new', label: 'Add employee', for: ['hr'] }],
    };
    expect(matchRoute({ ...manifest, ...nav }, '/people')?.nav).toEqual(nav);
    expect(matchRoute(manifest, '/people')?.nav).toEqual({ sections: [], actions: [] });
  });
});

describe('placesFor', () => {
  const nav = {
    sections: [
      { path: '/people', label: 'Overview' },
      { path: '/people/import', label: 'Import', for: ['hr'] },
      { path: '/people/full-values', label: 'Full values', for: ['finance', 'hr'] },
    ],
    actions: [{ path: '/people/new', label: 'Add employee', for: ['hr'] }],
  };

  it('opens a place to any one of its roles, and everything unmarked to everybody', () => {
    const labels = (roles: Record<string, boolean>) => {
      const open = placesFor(nav, roles);
      return [...open.sections, ...open.actions].map((p) => p.label);
    };
    expect(labels({ hr: true })).toEqual(['Overview', 'Import', 'Full values', 'Add employee']);
    expect(labels({ finance: true, hr: false })).toEqual(['Overview', 'Full values']);
    expect(labels({})).toEqual(['Overview']);
  });
});
