import { describe, expect, it } from 'vitest';
import type { PersonId } from '@kithena/contracts';

import { audienceOf, checkAudience, progressOf, type Audience } from './campaign.js';

const m = (id: string, team: string | null, status = 'active') => ({
  personId: id as PersonId,
  teamKey: team,
  locationKey: null,
  status,
});
const members = [
  m('a', 'platform'),
  m('b', 'support'),
  m('c', 'support'),
  m('d', null, 'terminated'),
];

describe('who a policy goes to (F2)', () => {
  it('everyone who works here, teams, or named people', () => {
    expect(audienceOf({ kind: 'everyone' }, members)).toEqual(['a', 'b', 'c']);
    expect(audienceOf({ kind: 'teams', teamKeys: ['support'] }, members)).toEqual(['b', 'c']);
    expect(audienceOf({ kind: 'people', personIds: ['a', 'd'] as PersonId[] }, members)).toEqual([
      'a',
    ]);
  });

  it('refuses an empty audience', () => {
    expect(checkAudience({ kind: 'teams', teamKeys: [] } as Audience).ok).toBe(false);
  });
});

describe('tracking (F3)', () => {
  it('counts who is done of who is asked, new joiners included', () => {
    const p = progressOf(['a', 'b', 'c'] as PersonId[], new Set(['b', 'x']));
    expect(p).toEqual({ done: 1, of: 3, left: ['a', 'c'] });
  });
});
