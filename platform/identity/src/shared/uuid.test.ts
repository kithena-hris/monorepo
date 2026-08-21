import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { uuidv7 } from './uuid.js';

/**
 * The identifier every event envelope carries.
 *
 * Checked against Zod's own `uuidv7` rather than a regex written here, because
 * the contract validates with exactly that and a second opinion about the
 * format is a second thing that can be wrong.
 */
describe('uuidv7', () => {
  it('satisfies the schema the contract validates with', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(z.uuidv7().safeParse(uuidv7()).success).toBe(true);
    }
  });

  it('sorts by time as a string, which is the whole point', () => {
    // The outbox is ordered by this value. If it did not sort lexicographically
    // in time order, per-aggregate ordering downstream would need a sequence
    // column that does not exist.
    const early = uuidv7(1_700_000_000_000);
    const late = uuidv7(1_800_000_000_000);
    expect(early < late).toBe(true);
  });

  it('does not collide within a millisecond', () => {
    // 74 random bits per id. A thousand at the same timestamp should be
    // distinct, and if they are not, the randomness is not being applied.
    const at = 1_750_000_000_000;
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(at)));
    expect(ids.size).toBe(1000);
  });

  it('encodes the timestamp where a reader would look for it', () => {
    const at = 1_750_000_000_000;
    const hex = uuidv7(at).replace(/-/g, '').slice(0, 12);
    expect(Number.parseInt(hex, 16)).toBe(at);
  });
});
