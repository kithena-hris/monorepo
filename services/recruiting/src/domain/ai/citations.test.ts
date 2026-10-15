import { describe, expect, it } from 'vitest';

import { keepCited } from './citations.js';

describe('a summary that cites its scorecards (PRD §22.3, R17)', () => {
  it('keeps a sentence only when every source it cites exists', () => {
    expect(
      keepCited(
        [
          { text: 'Both found the portfolio strong.', cites: ['s1', 's2'] },
          { text: 'One doubted the research depth.', cites: ['s2'] },
          { text: 'A third was unsure.', cites: ['s9'] },
          { text: 'Overall, hire.', cites: [] },
        ],
        new Set(['s1', 's2']),
      ),
    ).toEqual([
      { text: 'Both found the portfolio strong.', cites: ['s1', 's2'] },
      { text: 'One doubted the research depth.', cites: ['s2'] },
    ]);
  });
});
