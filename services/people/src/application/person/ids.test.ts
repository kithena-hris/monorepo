import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { uuidv7 } from './ids.js';

describe('uuidv7', () => {
  it('is what the envelope contract accepts, and sorts in minting order', () => {
    const ids = Array.from({ length: 50 }, () => uuidv7());
    for (const id of ids) expect(z.uuidv7().safeParse(id).success).toBe(true);
    expect(ids.toSorted()).toEqual(ids);
  });
});
