import { describe, expect, it } from 'vitest';

import { matches, parseFilter } from './filter.js';

/**
 * SCIM filters (RFC 7644 §3.4.2.2), the part Okta and Entra send.
 *
 * Both look a user up before creating one — `userName eq "…"` from Okta,
 * `externalId eq "…"` or `userName eq "…"` from Entra — and a group by
 * `displayName eq "…"`. The rest of the grammar is here so an integrator
 * with a script gets what the RFC promises rather than a 400.
 */

const ada = {
  id: '0189',
  userName: 'Ada@Acme.test',
  externalId: '00uAda',
  active: true,
  name: { givenName: 'Ada', familyName: 'Lovelace' },
  emails: [
    { value: 'ada@acme.test', type: 'work', primary: true },
    { value: 'ada@home.test', type: 'home' },
  ],
  meta: { lastModified: '2026-09-20T10:00:00.000Z' },
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { department: 'Engineering' },
};

const holds = (filter: string, resource: Record<string, unknown> = ada) => {
  const parsed = parseFilter(filter);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return matches(parsed.value, resource);
};

describe('the comparisons', () => {
  it('matches userName case-insensitively, as its schema says', () => {
    expect(holds('userName eq "ada@acme.test"')).toBe(true);
    expect(holds('userName eq "grace@acme.test"')).toBe(false);
  });

  it('matches externalId exactly, since it is caseExact', () => {
    expect(holds('externalId eq "00uAda"')).toBe(true);
    expect(holds('externalId eq "00uada"')).toBe(false);
  });

  it('knows ne, co, sw, ew and pr', () => {
    expect(holds('userName ne "grace@acme.test"')).toBe(true);
    expect(holds('userName co "acme"')).toBe(true);
    expect(holds('userName sw "ada@"')).toBe(true);
    expect(holds('userName ew ".test"')).toBe(true);
    expect(holds('title pr')).toBe(false);
    expect(holds('name.givenName pr')).toBe(true);
  });

  it('orders dates and numbers with gt, ge, lt and le', () => {
    expect(holds('meta.lastModified gt "2026-09-01T00:00:00Z"')).toBe(true);
    expect(holds('meta.lastModified lt "2026-09-01T00:00:00Z"')).toBe(false);
    expect(holds('count ge 3', { count: 3 })).toBe(true);
    expect(holds('count le 2', { count: 3 })).toBe(false);
  });

  it('reads booleans and null', () => {
    expect(holds('active eq true')).toBe(true);
    expect(holds('title eq null')).toBe(true);
  });

  it('reads sub-attributes, attribute names in any case, and schema-qualified paths', () => {
    expect(holds('name.familyName eq "Lovelace"')).toBe(true);
    expect(holds('NAME.GIVENNAME eq "ada"')).toBe(true);
    expect(holds('urn:ietf:params:scim:schemas:core:2.0:User:userName eq "ada@acme.test"')).toBe(
      true,
    );
    expect(
      holds(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department eq "Engineering"',
      ),
    ).toBe(true);
  });

  it('compares a multi-valued attribute by any of its values', () => {
    expect(holds('emails co "home"')).toBe(true);
    expect(holds('emails.value eq "ada@home.test"')).toBe(true);
  });
});

describe('the logic', () => {
  it('binds not tighter than and, and and tighter than or', () => {
    expect(holds('userName eq "x" or active eq true and name.givenName eq "Ada"')).toBe(true);
    expect(holds('(userName eq "x" or active eq true) and name.givenName eq "Grace"')).toBe(false);
    expect(holds('not (userName eq "x")')).toBe(true);
  });

  it('filters within a multi-valued attribute', () => {
    expect(holds('emails[type eq "work" and value co "acme"]')).toBe(true);
    expect(holds('emails[type eq "work" and value co "home"]')).toBe(false);
  });

  it('reads escapes inside a string', () => {
    expect(holds('name.givenName eq "A\\"da"', { name: { givenName: 'A"da' } })).toBe(true);
  });
});

describe('what it refuses', () => {
  it.each([
    ['userName', 'no operator'],
    ['userName eq', 'no value'],
    ['userName foo "x"', 'an unknown operator'],
    ['(userName eq "x"', 'an unclosed parenthesis'],
    ['userName eq "x" and', 'a dangling and'],
    ['userName eq "unterminated', 'an unterminated string'],
  ])('refuses %s: %s', (filter) => {
    const parsed = parseFilter(filter);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe('SCIM_INVALID_FILTER');
  });

  it('refuses a filter longer than anybody would send', () => {
    expect(parseFilter(`userName eq "${'a'.repeat(2000)}"`).ok).toBe(false);
  });
});
