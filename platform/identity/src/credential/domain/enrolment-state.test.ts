import { describe, expect, it } from 'vitest';

import { enrolmentState, type EnrolmentRow } from './enrolment-state.js';

const NOW = new Date('2026-08-29T12:00:00.000Z');

const live: EnrolmentRow = {
  expiresAt: '2026-08-31T12:00:00.000Z',
  consumedAt: null,
  accountStatus: 'invited',
};

describe('enrolmentState', () => {
  it('is usable while the link is live and the account is waiting', () => {
    expect(enrolmentState(live, NOW)).toBe('usable');
  });

  /*
   * The state this exists for. Somebody follows their link a second time —
   * from a bookmark, a second device, or because they forgot they had already
   * done it — and the old page ran the whole biometric ceremony before telling
   * them the link was spent. This is knowable before the prompt.
   */
  it('says the passkey is already set up once the account is active', () => {
    expect(enrolmentState({ ...live, consumedAt: NOW.toISOString(), accountStatus: 'active' }, NOW))
      .toBe('already_enrolled');
  });

  /*
   * Spent but *not* enrolled is a different thing to be told. The token is
   * burnt on presentation whether or not registration succeeded, so this is
   * somebody whose device refused halfway — they need a new link, not a
   * sign-in page they cannot use.
   */
  it('distinguishes a spent link from a finished one', () => {
    expect(enrolmentState({ ...live, consumedAt: NOW.toISOString() }, NOW)).toBe('spent');
  });

  /*
   * The bug this function shipped with. A recovery link is *always* issued to
   * an active account — that is what recovery is — and the first version
   * answered `already_enrolled` for any active account regardless of the link.
   * Somebody who had just asked for a new passkey was told they already had
   * one and offered a sign-in they could not complete.
   *
   * A live link wins. It is the more specific fact, and it is the one the
   * person is holding.
   */
  it('lets an active account use a live link, which is what recovery is', () => {
    expect(enrolmentState({ ...live, accountStatus: 'active' }, NOW)).toBe('usable');
  });

  it('reports an expired link as expired while it is still unused', () => {
    expect(enrolmentState({ ...live, expiresAt: '2026-08-29T11:59:59.000Z' }, NOW)).toBe('expired');
  });

  /*
   * Enrolled wins over expired. A link that ran out yesterday for somebody who
   * used it last week should send them to sign in, not tell them to ask for a
   * replacement they do not need.
   */
  it('prefers already-enrolled over expired', () => {
    expect(
      enrolmentState(
        { expiresAt: '2026-08-01T00:00:00.000Z', consumedAt: '2026-08-01T00:00:00.000Z', accountStatus: 'active' },
        NOW,
      ),
    ).toBe('already_enrolled');
  });

  it('treats a missing row as unknown', () => {
    expect(enrolmentState(null, NOW)).toBe('unknown');
  });

  /*
   * An account that is not `invited` and not `active` — suspended, terminated,
   * or still merely provisioned — is not something to walk somebody through.
   * It is refused as unknown rather than described, because the person reading
   * cannot act on the difference and their HR team can.
   */
  it('refuses an account in a state enrolment does not apply to', () => {
    for (const accountStatus of ['suspended', 'terminated', 'provisioned'] as const) {
      expect(enrolmentState({ ...live, accountStatus }, NOW), accountStatus).toBe('unknown');
    }
  });

  it('treats the expiry instant itself as expired', () => {
    expect(enrolmentState({ ...live, expiresAt: NOW.toISOString() }, NOW)).toBe('expired');
  });
});
