import { describe, expect, it } from 'vitest';

import { approversOf, mayApproveAlone } from '../approval/pending-change.js';
import {
  backOfficeRemoval,
  decideGrant,
  decideRevoke,
  effectiveRoles,
  holdersOf,
  SUPPORT_ROLES,
  type Holdings,
} from './roles.js';

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
    const onlyHr = holdings({ [PRIYA]: ['people_admin', 'hr'], [MARCO]: ['finance'] });
    expect(backOfficeRemoval(onlyHr, PRIYA, false)).toEqual({
      revoke: [],
      last: ['people_admin', 'hr'],
    });
    expect(backOfficeRemoval(onlyHr, PRIYA, true)).toEqual({
      revoke: ['people_admin', 'hr'],
      last: ['people_admin', 'hr'],
    });

    const onlyAdmin = holdings({ [PRIYA]: ['people_admin'], [MARCO]: ['hr'] });
    expect(backOfficeRemoval(onlyAdmin, PRIYA, false)).toEqual({
      revoke: [],
      last: ['people_admin'],
    });
    expect(backOfficeRemoval(onlyAdmin, PRIYA, true).revoke).toEqual(['people_admin']);
  });

  it('counts another administrator as HR: HR’s rights are not lost while one remains', () => {
    const held = holdings({ [PRIYA]: ['people_admin', 'hr'], [MARCO]: ['people_admin'] });
    expect(backOfficeRemoval(held, PRIYA, false)).toEqual({
      revoke: ['people_admin', 'hr'],
      last: [],
    });
  });

  it('has nothing to take from somebody holding neither', () => {
    expect(backOfficeRemoval(holdings({ [MARCO]: ['finance'] }), MARCO, true)).toEqual({
      revoke: [],
      last: [],
    });
    expect(backOfficeRemoval(holdings({}), ADAM, false)).toEqual({ revoke: [], last: [] });
  });
});

describe('an administrator’s rights (decided 2026-09-29)', () => {
  it('include HR’s and finance’s, whatever was granted', () => {
    expect([...effectiveRoles(['people_admin'])].toSorted()).toEqual([
      'finance',
      'hr',
      'people_admin',
    ]);
  });

  it('are not given to HR or finance, which stay what they were granted', () => {
    expect([...effectiveRoles(['hr'])]).toEqual(['hr']);
    expect([...effectiveRoles(['finance'])]).toEqual(['finance']);
    expect([...effectiveRoles(['hr', 'finance'])].toSorted()).toEqual(['finance', 'hr']);
    expect(effectiveRoles([]).size).toBe(0);
  });

  it('make an administrator one of HR’s holders, and finance’s', () => {
    const held = holdings({ [PRIYA]: ['people_admin'], [MARCO]: ['hr'], [ADAM]: ['finance'] });
    expect(holdersOf(held, 'hr').toSorted()).toEqual([MARCO, PRIYA].toSorted());
    expect(holdersOf(held, 'finance').toSorted()).toEqual([ADAM, PRIYA].toSorted());
    expect(holdersOf(held, 'people_admin')).toEqual([PRIYA]);
  });

  it('keep separation of duties: an administrator is another approver, never their own', () => {
    // Marco is the only one granted HR; Priya administers. Marco's own change
    // now has an approver other than him, so he may not approve it alone.
    const held = holdings({ [PRIYA]: ['people_admin'], [MARCO]: ['hr'] });
    const hr = holdersOf(held, 'hr');
    const marcos = { requestedBy: MARCO, subjectAccountId: null };
    expect(approversOf(hr, marcos)).toEqual([PRIYA]);
    expect(mayApproveAlone(hr, marcos, MARCO)).toBe(false);
    // Nor does Priya approve her own, while Marco can.
    const priyas = { requestedBy: PRIYA, subjectAccountId: null };
    expect(mayApproveAlone(hr, priyas, PRIYA)).toBe(false);
    expect(approversOf(hr, priyas)).toEqual([MARCO]);
  });

  it('do not change who may grant: only a granted people_admin, never HR or finance', () => {
    const held = holdings({ [PRIYA]: ['hr', 'finance'], [MARCO]: ['people_admin'] });
    const byHr = decideGrant(held, change({ actor: PRIYA, target: ADAM }));
    expect(byHr.ok ? null : byHr.error.code).toBe('FORBIDDEN');
    expect(decideGrant(held, change({ actor: MARCO, target: ADAM }))).toEqual({
      ok: true,
      value: 'grant',
    });
  });
});

describe('Kithena support (decided 2026-09-29)', () => {
  const SUPPORT = 'support';

  it('holds every tenant role, by its session', () => {
    expect([...SUPPORT_ROLES].toSorted()).toEqual(['finance', 'hr', 'people_admin']);
  });

  it('grants and revokes as an administrator does, without holding a grant', () => {
    const held = holdings({ [PRIYA]: ['people_admin'], [MARCO]: ['hr'] });
    expect(decideGrant(held, change({ actor: SUPPORT, bySupport: true }))).toEqual({
      ok: true,
      value: 'grant',
    });
    expect(
      decideRevoke(held, change({ actor: SUPPORT, target: MARCO, bySupport: true })),
    ).toEqual({ ok: true, value: 'revoke' });
  });

  it('is refused like anybody without a grant when the session is not support', () => {
    const held = holdings({ [PRIYA]: ['people_admin'] });
    const plain = decideGrant(held, change({ actor: SUPPORT }));
    expect(plain.ok ? null : plain.error.code).toBe('FORBIDDEN');
  });

  it('never counts as the administrator the company keeps', () => {
    const held = holdings({ [PRIYA]: ['people_admin'] });
    const last = decideRevoke(
      held,
      change({ actor: SUPPORT, target: PRIYA, role: 'people_admin', bySupport: true }),
    );
    expect(last.ok ? null : last.error.code).toBe('LAST_ADMIN');
  });

  it('still needs a reason, and never grants itself a role', () => {
    const held = holdings({ [PRIYA]: ['people_admin'] });
    const silent = decideGrant(held, change({ actor: SUPPORT, reason: ' ', bySupport: true }));
    expect(silent.ok ? null : silent.error.code).toBe('REASON_REQUIRED');
    const self = decideGrant(held, change({ actor: SUPPORT, target: SUPPORT, bySupport: true }));
    expect(self.ok ? null : self.error.code).toBe('SELF_GRANT');
  });

  it('is never one of HR’s holders, so never an approver anybody waits on', () => {
    const held = holdings({ [PRIYA]: ['people_admin'] });
    expect(holdersOf(held, 'hr')).toEqual([PRIYA]);
  });
});
