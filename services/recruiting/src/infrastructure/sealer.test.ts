import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { aesSealer } from './sealer.js';

describe('sealing self-ID (PRD §24.4)', () => {
  const sealer = aesSealer(randomBytes(32));
  const plain = new TextEncoder().encode('{"gender":"woman"}');

  it('opens only for the row it was sealed to', () => {
    const sealed = sealer.seal(plain, 'app-1');
    expect(new TextDecoder().decode(sealer.open(sealed, 'app-1') ?? new Uint8Array())).toBe(
      '{"gender":"woman"}',
    );
    expect(sealer.open(sealed, 'app-2')).toBeNull();
  });

  it('does not open under another key', () => {
    expect(aesSealer(randomBytes(32)).open(sealer.seal(plain, 'app-1'), 'app-1')).toBeNull();
  });
});
