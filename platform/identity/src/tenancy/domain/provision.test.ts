import { describe, expect, it } from 'vitest';

import { checkProvisionable, type ProvisionRequest } from './provision.js';

const request = (over: Partial<ProvisionRequest> = {}): ProvisionRequest => ({
  slug: 'acme',
  displayName: 'Acme Corp',
  admins: ['ada@acme.example', 'grace@acme.example'],
  accentColor: null,
  ...over,
});

describe('checkProvisionable', () => {
  it('accepts a well-formed company with two administrators', () => {
    expect(checkProvisionable(request()).ok).toBe(true);
  });

  it('refuses a label that cannot be a hostname', () => {
    for (const slug of ['-acme', 'acme-', 'ACME', 'ac', 'a c m e', 'xn--pple-43d']) {
      expect(checkProvisionable(request({ slug })).ok, slug).toBe(false);
    }
  });

  it('tells a reserved label apart from a malformed one', () => {
    // Two different things to be told: "that cannot be a hostname" and "that
    // one is ours". A single message would send somebody looking for a typo in
    // a name that is perfectly well formed.
    const malformed = checkProvisionable(request({ slug: '-acme' }));
    const reserved = checkProvisionable(request({ slug: 'admin' }));
    if (malformed.ok || reserved.ok) throw new Error('both should refuse');

    expect(malformed.error.code).toBe('SLUG_MALFORMED');
    expect(reserved.error.code).toBe('SLUG_RESERVED');
  });

  it('refuses every reserved label, including the ones we serve from', () => {
    for (const slug of ['auth', 'login', 'admin', 'app', 'api', 'www']) {
      expect(checkProvisionable(request({ slug })).ok, slug).toBe(false);
    }
  });

  it('insists on two administrators', () => {
    // One person holding the only link is a company locked out when that person
    // leaves before their start date — and the second admin has to exist anyway
    // for recovery to have a quorum.
    expect(checkProvisionable(request({ admins: [] })).ok).toBe(false);
    expect(checkProvisionable(request({ admins: ['ada@acme.example'] })).ok).toBe(false);
  });

  it('does not count the same person twice', () => {
    // Two entries that differ only in case or spacing are one administrator,
    // and accepting them would satisfy the rule without satisfying the reason
    // for it.
    const result = checkProvisionable(
      request({ admins: ['ada@acme.example', ' ADA@acme.example '] }),
    );
    expect(result.ok).toBe(false);
  });

  it('normalises the addresses it accepts', () => {
    const result = checkProvisionable(
      request({ admins: [' Ada@Acme.example ', 'grace@acme.example', ''] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.admins).toEqual(['ada@acme.example', 'grace@acme.example']);
  });

  it('refuses a company with no name', () => {
    expect(checkProvisionable(request({ displayName: '   ' })).ok).toBe(false);
  });
});
