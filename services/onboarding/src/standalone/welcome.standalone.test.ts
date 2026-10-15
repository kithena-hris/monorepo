import { describe, it } from 'vitest';

import { memoryUnitOfWork } from '../testing/memory.js';
import { welcomeAndReview } from '../testing/scenario.js';

/**
 * One new hire from Recruiting's handover to a probation review (ONB-015),
 * with People and Recruiting absent: every sibling is aliased to a file that
 * throws, and their events arrive as data.
 */
describe('Onboarding alone: a hire to a probation review', () => {
  it('starts a plan, welcomes the new hire, and records the review by event', async () => {
    const uow = memoryUnitOfWork();
    await welcomeAndReview({
      uow,
      events: (tenantId) =>
        Promise.resolve(
          uow
            .events(tenantId as never)
            .map((e) => ({ eventName: e.eventName, payload: e.payload })),
        ),
    });
  });
});
