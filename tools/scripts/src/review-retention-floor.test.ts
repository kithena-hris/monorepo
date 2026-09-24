import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { markReviewed } from './review-retention-floor.js';

const source = readFileSync(
  new URL('../../../services/people/src/domain/retention/floors.ts', import.meta.url),
  'utf8',
);
const review = { reviewer: "Ana García, O'Brien LLP", reviewedOn: '2026-10-01', reference: 'opinion 2026/114' };

describe('marking a retention floor reviewed (PEO-126)', () => {
  it('rewrites that one entry and leaves the others unreviewed', () => {
    const next = markReviewed(source, 'es-labour', review, '2026-10-02');
    expect(next).toContain(`  'es-labour': {\n    status: 'reviewed',\n    reviewer: 'Ana García, O\\'Brien LLP',`);
    expect(next).toContain(`  'de-labour': { status: 'unreviewed' },`);
    // And the entry it wrote is still one the script can find again.
    expect(markReviewed(next, 'es-labour', review, '2026-10-02')).toBe(next);
  });

  it('refuses without a reviewer, a real date or a reference, and a date in the future', () => {
    expect(() => markReviewed(source, 'es-labour', { ...review, reviewer: ' ' }, '2026-10-02')).toThrow(/reviewer/);
    expect(() => markReviewed(source, 'es-labour', { ...review, reference: '' }, '2026-10-02')).toThrow(/reference/);
    expect(() => markReviewed(source, 'es-labour', { ...review, reviewedOn: '1 Oct' }, '2026-10-02')).toThrow(/date/);
    expect(() => markReviewed(source, 'es-labour', review, '2026-09-30')).toThrow(/future/);
  });
});
