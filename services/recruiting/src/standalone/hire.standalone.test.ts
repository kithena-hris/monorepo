import { describe, it } from 'vitest';

import { memoryBlobs, memoryUnitOfWork } from '../testing/memory.js';
import { hireInSpain, memoryHarness } from '../testing/scenario.js';

/**
 * One candidate from a requisition to a pre-hire (REC-099), with People,
 * Documents and Time Off absent and no AI key: every sibling is aliased to a
 * file that throws, and the contract is uploaded signed, as a company
 * without Documents does.
 */
describe('Recruiting alone: requisition to pre-hire, in Spain', () => {
  it('hires a candidate and hands them over by event', async () => {
    await hireInSpain(memoryHarness(memoryUnitOfWork(), memoryBlobs()));
  });
});
