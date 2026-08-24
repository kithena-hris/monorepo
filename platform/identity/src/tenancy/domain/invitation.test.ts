import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';

import { checkEmployment, enrolmentLink, mayInvite, normaliseWorkEmail } from './invitation.js';

const AUTH_ORIGIN = 'https://auth.app.kithena.com';

describe('mayInvite', () => {
  it('issues a link to an account that has been commissioned but never taken up', () => {
    expect(mayInvite('provisioned').ok).toBe(true);
  });

  it('re-issues to an account already invited', () => {
    // The ordinary case, not an edge one: a link expires after 72 hours and
    // people start on Mondays. Issuing invalidates whatever came before, so
    // re-inviting replaces rather than accumulates.
    expect(mayInvite('invited').ok).toBe(true);
  });

  it('refuses an enrolled account, and says to use recovery', () => {
    const result = mayInvite('active');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Not a generic refusal. Someone who has lost their device needs recovery,
    // which is HR-mediated and deliberately not an emailed link; sending them
    // an invitation instead would be the phishing-shaped path this design
    // exists to avoid.
    expect(result.error.code).toBe('ALREADY_ENROLLED');
  });

  it('refuses a suspended account without lifting the suspension', () => {
    const result = mayInvite('suspended');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('refuses a former employee', () => {
    const result = mayInvite('terminated');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ACCOUNT_TERMINATED');
  });

  it('refuses a state it does not recognise', () => {
    // The reason this takes a string rather than the account slice's union.
    // A sixth state added over there arrives here as an unknown, and an unknown
    // must not be handed a credential-bootstrapping link on the assumption
    // that it is probably fine.
    expect(mayInvite('rehired').ok).toBe(false);
    expect(mayInvite('').ok).toBe(false);
  });
});

describe('normaliseWorkEmail', () => {
  it('lower-cases and trims, because a person typed it', () => {
    expect(normaliseWorkEmail('  Ada@Acme.Example  ')).toBe('ada@acme.example');
  });
});

describe('enrolmentLink', () => {
  const input = {
    authOrigin: AUTH_ORIGIN,
    slug: 'acme',
    identityId: '00000000-0000-4000-8000-00000000000d',
    token: 'ENROLMENT-TOKEN-FIXTURE-NOT-A-REAL-CREDENTIAL',
    workEmail: 'ada@acme.example',
  };

  const built = (over: Partial<typeof input> = {}): URL => {
    const result = enrolmentLink({ ...input, ...over });
    if (!result.ok) throw new Error('expected a link');
    return new URL(result.value);
  };

  it('points at the enrolment page on the auth origin', () => {
    const link = built();
    expect(link.origin).toBe(AUTH_ORIGIN);
    expect(link.pathname).toBe('/enrol');
  });

  it('carries the four parameters the page reads', () => {
    // The other half of this contract is `apps/auth/shell/src/routes/enrol`,
    // which reads these by name. Renaming one here breaks a screen that will
    // not fail to compile.
    const link = built();
    expect(link.searchParams.get('identity')).toBe(input.identityId);
    expect(link.searchParams.get('tenant')).toBe('acme');
    expect(link.searchParams.get('token')).toBe(input.token);
    expect(link.searchParams.get('name')).toBe('ada@acme.example');
  });

  it('carries the address, which is what the page shows before the device prompt', () => {
    // The half of the brief that is not the email itself: the person lands on
    // a page that already says which account this is.
    expect(built().searchParams.get('name')).toBe('ada@acme.example');
  });

  it('encodes an address that would otherwise be mangled by a query string', () => {
    // `ada+payroll@acme.example` decodes to a space if it is concatenated
    // rather than encoded, and the page then displays a different address from
    // the one the account was created against.
    const link = built({ workEmail: 'ada+payroll@acme.example' });
    expect(link.searchParams.get('name')).toBe('ada+payroll@acme.example');
    expect(link.toString()).toContain('name=ada%2Bpayroll%40acme.example');
  });

  it('keeps the auth origin even when a path is configured with it', () => {
    const result = enrolmentLink({ ...input, authOrigin: 'http://localhost:3100/' });
    expect(result.ok && result.value.startsWith('http://localhost:3100/enrol?')).toBe(true);
  });

  it('refuses an origin that is not one', () => {
    expect(enrolmentLink({ ...input, authOrigin: 'auth.app.kithena.com' }).ok).toBe(false);
  });
});

describe('checkEmployment', () => {
  // 09:00 UTC on the 24th. Deliberately a time of day where the civil date
  // differs across zones, which is the whole reason the zone is taken at all.
  const clock = fixedClock('2026-08-24T09:00:00.000Z');
  const checked = (over: { employmentStart?: string; timeZone?: string } = {}) =>
    checkEmployment({ employmentStart: undefined, timeZone: undefined, ...over }, clock);

  it('defaults to today in UTC when neither is stated', () => {
    const result = checked();
    expect(result.ok && result.value).toEqual({
      employmentStart: '2026-08-24',
      timeZone: 'Etc/UTC',
    });
  });

  it('defaults to today in the stated zone, not in UTC', () => {
    // 09:00 UTC on the 24th is 23:00 on the 23rd in Honolulu. Somebody starting
    // "today" there starts on the 23rd, and an account dated the 24th refuses
    // their passkey for the whole of their first shift.
    const result = checked({ timeZone: 'Pacific/Honolulu' });
    expect(result.ok && result.value.employmentStart).toBe('2026-08-23');
  });

  it('checks the zone before it asks the clock anything', () => {
    // The ordering this function exists to get right. Asking for today in an
    // unknown zone throws a RangeError, so checking the date first turned a
    // caller's typo into a 500 rather than a refusal.
    const result = checked({ timeZone: 'Europe/Atlantis' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TIME_ZONE_UNKNOWN');
  });

  it('keeps a forward-dated start, which is the point of taking one', () => {
    const result = checked({ employmentStart: '2026-09-14', timeZone: 'Europe/Madrid' });
    expect(result.ok && result.value).toEqual({
      employmentStart: '2026-09-14',
      timeZone: 'Europe/Madrid',
    });
  });

  it('accepts a date in the past, which is a rehire or a backfill', () => {
    expect(checked({ employmentStart: '2019-01-07' }).ok).toBe(true);
  });

  it.each([
    ['a day that does not exist', '2026-02-30'],
    ['a European ordering', '14/09/2026'],
    ['a partial date', '2026-09'],
    ['an instant', '2026-09-14T00:00:00Z'],
    ['empty', ''],
  ])('refuses %s', (_case, employmentStart) => {
    const result = checked({ employmentStart });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPLOYMENT_START_MALFORMED');
  });

  it('refuses a date far enough out to be a typo', () => {
    // `2036` for `2026` is one keystroke, and it produces an account nobody can
    // enrol for a decade — which looks exactly like the link being broken.
    const result = checked({ employmentStart: '2036-08-24' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPLOYMENT_START_IMPLAUSIBLE');
  });

  it('accepts a date just inside the horizon', () => {
    // A two-year notice period is unusual and real. The boundary is inclusive
    // so that the last legitimate date is not the first refused one.
    expect(checked({ employmentStart: '2028-08-24' }).ok).toBe(true);
  });

  it('asks Intl rather than a list, so a newly added zone is not refused', () => {
    // The IANA database changes. A hard-coded copy is a copy that refuses a
    // real employee's real location.
    expect(checked({ timeZone: 'America/Argentina/Buenos_Aires' }).ok).toBe(true);
    expect(checked({ timeZone: 'Australia/Eucla' }).ok).toBe(true);
  });
});
