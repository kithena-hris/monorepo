import { describe, expect, it } from 'vitest';

import { checkParts } from './split.js';

describe('splitting a scan into its documents (C2)', () => {
  it('takes parts that cover every page, in order, once', () => {
    expect(checkParts([{ from: 1, to: 2 }, { from: 3, to: 3 }, { from: 4, to: 6 }], 6).ok).toBe(true);
  });

  it('refuses a gap, an overlap, a page the scan lacks, and no parts', () => {
    expect(checkParts([{ from: 1, to: 2 }, { from: 4, to: 6 }], 6)).toMatchObject({ ok: false });
    expect(checkParts([{ from: 1, to: 3 }, { from: 3, to: 6 }], 6)).toMatchObject({ ok: false });
    expect(checkParts([{ from: 1, to: 7 }], 6)).toMatchObject({ ok: false });
    expect(checkParts([], 6)).toMatchObject({ ok: false });
  });
});
