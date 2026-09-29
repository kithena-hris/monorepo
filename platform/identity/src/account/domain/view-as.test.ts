import { describe, expect, it } from 'vitest';

import {
  VIEW_AS_SECONDS,
  endedBy,
  viewAsReason,
  viewAsRefusal,
  viewAsWindow,
  type ViewAsParty,
} from './view-as.js';

const admin: ViewAsParty = { id: 'a', kind: 'member', status: 'active' };
const subject: ViewAsParty = { id: 's', kind: 'member', status: 'active' };

describe('viewing as an employee', () => {
  it('lasts thirty minutes from its start, and never longer', () => {
    expect(VIEW_AS_SECONDS).toBe(30 * 60);
    const window = viewAsWindow(new Date('2026-09-29T10:00:00.000Z'));
    expect(window).toEqual({
      startedAt: '2026-09-29T10:00:00.000Z',
      expiresAt: '2026-09-29T10:30:00.000Z',
    });
  });

  it('needs a reason, trimmed, of a sane length', () => {
    expect(viewAsReason('  Ticket 12  ')).toEqual({ ok: true, value: 'Ticket 12' });
    expect(viewAsReason('   ')).toMatchObject({ ok: false, error: { code: 'VIEW_AS_REASON_REQUIRED' } });
    expect(viewAsReason(undefined)).toMatchObject({ ok: false });
    expect(viewAsReason('x'.repeat(501))).toMatchObject({
      ok: false,
      error: { code: 'VIEW_AS_REASON_TOO_LONG' },
    });
  });

  it('is between two active people of the company', () => {
    expect(viewAsRefusal({ admin, subject, adminBeingViewed: false })).toEqual({
      ok: true,
      value: undefined,
    });
    for (const [a, s] of [
      [null, subject],
      [admin, null],
      [{ ...admin, status: 'suspended' }, subject],
      [admin, { ...subject, status: 'invited' }],
    ] as const) {
      expect(viewAsRefusal({ admin: a, subject: s, adminBeingViewed: false })).toMatchObject({
        ok: false,
        error: { code: 'VIEW_AS_UNKNOWN_ACCOUNT' },
      });
    }
  });

  it('is never of oneself', () => {
    expect(viewAsRefusal({ admin, subject: admin, adminBeingViewed: false })).toMatchObject({
      ok: false,
      error: { code: 'VIEW_AS_SELF' },
    });
  });

  it('never involves Kithena support, on either side', () => {
    const support: ViewAsParty = { id: 'k', kind: 'support', status: 'active' };
    expect(viewAsRefusal({ admin, subject: support, adminBeingViewed: false })).toMatchObject({
      ok: false,
      error: { code: 'VIEW_AS_SUPPORT' },
    });
    expect(viewAsRefusal({ admin: support, subject, adminBeingViewed: false })).toMatchObject({
      ok: false,
      error: { code: 'VIEW_AS_SUPPORT' },
    });
  });

  it('cannot be started from inside another one', () => {
    // The account asking is being viewed right now: this is somebody viewing
    // as them, since an administrator can never be viewed.
    expect(viewAsRefusal({ admin, subject, adminBeingViewed: true })).toMatchObject({
      ok: false,
      error: { code: 'VIEW_AS_NESTED' },
    });
  });

  it('ended by the administrator before its time, or by the time limit after', () => {
    const expiresAt = '2026-09-29T10:30:00.000Z';
    expect(endedBy(new Date('2026-09-29T10:29:59.000Z'), expiresAt)).toBe('admin');
    expect(endedBy(new Date('2026-09-29T10:30:00.000Z'), expiresAt)).toBe('time_limit');
    expect(endedBy(new Date('2026-09-29T11:00:00.000Z'), expiresAt)).toBe('time_limit');
  });
});
