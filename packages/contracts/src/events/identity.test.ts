import { describe, expect, it } from 'vitest';

import { AccountProfileCaptured } from './identity.js';

/**
 * What the enrolment event is allowed to carry.
 *
 * The rule worth a test is a negative one. Identity asks for a mobile number
 * at enrolment because HR-mediated recovery needs a second channel, and the
 * obvious next move — putting it in the event so the People module does not
 * have to ask again — is the one that must stay impossible. A number in this
 * payload is a number in the topic, in every consumer's log, in every backup
 * of those logs and in a subject access request that now has to find them all.
 *
 * `mobilePresent` is what a consumer actually needs: whether a second channel
 * exists. People asks for the number itself, on its own form, classified as
 * contact data, with its own retention.
 */
describe('identity.account.profile_captured', () => {
  const payload = {
    accountId: '00000000-0000-4000-8000-0000000000a1',
    identityId: '00000000-0000-4000-8000-0000000000d1',
    name: { given: 'Ada', family: 'Lovelace', preferred: null },
    timeZone: 'Europe/Madrid',
    mobilePresent: true,
    capturedAt: '2026-03-02T09:00:00.000Z',
  };

  it('has no mobile field to put a number in', () => {
    expect(Object.keys(AccountProfileCaptured.payload.shape)).toEqual([
      'accountId',
      'identityId',
      'name',
      'timeZone',
      'mobilePresent',
      'capturedAt',
    ]);
  });

  it('drops a number smuggled in beside the boolean', () => {
    // Zod strips unknown keys rather than refusing them, so the assertion is
    // on what survives parsing: a caller adding `mobile` publishes nothing.
    const parsed = AccountProfileCaptured.payload.parse({ ...payload, mobile: '+34 600 123 456' });
    expect(parsed).not.toHaveProperty('mobile');
    expect(JSON.stringify(parsed)).not.toContain('600');
  });

  it('refuses a payload that says nothing about the second channel', () => {
    const without: Record<string, unknown> = { ...payload };
    delete without['mobilePresent'];
    expect(AccountProfileCaptured.payload.safeParse(without).success).toBe(false);
  });

  it('accepts the shape the aggregate raises', () => {
    expect(AccountProfileCaptured.payload.safeParse(payload).success).toBe(true);
  });
});
