import { describe, expect, it } from 'vitest';

import { mayStartBackgroundCheck } from './background.js';

describe('when a background check may start (PRD §17.2)', () => {
  it('waits for a conditional offer, then allows it where the pack does', () => {
    expect(mayStartBackgroundCheck('US', false)).toEqual({ ok: false, reason: 'after_offer' });
    expect(mayStartBackgroundCheck('US', true)).toEqual({ ok: true });
    expect(mayStartBackgroundCheck('GB', true)).toEqual({ ok: true });
  });

  it('refuses in Germany and Spain, where only a law for the role allows one', () => {
    expect(mayStartBackgroundCheck('DE', true)).toEqual({ ok: false, reason: 'not_lawful' });
    expect(mayStartBackgroundCheck('ES', true)).toEqual({ ok: false, reason: 'not_lawful' });
  });
});
