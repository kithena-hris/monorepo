import { describe, expect, it } from 'vitest';

import { enrolmentState, type EnrolmentRow } from './enrolment-state.js';

const NOW = new Date('2026-08-29T12:00:00.000Z');

/** A first link, live, for somebody who has not enrolled yet. */
const invitation: EnrolmentRow = {
  purpose: 'invitation',
  expiresAt: '2026-08-31T12:00:00.000Z',
  consumedAt: null,
  accountStatus: 'invited',
};

/** A replacement link, live, for somebody who lost their passkey. */
const recovery: EnrolmentRow = { ...invitation, purpose: 'recovery', accountStatus: 'active' };

describe('enrolmentState, on an invitation', () => {
  it('is usable while the link is live and the account is waiting', () => {
    expect(enrolmentState(invitation, NOW)).toBe('usable');
  });

  /*
   * The returning-to-a-bookmark case, and the only one that should ever say
   * this. Somebody opens their original signup link again, months later, from
   * a device that already has their passkey.
   */
  it('says the passkey is already set up once the account is active', () => {
    expect(enrolmentState({ ...invitation, consumedAt: NOW.toISOString(), accountStatus: 'active' }, NOW))
      .toBe('already_enrolled');
  });

  it('distinguishes a spent link from a finished one', () => {
    // Spent but not enrolled: the device refused halfway. They need a new link,
    // not a sign-in page they cannot use.
    expect(enrolmentState({ ...invitation, consumedAt: NOW.toISOString() }, NOW)).toBe('spent');
  });

  it('reports an expired link as expired while it is still unused', () => {
    expect(enrolmentState({ ...invitation, expiresAt: '2026-08-29T11:59:59.000Z' }, NOW))
      .toBe('expired');
  });

  it('treats the expiry instant itself as expired', () => {
    expect(enrolmentState({ ...invitation, expiresAt: NOW.toISOString() }, NOW)).toBe('expired');
  });
});

describe('enrolmentState, on a recovery link', () => {
  /*
   * The bug this column exists for. A recovery link is *always* issued to an
   * active account — that is what recovery is — and the page used to read that
   * as "you already have a passkey", blocking the flow the email had just
   * started and offering a sign-in the person could not complete.
   *
   * Coming from a recovery link means setting up a passkey. Nothing about the
   * account changes that.
   */
  it('goes straight to setup, whatever the account says', () => {
    expect(enrolmentState(recovery, NOW)).toBe('usable');
    expect(enrolmentState({ ...recovery, accountStatus: 'invited' }, NOW)).toBe('usable');
  });

  /*
   * Spent is the one thing a live link cannot survive: the token is single-use
   * and the row is consumed. They need another, which is a different message
   * from "you already have a passkey" — and on an active account that is
   * exactly what they now have.
   */
  it('sends somebody back for another link once this one is spent', () => {
    expect(enrolmentState({ ...recovery, consumedAt: NOW.toISOString() }, NOW))
      .toBe('already_enrolled');
    expect(
      enrolmentState({ ...recovery, consumedAt: NOW.toISOString(), accountStatus: 'invited' }, NOW),
    ).toBe('spent');
  });

  it('expires like any other link', () => {
    expect(enrolmentState({ ...recovery, expiresAt: '2026-08-29T11:59:59.000Z' }, NOW))
      .toBe('already_enrolled');
  });
});

describe('enrolmentState, on anything else', () => {
  it('treats a missing row as unknown', () => {
    expect(enrolmentState(null, NOW)).toBe('unknown');
  });

  /*
   * Suspended, terminated or merely provisioned is not a state to walk somebody
   * through. They cannot act on the difference and their HR team can.
   */
  it('refuses an account enrolment does not apply to, whatever the link', () => {
    for (const accountStatus of ['suspended', 'terminated', 'provisioned'] as const) {
      expect(enrolmentState({ ...invitation, accountStatus }, NOW), accountStatus).toBe('unknown');
      expect(enrolmentState({ ...recovery, accountStatus }, NOW), accountStatus).toBe('unknown');
    }
  });

  /*
   * A purpose this build has never heard of is treated as an invitation: the
   * stricter of the two, since it is the one that can refuse an active account.
   * A future third kind should not become a way past that by being unknown.
   */
  it('treats an unrecognised purpose as the stricter kind', () => {
    const odd = { ...recovery, purpose: 'something-new' } as unknown as EnrolmentRow;
    expect(enrolmentState(odd, NOW)).toBe('already_enrolled');
  });
});
