import { describe, expect, it } from 'vitest';

import { readBack } from './read-back';

describe('readBack', () => {
  it('reads the PRD example back', () => {
    expect(readBack(['employee', 'hr'], ['self', 'hr'])).toBe(
      'The employee can see and edit this. Their manager cannot. HR can see and edit this.',
    );
  });

  it('says so when a manager can see it', () => {
    expect(readBack(['hr'], ['self', 'manager', 'hr'])).toBe(
      'The employee can see it. Their manager can see it. HR can see and edit this.',
    );
  });

  it('mentions finance only when finance is involved', () => {
    expect(readBack(['finance'], ['finance'])).toContain('Finance can see and edit this.');
    expect(readBack(['hr'], ['hr'])).not.toContain('Finance');
  });

  it('names the directory', () => {
    expect(readBack(['employee'], ['directory'])).toContain(
      'Everyone can find it in the directory.',
    );
  });
});
