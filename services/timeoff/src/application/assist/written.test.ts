import { describe, expect, it } from 'vitest';

import { recordingWriter } from '../testing/assist.js';
import { accept, written } from './written.js';

const facts = { day: 'Wed 21 Oct', in: 4, of: 7, left: '11.500' };
const lines = {
  reason: { about: 'Why it needs a look', template: 'Wed 21 Oct drops to 4 of 7.' },
};

describe('written', () => {
  it('is the template, not tagged, with no writer', async () => {
    expect(await written(undefined, 't', { instruction: 'x', facts }, lines)).toEqual({
      reason: { text: 'Wed 21 Oct drops to 4 of 7.', ai: false },
    });
  });

  it('is the model’s line, tagged, with the placeholder filled in after', async () => {
    const writer = recordingWriter(() => '{who} would leave 4 of 7 in on Wed 21 Oct.');
    const out = await written(writer, 't', { instruction: 'x', facts }, lines, { who: 'Adam' });
    expect(out.reason).toEqual({ text: 'Adam would leave 4 of 7 in on Wed 21 Oct.', ai: true });
    // The model never saw the name, nor the template.
    expect(JSON.stringify(writer.asks)).not.toContain('Adam');
    expect(JSON.stringify(writer.asks)).not.toContain('drops to');
  });

  it('falls back line by line when the model says nothing for one', async () => {
    const out = await written(
      recordingWriter(() => null),
      't',
      { instruction: 'x', facts },
      lines,
    );
    expect(out.reason.ai).toBe(false);
  });
});

describe('accept', () => {
  it('refuses a number the domain did not compute', () => {
    expect(accept('Only 3 of 7 are in.', facts, {})).toBeNull();
    expect(accept('Leaves 11.5 days.', facts, {})).toBe('Leaves 11.5 days.');
  });

  it('refuses an unfilled placeholder, a stray brace, two lines and an essay', () => {
    expect(accept('{boss} is away.', facts, { who: 'Adam' })).toBeNull();
    expect(accept('Fine {', facts, {})).toBeNull();
    expect(accept('One.\nTwo.', facts, {})).toBeNull();
    expect(accept('a'.repeat(400), facts, {})).toBeNull();
    expect(accept(42, facts, {})).toBeNull();
  });
});
