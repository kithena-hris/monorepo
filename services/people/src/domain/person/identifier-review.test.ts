import { describe, expect, it } from 'vitest';

import { decideReview, onIdentifierWritten, type IdentifierReview } from './identifier-review.js';

const mismatch = { level: 'mismatch', code: 'check_mismatch', message: 'm' } as const;
const attention = { level: 'attention', code: 'suffix_missing', message: 'a' } as const;
const fine = { level: 'ok', code: 'check_ok', message: 'o' } as const;

const review = (state: IdentifierReview['state']): IdentifierReview => ({
  id: 'r1',
  personId: 'p1',
  attributeKey: 'es_nif',
  historyId: 'h1',
  pendingChangeId: null,
  valueHash: 'hash',
  keyId: 'k1',
  findings: [mismatch],
  state,
  createdAt: '2026-09-24T08:00:00.000Z',
  decidedBy: state === 'accepted' || state === 'sent_back' ? 'hr' : null,
  decidedAt: state === 'accepted' || state === 'sent_back' ? '2026-09-24T09:00:00.000Z' : null,
  note: null,
});

describe('a national identifier written', () => {
  it('opens a review when a finding is worse than ok', () => {
    expect(
      onIdentifierWritten({ findings: [mismatch], latest: null, sameAsLatest: false }),
    ).toEqual({ supersede: false, open: true });
    expect(
      onIdentifierWritten({ findings: [attention], latest: null, sameAsLatest: false }),
    ).toEqual({ supersede: false, open: true });
  });

  it('opens nothing for a value every check passed', () => {
    expect(onIdentifierWritten({ findings: [fine], latest: null, sameAsLatest: false })).toEqual({
      supersede: false,
      open: false,
    });
  });

  it('supersedes the open review a new value replaces, flagged or not', () => {
    expect(
      onIdentifierWritten({ findings: [fine], latest: review('pending'), sameAsLatest: false }),
    ).toEqual({ supersede: true, open: false });
    expect(
      onIdentifierWritten({
        findings: [mismatch],
        latest: review('sent_back'),
        sameAsLatest: false,
      }),
    ).toEqual({ supersede: true, open: true });
  });

  it('never flags again a value the reviewer accepted: the decision is final', () => {
    expect(
      onIdentifierWritten({ findings: [mismatch], latest: review('accepted'), sameAsLatest: true }),
    ).toEqual({ supersede: false, open: false });
  });

  it('flags a different value written after an acceptance', () => {
    expect(
      onIdentifierWritten({
        findings: [mismatch],
        latest: review('accepted'),
        sameAsLatest: false,
      }),
    ).toEqual({ supersede: false, open: true });
  });

  it('flags the same value again after a send-back: sending it back was not accepting it', () => {
    expect(
      onIdentifierWritten({
        findings: [mismatch],
        latest: review('sent_back'),
        sameAsLatest: true,
      }),
    ).toEqual({ supersede: true, open: true });
  });
});

describe('a reviewer deciding', () => {
  const at = '2026-09-24T10:00:00.000Z';

  it('accepts a pending review, finally', () => {
    const decided = decideReview(review('pending'), {
      decision: 'accept',
      by: 'hr-1',
      at,
      note: null,
    });
    expect(decided.ok && decided.value).toMatchObject({
      state: 'accepted',
      decidedBy: 'hr-1',
      decidedAt: at,
    });
  });

  it('sends a pending review back with a note', () => {
    const decided = decideReview(review('pending'), {
      decision: 'send_back',
      by: 'hr-1',
      at,
      note: '  The letter on your card is different  ',
    });
    expect(decided.ok && decided.value).toMatchObject({
      state: 'sent_back',
      note: 'The letter on your card is different',
    });
  });

  it('refuses a second decision on the same review', () => {
    for (const state of ['accepted', 'sent_back', 'superseded'] as const) {
      const decided = decideReview(review(state), {
        decision: 'accept',
        by: 'hr-1',
        at,
        note: null,
      });
      expect(!decided.ok && decided.error.code).toBe('REVIEW_DECIDED');
    }
  });

  it('never sends a value back without saying why: the employee has to know what to fix', () => {
    for (const note of [null, '   ']) {
      const decided = decideReview(review('pending'), { decision: 'send_back', by: 'hr-1', at, note });
      expect(!decided.ok && decided.error).toMatchObject({ code: 'REASON_REQUIRED', path: ['note'] });
    }
  });

  it('refuses a note longer than 500 characters', () => {
    const decided = decideReview(review('pending'), {
      decision: 'send_back',
      by: 'hr-1',
      at,
      note: 'x'.repeat(501),
    });
    expect(!decided.ok && decided.error.code).toBe('VALUE_INVALID');
  });
});
