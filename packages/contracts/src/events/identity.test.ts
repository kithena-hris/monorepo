import { describe, expect, it } from 'vitest';

import {
  AccountProfileCaptured,
  AccountSignupAnswered,
  SupportSessionStarted,
} from './identity.js';

describe('identity.support.session_started', () => {
  const payload = {
    sessionId: '00000000-0000-4000-8000-0000000000b1',
    accountId: '00000000-0000-4000-8000-0000000000a1',
    operatorId: '00000000-0000-4000-8000-0000000000f1',
    operatorEmail: 'jane@kithena.com',
    reason: 'Ticket 4411: the import is stuck',
    expiresAt: '2026-09-29T11:00:00.000Z',
  };

  it('always says why: a sign-in as support without a reason is not one', () => {
    expect(SupportSessionStarted.payload.safeParse(payload).success).toBe(true);
    expect(SupportSessionStarted.payload.safeParse({ ...payload, reason: '' }).success).toBe(false);
  });
});

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

/**
 * The values ride this event, which is acceptable only because they can be
 * nothing but flat answers to questions classified no higher than internal.
 */
describe('identity.account.signup_answered', () => {
  const payload = {
    accountId: '00000000-0000-4000-8000-0000000000a1',
    schemaVersion: 3,
    answers: { t_shirt: 'm', years_experience: 4, badge_photo_ok: true },
    answeredAt: '2026-09-27T09:00:00.000Z',
  };

  it('accepts the shape the aggregate raises', () => {
    expect(AccountSignupAnswered.payload.safeParse(payload).success).toBe(true);
  });

  it('refuses an answer that is an object or a list', () => {
    for (const bad of [{ line1: 'x' }, ['a']]) {
      const answers = { ...payload.answers, address: bad };
      expect(AccountSignupAnswered.payload.safeParse({ ...payload, answers }).success).toBe(false);
    }
  });

  it('refuses a key the registry could not hold', () => {
    const answers = { 'Not A Key': 'x' };
    expect(AccountSignupAnswered.payload.safeParse({ ...payload, answers }).success).toBe(false);
  });
});
