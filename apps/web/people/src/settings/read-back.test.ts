import { describe, expect, it } from 'vitest';

import { readBack, summary } from './read-back';

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

describe('summary', () => {
  const tshirt = {
    label: 'T-shirt size',
    ownership: ['employee', 'hr'] as const,
    collectAt: 'onboarding' as const,
    requiredness: 'never' as const,
    visibility: ['self', 'hr'] as const,
    rules: 0,
    classification: 'internal' as const,
    requiresApproval: false,
    encrypted: false,
  };

  it('reads a field back in plain sentences', () => {
    expect(summary(tshirt)).toBe(
      'The employee is asked for their T-shirt size during onboarding. It is optional. ' +
        'The employee and HR can change it. The employee and HR can see it. Not sensitive.',
    );
  });

  it('says the employee is never asked for an HR-only field, and what protects it', () => {
    expect(
      summary({
        ...tshirt,
        label: 'Bank account',
        ownership: ['hr'],
        collectAt: 'hr_only',
        requiredness: 'always',
        visibility: ['hr'],
        classification: 'confidential',
        requiresApproval: true,
        encrypted: true,
      }),
    ).toBe(
      'HR fills in Bank account; the employee is never asked for it. It is required for everyone. ' +
        'Only HR can change it. HR can see it. Confidential, so it is kept out of logs and AI; ' +
        'changes wait for a second HR member to approve them; it is stored encrypted.',
    );
  });
});
