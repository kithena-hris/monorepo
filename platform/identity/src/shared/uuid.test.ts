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

  it('sorts in minting order within one millisecond', () => {
    /*
     * The property that was missing, and the bug it caused.
     *
     * Two events raised by one transition are minted microseconds apart and
     * land in the same millisecond every time. With random bits in `rand_a`
     * they sorted against each other by coin flip, so an outbox read
     * `ORDER BY event_id` returned an evicted session after the one that
     * replaced it — about half the time, which is how it survived review and
     * then failed one integration run in three.
     */
    const ids = Array.from({ length: 5000 }, () => uuidv7());
    expect(ids).toEqual([...ids].toSorted());
  });

  it('keeps counting when the clock stands still', () => {
    // 5000 in a row is more than one millisecond's worth on any machine, so
    // the run above already crossed a boundary. This asserts the narrower
    // case: consecutive ids are strictly increasing, never equal.
    let previous = uuidv7();
    for (let i = 0; i < 2000; i += 1) {
      const next = uuidv7();
      expect(next > previous, `${next} should follow ${previous}`).toBe(true);
      previous = next;
    }
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
