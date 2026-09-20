import { describe, expect, it } from 'vitest';

import { mayInvite, mayWithdrawInvitation } from './invitation.js';

/**
 * Withdrawing an invitation deletes rows, so the question it answers is "is
 * there anything here worth keeping". Every case below is a state where the
 * answer changes.
 */
describe('mayWithdrawInvitation', () => {
  it('allows withdrawing a link nobody has used', () => {
    for (const status of ['provisioned', 'invited']) {
      expect(mayWithdrawInvitation(status).ok).toBe(true);
    }
  });

  it('refuses an enrolled account, because that is termination and not a cancelled invitation', () => {
    const result = mayWithdrawInvitation('active');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ALREADY_ENROLLED');
  });

  it('refuses a suspended or terminated account rather than quietly deleting it', () => {
    for (const status of ['suspended', 'terminated']) {
      const result = mayWithdrawInvitation(status);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_AN_INVITATION');
    }
  });

  it('refuses a state it has never heard of', () => {
    // The safe direction. A state whose rules this does not know is not one to
    // start deleting an account in.
    const result = mayWithdrawInvitation('probationary');
    expect(result.ok).toBe(false);
  });

  it('allows exactly the states a fresh link may be issued for', () => {
    // The two rules are mirrors, and a state where one says yes and the other
    // says no is a state where the menu would offer an action that fails. The
    // only difference is meant to be `active`: recoverable, not withdrawable.
    for (const status of ['provisioned', 'invited', 'suspended', 'terminated', 'nonsense']) {
      expect(mayWithdrawInvitation(status).ok).toBe(mayInvite(status).ok);
    }
    expect(mayInvite('active').ok).toBe(false);
    expect(mayWithdrawInvitation('active').ok).toBe(false);
  });
});
