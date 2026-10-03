import { describe, expect, it } from 'vitest';

import timeOff from '../../timeoff/public/routes.json';
import { matchRoute, placesFor } from './remotes';
import { EMPTY_SHELL } from './shell-data';
import { settingsModules } from './settings-modules';

const nav = matchRoute(timeOff, '/time-off/overview')?.nav ?? {
  sections: [],
  actions: [],
  settings: [],
};

describe('settingsModules', () => {
  it('gives Time off a group of its own from its manifest, cut to the viewer’s roles', () => {
    const roles = { hr: true, admin: false, finance: false };
    const modules = settingsModules(
      { ...EMPTY_SHELL, roles, remotes: { timeoff: { ...placesFor(nav, roles), routes: [] } } },
      { now: {}, attention: {} },
      'The defaults',
    );
    const group = modules.find((m) => m.key === 'time-off');
    expect(group?.settings.map((s) => s.label)).toEqual([
      'Leave types',
      'Holidays',
      'Negative balance',
      'Attendance',
      'Approvals',
    ]);
  });

  it('has no Time off group for somebody who may change none of it', () => {
    const roles = EMPTY_SHELL.roles;
    const modules = settingsModules(
      { ...EMPTY_SHELL, remotes: { timeoff: { ...placesFor(nav, roles), routes: [] } } },
      { now: {}, attention: {} },
      'The defaults',
    );
    expect(modules.map((m) => m.key)).toEqual(['you']);
  });
});
