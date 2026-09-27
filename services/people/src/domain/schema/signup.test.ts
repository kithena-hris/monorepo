import { describe, expect, it } from 'vitest';

import { define } from '../../application/person/in-memory.js';
import { signupQuestions } from './signup.js';

/**
 * Which fields the auth origin asks before the passkey (PRD §8.3): the ones
 * the tenant placed at sign-up or enrolment, and only those the page is
 * allowed to hold — nothing confidential, financial, encrypted or
 * special-category, nothing the employee may not write.
 */

const asked = (over: Parameters<typeof define>[0]) =>
  define({ ownership: ['employee'], collectAt: 'signup', ...over });

describe('the sign-up questions', () => {
  it('asks what the tenant placed at sign-up or enrolment, in order, with what a form needs', () => {
    const questions = signupQuestions([
      asked({ key: 'badge_name', order: 2, typeConfig: { kind: 'text', maxLength: 40 } }),
      asked({
        key: 't_shirt',
        order: 1,
        collectAt: 'enrolment',
        dataType: 'select',
        typeConfig: {
          kind: 'select',
          options: [
            { value: 's', label: { default: 'Small' } },
            { value: 'xl', label: { default: 'XL' }, retiredAt: '2026-01-01T00:00:00.000Z' },
          ],
        },
        requiredness: { mode: 'always' },
        visibility: ['self'],
      }),
      asked({ key: 'onboarding_only', collectAt: 'onboarding' }),
    ]);
    expect(questions).toEqual([
      {
        key: 't_shirt',
        label: 't_shirt',
        description: null,
        dataType: 'select',
        required: true,
        // A retired option is kept on records that hold it, never offered.
        options: [{ value: 's', label: 'Small' }],
        maxLength: null,
        min: null,
        max: null,
        decimals: null,
        classification: 'internal',
      },
      expect.objectContaining({ key: 'badge_name', maxLength: 40, required: false }),
    ]);
  });

  it('never asks for anything above internal, encrypted, or financial', () => {
    const confidential = {
      classification: 'confidential',
      piiKind: 'contact',
      exportable: true,
      aiEligible: false,
    } as const;
    expect(
      signupQuestions([
        asked({
          key: 'home_phone',
          dataType: 'phone',
          typeConfig: { kind: 'phone' },
          classification: confidential,
        }),
        asked({ key: 'secret_word', encrypted: true, includeInEvents: false }),
      ]),
    ).toEqual([]);
  });

  it('leaves out what the employee may not write, what is retired and what the page cannot render', () => {
    expect(
      signupQuestions([
        asked({ key: 'hr_note', ownership: ['hr'] }),
        asked({ key: 'old', deprecatedAt: '2026-01-01T00:00:00.000Z' }),
        asked({ key: 'office', dataType: 'location_ref', typeConfig: { kind: 'location_ref' } }),
        asked({ key: 'skills', cardinality: 'repeating' }),
      ]),
    ).toEqual([]);
  });

  it('leaves the name to identity, which asks it on the same page', () => {
    expect(
      signupQuestions([asked({ key: 'given_name' }), asked({ key: 'preferred_name' })]),
    ).toEqual([]);
  });
});
