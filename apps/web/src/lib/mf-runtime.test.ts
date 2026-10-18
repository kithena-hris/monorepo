import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MF_IMPORT_MAP, MF_RUNTIME_URL, MF_RUNTIME_VERSION } from './mf-runtime';

describe('the shared federation runtime', () => {
  it('is the version the shell pins, so remotes and shell run one runtime', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@module-federation/runtime']).toBe(MF_RUNTIME_VERSION);
  });

  it('names every specifier a remote imports it by', () => {
    const map = JSON.parse(MF_IMPORT_MAP) as { imports: Record<string, string> };
    expect(map.imports).toEqual({
      '@module-federation/runtime': MF_RUNTIME_URL,
      '@module-federation/runtime/helpers': `/_mf/${MF_RUNTIME_VERSION}/helpers.mjs`,
    });
  });
});
