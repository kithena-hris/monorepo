import { describe, expect, it } from 'vitest';

import { backOfficeRemoval, decideGrant, decideRevoke, type Holdings } from './roles.js';

const PRIYA = 'priya';
const MARCO = 'marco';
const ADAM = 'adam';

const holdings = (entries: Record<string, string[]>): Holdings =>
  new Map(Object.entries(entries).map(([account, roles]) => [account, new Set(roles)]));

const change = (over: Partial<Parameters<typeof decideGrant>[1]> = {}) => ({
  actor: PRIYA,
  target: ADAM,
  role: 'hr' as const,
  reason: 'Joined the HR team',
  ...over,
});

describe('granting a tenant role (PEO-112)', () => {
  const held = holdings({ [PRIYA]: ['people_admin'], [MARCO]: ['hr'] });

  it('is a people_admin’s to grant', () => {
    expect(decideGrant(held, change())).toEqual({ ok: true, value: 'grant' });
    const byHr = decideGrant(held, change({ actor: MARCO, target: ADAM }));
    expect(byHr.ok ? null : byHr.error.code).toBe('FORBIDDEN');
  });

  it('is never one’s own to grant, even for an administrator', () => {
    const self = decideGrant(held, change({ target: PRIYA, role: 'finance' }));
    expect(self.ok ? null : self.error.code).toBe('SELF_GRANT');
  });

  it('changes nothing when the role is already held', () => {
    expect(decideGrant(held, change({ target: MARCO }))).toEqual({ ok: true, value: 'unchanged' });
  });

  it('needs a reason', () => {
    const silent = decideGrant(held, change({ reason: '   ' }));
    expect(silent.ok ? null : silent.error.code).toBe('REASON_REQUIRED');
    const essay = decideGrant(held, change({ reason: 'x'.repeat(501) }));
    expect(essay.ok ? null : essay.error.code).toBe('REASON_REQUIRED');
  });
});

describe('revoking a tenant role (PEO-112)', () => {
  it('is a people_admin’s to revoke', () => {
    const held = holdings({ [PRIYA]: ['people_admin'], [MARCO]: ['hr'] });
    expect(decideRevoke(held, change({ target: MARCO }))).toEqual({ ok: true, value: 'revoke' });
    const byHr = decideRevoke(held, change({ actor: MARCO, target: PRIYA, role: 'people_admin' }));
    expect(byHr.ok ? null : byHr.error.code).toBe('FORBIDDEN');
  });

  it('never takes the last people_admin, not even from themselves', () => {
    const held = holdings({ [PRIYA]: ['people_admin'] });
    const last = decideRevoke(held, change({ target: PRIYA, role: 'people_admin' }));
    expect(last.ok ? null : last.error.code).toBe('LAST_ADMIN');
  });

  it('lets an administrator step down while another remains', () => {
    const held = holdings({ [PRIYA]: ['people_admin'], [MARCO]: ['people_admin'] });
    expect(decideRevoke(held, change({ target: PRIYA, role: 'people_admin' }))).toEqual({
      ok: true,
      value: 'revoke',
    });
  });

  it('changes nothing when the role is not held', () => {
    const held = holdings({ [PRIYA]: ['people_admin'] });
    expect(decideRevoke(held, change({ target: ADAM }))).toEqual({ ok: true, value: 'unchanged' });
  });
});

describe('the back office removing an administrator it named', () => {
  it('takes back people_admin and hr while somebody else holds each', () => {
    const held = holdings({
      [PRIYA]: ['people_admin', 'hr', 'finance'],
      [MARCO]: ['people_admin', 'hr'],
    });
    expect(backOfficeRemoval(held, PRIYA, false)).toEqual({
      revoke: ['people_admin', 'hr'],
      last: [],
    });
  });

  it('keeps both when it would leave nobody holding one, unless the operator confirmed', () => {
    const onlyHr = holdings({ [PRIYA]: ['people_admin', 'hr'], [MARCO]: ['people_admin'] });
    expect(backOfficeRemoval(onlyHr, PRIYA, false)).toEqual({ revoke: [], last: ['hr'] });
    expect(backOfficeRemoval(onlyHr, PRIYA, true)).toEqual({
      revoke: ['people_admin', 'hr'],
      last: ['hr'],
    });

    const onlyAdmin = holdings({ [PRIYA]: ['people_admin'], [MARCO]: ['hr'] });
    expect(backOfficeRemoval(onlyAdmin, PRIYA, false)).toEqual({
      revoke: [],
      last: ['people_admin'],
    });
    expect(backOfficeRemoval(onlyAdmin, PRIYA, true).revoke).toEqual(['people_admin']);
  });

  it('has nothing to take from somebody holding neither', () => {
    expect(backOfficeRemoval(holdings({ [MARCO]: ['finance'] }), MARCO, true)).toEqual({
      revoke: [],
      last: [],
    });
    expect(backOfficeRemoval(holdings({}), ADAM, false)).toEqual({ revoke: [], last: [] });
  });
});
