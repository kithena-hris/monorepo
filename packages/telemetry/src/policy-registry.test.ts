import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { FieldPolicy } from '@kithena/contracts';

import { createPolicyRegistry } from './policy-registry.js';

const ACME = 'acme';
const GLOBEX = 'globex';

const specialCategory: FieldPolicy = {
  classification: 'special-category',
  piiKind: 'health',
  exportable: true,
  aiEligible: false,
};
const internal: FieldPolicy = {
  classification: 'internal',
  piiKind: 'none',
  exportable: true,
  aiEligible: true,
};

/** A base logger whose output is captured, and what it wrote. */
function capture() {
  const lines: Record<string, unknown>[] = [];
  const base = pino({}, { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) });
  return { base, lines };
}

const registry = () =>
  createPolicyRegistry({
    staticRedaction: ['payload.secret'],
    staticAiDeny: ['payload.secret'],
    unknownTenantRedaction: ['custom', '*.custom'],
  });

describe('redaction paths', () => {
  it('are the static set plus the tenant’s own, and nobody else’s', () => {
    const r = registry();
    r.replace(ACME, [{ key: 'blood_type', policy: specialCategory }]);
    r.replace(GLOBEX, [{ key: 'shoe_size', policy: { ...internal, classification: 'confidential' } }]);

    expect(r.redactionPaths(ACME)).toContain('payload.secret');
    expect(r.redactionPaths(ACME)).toContain('*.blood_type');
    expect(r.redactionPaths(ACME).some((p) => p.includes('shoe_size'))).toBe(false);
  });

  it('leave an internal field alone and catch an encrypted one whatever it is classified', () => {
    const r = registry();
    r.replace(ACME, [
      { key: 'desk', policy: internal },
      { key: 'iban', policy: internal, encrypted: true },
    ]);
    expect(r.redactionPaths(ACME).some((p) => p.includes('desk'))).toBe(false);
    expect(r.redactionPaths(ACME)).toContain('iban');
  });

  it('fail closed for a tenant nobody loaded', () => {
    const r = registry();
    expect(r.isLoaded(ACME)).toBe(false);
    expect(r.redactionPaths(ACME)).toEqual(['payload.secret', 'custom', '*.custom']);
  });

  it('refuse a key that is not a slug, rather than compile it into a path', () => {
    expect(() => {
      registry().replace(ACME, [{ key: 'a.b', policy: internal }]);
    }).toThrow();
  });
});

describe('a tenant logger', () => {
  it('redacts a field created after the logger was first used, without a restart', () => {
    const r = registry();
    const { base, lines } = capture();
    r.replace(ACME, []);

    r.loggerFor(base, ACME).info({ person: { custom: { blood_type: 'AB-' } } }, 'before');
    r.replace(ACME, [{ key: 'blood_type', policy: specialCategory }]);
    r.loggerFor(base, ACME).info({ person: { custom: { blood_type: 'AB-' } } }, 'after');

    expect(JSON.stringify(lines[0])).toContain('AB-');
    expect(JSON.stringify(lines[1])).not.toContain('AB-');
  });

  it('does not redact another tenant’s field names', () => {
    const r = registry();
    const { base, lines } = capture();
    r.replace(ACME, [{ key: 'blood_type', policy: specialCategory }]);
    r.replace(GLOBEX, []);

    r.loggerFor(base, GLOBEX).info({ blood_type: 'stays' }, 'globex');
    expect(JSON.stringify(lines[0])).toContain('stays');
  });

  it('redacts the whole custom bag for a tenant it has not loaded', () => {
    const { base, lines } = capture();
    registry().loggerFor(base, ACME).info({ person: { custom: { anything: 'x' } } }, 'unknown');
    expect(JSON.stringify(lines[0])).not.toContain('"x"');
  });
});
