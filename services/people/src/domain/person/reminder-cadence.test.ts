import { describe, expect, it } from 'vitest';

import { reminderDueBefore } from './reminder-cadence.js';

/**
 * §8.4 as the product owner settled it: day 1, then weekly, and never more
 * than one reminder email per person per week. The cap wins over the PRD's
 * day 1 / 3 / 7 list, so the schedule left is "the first sweep after the gap
 * opens, then every 168 hours".
 */
describe('reminderDueBefore', () => {
  const now = new Date('2026-09-30T09:00:00.000Z');

  it('is 168 hours before now, so a person last emailed at or before it is due again', () => {
    expect(reminderDueBefore(now).toISOString()).toBe('2026-09-23T09:00:00.000Z');
  });

  it('counts hours, not calendar days, so a DST change cannot let two through 167 hours apart', () => {
    // 29 March 2026 is the EU spring-forward; a local "7 days" would be 167h.
    const afterChange = new Date('2026-04-01T09:00:00.000Z');
    expect(afterChange.getTime() - reminderDueBefore(afterChange).getTime()).toBe(168 * 3_600_000);
  });
});
