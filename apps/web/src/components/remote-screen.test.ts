import { createInstance } from '@module-federation/runtime';
import { describe, expect, it } from 'vitest';

import { shellShared } from './remote-screen';

/**
 * A remote built with `import: false` registers an entry that only throws.
 * Named "timeoff", it sorts after "shell", and federation's tie-break between
 * two unloaded entries at one version used to hand the shell the remote's.
 */
describe('the shell’s share scope', () => {
  it('keeps the shell’s Reach when a remote whose name sorts later joins it', async () => {
    const shell = createInstance({ name: 'shell', remotes: [], shared: shellShared() });
    const remote = createInstance({
      name: 'timeoff',
      remotes: [],
      shared: {
        '@reach/ui': {
          version: '0.0.0',
          get: () => {
            throw new Error('must be provided by host');
          },
          shareConfig: { singleton: true, requiredVersion: false },
        },
      },
    });
    const scope = shell.shareScopeMap['default'];
    if (scope === undefined) throw new Error('the shell registered no share scope');
    remote.initShareScopeMap('default', scope);
    await Promise.all(remote.initializeSharing('default'));

    const factory = await shell.loadShare<Record<string, unknown>>('@reach/ui');
    const reach = typeof factory === 'function' ? factory() : factory;
    expect(reach).toHaveProperty('Alert');
  });
});
