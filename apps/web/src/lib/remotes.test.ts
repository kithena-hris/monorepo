import { describe, expect, it } from 'vitest';

import { matchRoute } from './remotes';

describe('matchRoute', () => {
  const manifest = {
    routes: [
      { path: '/people', component: 'PeopleHome' },
      { path: '/people/:id', component: 'Profile' },
      { path: '/people/directory', component: 'Directory' },
    ],
  };

  it('names the component for a listed path', () => {
    expect(matchRoute(manifest, '/people')).toEqual({ component: 'PeopleHome', params: {} });
  });

  it('prefers a literal path to a pattern listed before it', () => {
    expect(matchRoute(manifest, '/people/directory')?.component).toBe('Directory');
  });

  it('reads a parameter out of a pattern', () => {
    expect(matchRoute(manifest, '/people/0190a3c4-0000-7000-8000-000000000001')).toEqual({
      component: 'Profile',
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
});
