import { describe, expect, it } from 'vitest';

import { findMatches, mergeDecision, type CandidateKey } from './duplicates.js';

const yuki: CandidateKey = {
  id: 'c1',
  email: 'Yuki.Sato@example.com',
  phone: '+34 612 345 678',
  name: 'Yuki Sato',
  cvHash: 'abc',
};
const tom: CandidateKey = {
  id: 'c2',
  email: 'tom@example.com',
  phone: null,
  name: 'Tom Becker',
  cvHash: 'def',
};

describe('duplicate candidates (PRD §11.2)', () => {
  it('joins on email whatever its case', () => {
    expect(
      findMatches({ email: ' yuki.sato@EXAMPLE.com', phone: null, name: 'Y. Sato', cvHash: null }, [
        yuki,
        tom,
      ]),
    ).toEqual([{ kind: 'same', candidateId: 'c1', by: 'email' }]);
  });

  it('only suggests on a phone, with or without its country code', () => {
    expect(
      findMatches(
        { email: 'other@example.com', phone: '612 345 678', name: 'Someone', cvHash: null },
        [yuki, tom],
      ),
    ).toEqual([{ kind: 'possible', candidateId: 'c1', by: 'phone' }]);
  });

  it('suggests on the same name and the same CV, accents aside', () => {
    expect(
      findMatches({ email: 'tb@example.org', phone: null, name: 'tom  becker', cvHash: 'def' }, [
        yuki,
        tom,
      ]),
    ).toEqual([{ kind: 'possible', candidateId: 'c2', by: 'name_and_cv' }]);
    expect(
      findMatches({ email: 'tb@example.org', phone: null, name: 'Tom Becker', cvHash: 'zzz' }, [
        yuki,
        tom,
      ]),
    ).toEqual([]);
  });

  it('never merges a candidate into itself', () => {
    expect(mergeDecision('c1', 'c1', 'ada', 'now')).toBeNull();
  });
});
