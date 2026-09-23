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
    unknownTenantRedaction: ['custom'],
  });

describe('redaction', () => {
  it('is the static paths plus the tenant’s own keys, and nobody else’s', () => {
    const r = registry();
    r.replace(ACME, [{ key: 'blood_type', policy: specialCategory }]);
    r.replace(GLOBEX, [{ key: 'shoe_size', policy: { ...internal, classification: 'confidential' } }]);

    expect(r.redactionPaths(ACME)).toEqual(['payload.secret']);
    expect([...r.redactionKeys(ACME)]).toEqual(['blood_type']);
    expect([...r.redactionKeys(GLOBEX)]).toEqual(['shoe_size']);
  });

  it('leaves an internal field alone and catches an encrypted one whatever it is classified', () => {
    const r = registry();
    r.replace(ACME, [
      { key: 'desk', policy: internal },
      { key: 'iban', policy: internal, encrypted: true },
    ]);
    expect([...r.redactionKeys(ACME)]).toEqual(['iban']);
  });

  it('fails closed for a tenant nobody loaded', () => {
    const r = registry();
    expect(r.isLoaded(ACME)).toBe(false);
    expect([...r.redactionKeys(ACME)]).toEqual(['custom']);
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

describe('a tenant logger, at any depth', () => {
  const VALUE = 'AB-negative';

  /** `{ a: { a: … { blood_type } } }`, with the key at `depth` (1 = top level). */
  function nested(depth: number): Record<string, unknown> {
    let line: Record<string, unknown> = { blood_type: VALUE };
    for (let i = 1; i < depth; i += 1) line = { a: line };
    return line;
  }

  function logged(line: Record<string, unknown>, tenant = ACME): string {
    const r = registry();
    const { base, lines } = capture();
    r.replace(ACME, [{ key: 'blood_type', policy: specialCategory }]);
    r.replace(GLOBEX, []);
    r.loggerFor(base, tenant).info(line, 'x');
    return JSON.stringify(lines[0]);
  }

  it.each([1, 4, 7, 20])('redacts a denied key at depth %i', (depth) => {
    const out = logged(nested(depth));
    expect(out).not.toContain(VALUE);
    expect(out).toContain('[redacted]');
  });

  it('redacts inside arrays and nested arrays', () => {
    expect(logged({ changes: [{ blood_type: VALUE }] })).not.toContain(VALUE);
    expect(logged({ batches: [[{ x: [{ blood_type: VALUE }] }]] })).not.toContain(VALUE);
  });

  it('still applies the static paths', () => {
    expect(logged({ payload: { secret: 'hunter2' } })).not.toContain('hunter2');
  });

  it('does not apply another tenant’s keys', () => {
    expect(logged(nested(7), GLOBEX)).toContain(VALUE);
  });

  it('never mutates what the caller logged', () => {
    const line = { person: { blood_type: VALUE } };
    logged(line);
    expect(line.person.blood_type).toBe(VALUE);
  });

  it('redacts the bindings of every descendant, and keeps the walk under a child’s own formatter', () => {
    const r = registry();
    const { base, lines } = capture();
    r.replace(ACME, [{ key: 'blood_type', policy: specialCategory }]);

    const child = r.loggerFor(base, ACME).child({ person: { blood_type: VALUE } });
    child.child({ deeper: [{ blood_type: VALUE }] }).info('bound');
    child
      .child({}, { formatters: { log: (o) => ({ ...o, extra: { blood_type: VALUE } }) } })
      .info({ n: 1 }, 'own');

    expect(lines).toHaveLength(2);
    expect(JSON.stringify(lines)).not.toContain(VALUE);
  });
});
