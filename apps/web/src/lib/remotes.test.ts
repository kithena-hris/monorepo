import { describe, expect, it } from 'vitest';

import { matchRoute } from './remotes';

describe('matchRoute', () => {
  const manifest = { routes: [{ path: '/people', component: 'PeopleHome' }] };

  it('names the component for a listed path', () => {
    expect(matchRoute(manifest, '/people')).toBe('PeopleHome');
  });

  it('is undefined for a path the remote does not list', () => {
    expect(matchRoute(manifest, '/people/nobody')).toBeUndefined();
  });

  it('is null for something that is not a manifest', () => {
    expect(matchRoute({ routes: [{ path: 'people' }] }, '/people')).toBeNull();
    expect(matchRoute('<html>', '/people')).toBeNull();
  });
});
