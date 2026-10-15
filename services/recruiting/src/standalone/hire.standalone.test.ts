import { describe, it } from 'vitest';

import { memoryBlobs, memoryUnitOfWork } from '../testing/memory.js';
import { PLACES, hireIn, memoryHarness } from '../testing/scenario.js';

/**
 * One candidate from a requisition to a pre-hire per launch country (REC-099),
 * with People, Documents and Time Off absent and no AI key: every sibling is
 * aliased to a file that throws, and the contract is uploaded signed, as a
 * company without Documents does.
 */
describe('Recruiting alone: requisition to pre-hire', () => {
  it.each(Object.values(PLACES).map((p) => [p.country, p] as const))(
    'hires a candidate in %s and hands them over by event',
    async (_, place) => {
      await hireIn(memoryHarness(memoryUnitOfWork(), memoryBlobs()), place);
    },
  );
});
