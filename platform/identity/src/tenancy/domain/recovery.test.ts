import { describe, expect, it } from 'vitest';

import { mayRecover } from './recovery.js';

describe('mayRecover', () => {
  /*
   * The state that separates this from `mayInvite`. An enrolled account is
   * refused there — "use recovery instead" — and is the ordinary case here.
   */
  it('allows an enrolled account, which is the whole point', () => {
    expect(mayRecover('active').ok).toBe(true);
  });

  it('allows an invited account that never took the link up', () => {
    // Asking for another link is the same request as the first one. Refusing
    // would send somebody to their HR team for something they can have.
    expect(mayRecover('invited').ok).toBe(true);
  });

  it('refuses an account nobody has invited yet', () => {
    // There is no confirmed address to recover *to*, so allowing this would
    // make recovery a way to enrol an account nobody invited.
    expect(mayRecover('provisioned').ok).toBe(false);
  });

  it('refuses a suspension or a termination', () => {
    // Neither is a lost passkey. A self-service path around a suspension is a
    // way to undo one.
    for (const status of ['suspended', 'terminated']) {
      expect(mayRecover(status).ok, status).toBe(false);
    }
  });

  it('refuses a state it has never heard of', () => {
    // The safe direction: a state whose rules this does not know is not one to
    // hand out a credential-bootstrapping link on.
    for (const status of ['', 'archived', 'ACTIVE']) {
      expect(mayRecover(status).ok, JSON.stringify(status)).toBe(false);
    }
  });
});
