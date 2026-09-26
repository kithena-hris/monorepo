import { describe, expect, it } from 'vitest';

import { applyPatch, parsePatch } from './patch.js';

/**
 * SCIM PATCH (RFC 7644 §3.5.2), as the two first providers send it.
 *
 * Okta sends lowercase ops with no path and a value object
 * (`{"op":"replace","value":{"active":false}}`). Entra sends capitalised ops
 * with a path each (`{"op":"Replace","path":"name.givenName","value":"Ada"}`)
 * and value filters on emails (`emails[type eq "work"].value`). Both are the
 * RFC; the patch is applied to the resource as JSON, and the application
 * decides afterwards what changed.
 */

const OP = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

const ada = () => ({
  userName: 'ada@acme.test',
  active: true,
  name: { givenName: 'Ada', familyName: 'Lovelace' },
  emails: [{ value: 'ada@acme.test', type: 'work', primary: true }],
});

const patched = (resource: Record<string, unknown>, operations: unknown[]) => {
  const ops = parsePatch({ schemas: [OP], Operations: operations });
  if (!ops.ok) throw new Error(ops.error.message);
  const result = applyPatch(resource, ops.value);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe('reading a PatchOp', () => {
  it('takes the op in any case', () => {
    const ops = parsePatch({
      schemas: [OP],
      Operations: [{ op: 'Replace', path: 'active', value: false }],
    });
    expect(ops.ok && ops.value[0]?.op).toBe('replace');
  });

  it('refuses a body that is not a PatchOp, or an op it does not know', () => {
    expect(parsePatch({ Operations: [] }).ok).toBe(false);
    const unknown = parsePatch({ schemas: [OP], Operations: [{ op: 'move', path: 'x' }] });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe('SCIM_INVALID_SYNTAX');
  });

  it('refuses a remove with nowhere to remove from', () => {
    expect(parsePatch({ schemas: [OP], Operations: [{ op: 'remove' }] }).ok).toBe(false);
  });
});

describe('Okta’s shape: no path, a value object', () => {
  it('replaces top-level attributes and leaves the rest', () => {
    const after = patched(ada(), [{ op: 'replace', value: { active: false } }]);
    expect(after).toMatchObject({ active: false, name: { givenName: 'Ada' } });
  });

  it('merges a complex attribute rather than replacing it whole', () => {
    const after = patched(ada(), [{ op: 'replace', value: { name: { givenName: 'Augusta' } } }]);
    expect(after['name']).toEqual({ givenName: 'Augusta', familyName: 'Lovelace' });
  });

  it('reads a dotted or schema-qualified key inside the value as a path', () => {
    const after = patched(ada(), [
      { op: 'add', value: { 'name.givenName': 'Augusta', [`${ENTERPRISE}:department`]: 'R&D' } },
    ]);
    expect(after['name']).toMatchObject({ givenName: 'Augusta' });
    expect(after[ENTERPRISE]).toEqual({ department: 'R&D' });
  });
});

describe('Entra’s shape: a path per operation', () => {
  it('sets a sub-attribute', () => {
    const after = patched(ada(), [{ op: 'Replace', path: 'name.familyName', value: 'Byron' }]);
    expect(after['name']).toEqual({ givenName: 'Ada', familyName: 'Byron' });
  });

  it('sets a value through a filter, and adds the element when none matches', () => {
    const after = patched(ada(), [
      { op: 'Replace', path: 'emails[type eq "work"].value', value: 'augusta@acme.test' },
      { op: 'Add', path: 'phoneNumbers[type eq "mobile"].value', value: '+34 600 000 000' },
    ]);
    expect(after['emails']).toEqual([{ value: 'augusta@acme.test', type: 'work', primary: true }]);
    expect(after['phoneNumbers']).toEqual([{ type: 'mobile', value: '+34 600 000 000' }]);
  });

  it('sets an extension attribute by its schema-qualified path', () => {
    const after = patched(ada(), [
      { op: 'Add', path: `${ENTERPRISE}:employeeNumber`, value: 'E-042' },
    ]);
    expect(after[ENTERPRISE]).toEqual({ employeeNumber: 'E-042' });
  });

  it('removes an attribute, a sub-attribute, or the elements a filter picks', () => {
    const after = patched(
      { ...ada(), title: 'Engineer', members: [{ value: 'a' }, { value: 'b' }] },
      [
        { op: 'Remove', path: 'title' },
        { op: 'Remove', path: 'name.familyName' },
        { op: 'Remove', path: 'members[value eq "a"]' },
      ],
    );
    expect(after).not.toHaveProperty('title');
    expect(after['name']).toEqual({ givenName: 'Ada' });
    expect(after['members']).toEqual([{ value: 'b' }]);
  });

  it('removes the members a remove names by value, as Entra sends it', () => {
    const after = patched({ members: [{ value: 'a' }, { value: 'b' }] }, [
      { op: 'Remove', path: 'members', value: [{ value: 'a' }] },
    ]);
    expect(after['members']).toEqual([{ value: 'b' }]);
  });

  it('adds to a multi-valued attribute rather than replacing it', () => {
    const after = patched({ members: [{ value: 'a' }] }, [
      { op: 'add', path: 'members', value: [{ value: 'b' }, { value: 'a' }] },
    ]);
    expect(after['members']).toEqual([{ value: 'a' }, { value: 'b' }]);
  });

  it('replaces a multi-valued attribute whole', () => {
    const after = patched({ members: [{ value: 'a' }] }, [
      { op: 'replace', path: 'members', value: [{ value: 'c' }] },
    ]);
    expect(after['members']).toEqual([{ value: 'c' }]);
  });

  it('never changes the resource it was given', () => {
    const before = ada();
    patched(before, [{ op: 'replace', path: 'name.givenName', value: 'X' }]);
    expect(before.name.givenName).toBe('Ada');
  });

  it('refuses a filter it cannot read', () => {
    const ops = parsePatch({
      schemas: [OP],
      Operations: [{ op: 'replace', path: 'emails[type eq].value', value: 'x' }],
    });
    const applied = ops.ok ? applyPatch(ada(), ops.value) : ops;
    expect(applied.ok).toBe(false);
  });
});
