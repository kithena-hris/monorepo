import { describe, expect, it } from 'vitest';

import { ModuleActivity, routeActivity } from './activity.js';

describe('a route’s write, as the activity log words it', () => {
  it('drops the screen code and names what it touched by the path’s id', () => {
    const said = routeActivity(
      { path: '/v1/recruiting/jobs/{id}/team', summary: 'R4: the hiring team' },
      { id: 'j1' },
    );
    expect(said).toMatchObject({
      area: 'records',
      action: 'The hiring team',
      subjectKind: 'job',
      subjectId: 'j1',
    });
    expect(ModuleActivity.safeParse(said).success).toBe(true);
  });

  it('files a settings route under settings, and an id-less write with no subject', () => {
    const said = routeActivity(
      { path: '/v1/onboarding/settings', summary: 'O7: who holds HR and IT' },
      {},
    );
    expect(said).toMatchObject({ area: 'settings', subjectKind: null, subjectId: null });
  });

  it('says a plural path’s noun in the singular', () => {
    expect(
      routeActivity({ path: '/v1/timeoff/policies/{id}', summary: 'Publish a policy' }, { id: 'p' })
        .subjectKind,
    ).toBe('policy');
  });
});
