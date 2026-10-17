import { describe, expect, it } from 'vitest';

import { sessionCode } from './session-code';

describe('the code a scan read', () => {
  it('is the code itself, or the code a link carries', () => {
    expect(sessionCode(' Ab3dE9_x ')).toBe('Ab3dE9_x');
    expect(sessionCode('kithena://performance/scan?code=Ab3dE9_x')).toBe('Ab3dE9_x');
    expect(sessionCode('https://acme.app.kithena.com/performance/learning?code=Zz9')).toBe('Zz9');
  });

  it('keeps a link that carries none as it is, for the module to refuse', () => {
    expect(sessionCode('https://example.com/menu')).toBe('https://example.com/menu');
  });
});
