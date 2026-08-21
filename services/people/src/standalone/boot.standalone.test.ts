import { describe, expect, it } from 'vitest';

import manifest from '../../module.manifest.js';

/**
 * People with no siblings present.
 *
 * `vitest.standalone.ts` aliases `@kithena/timeoff` to a module that throws on
 * evaluation, so anything in this module's import graph that reaches sideways
 * fails the moment it is loaded.
 *
 * Nothing here imports `graphql`. The subgraph is built by whichever copy
 * Pothos resolved, and graphql checks types with `instanceof`, so calling
 * `printSchema` from a second copy fails on the realm rather than on anything
 * about this module. Reading the schema through its own methods asks the object
 * that was actually built.
 */

async function loadSchema() {
  const module = await import('../graphql/schema.js');
  return module.schema;
}

/**
 * Narrowed by asking rather than by asserting.
 *
 * A predicate rather than a cast, because the whole reason this reads the
 * schema through its own methods is that the `graphql` types here may belong to
 * a different copy of the package than the schema does. An `as` would paper
 * over exactly the mismatch worth knowing about.
 */
function hasFields(value: unknown): value is { getFields: () => unknown } {
  if (value === null || typeof value !== 'object') return false;
  if (!('getFields' in value)) return false;
  const candidate: unknown = value.getFields;
  return typeof candidate === 'function';
}

/** Field names of a named type. */
function fieldNamesOf(type: unknown, label: string): readonly string[] {
  if (hasFields(type)) {
    const fields: unknown = type.getFields();
    if (fields !== null && typeof fields === 'object') return Object.keys(fields);
  }
  throw new Error(`${label} is not an object type with fields`);
}

describe('the module boots with no siblings present', () => {
  it('declares no module dependencies', () => {
    expect(manifest.dependsOn).toEqual([]);
  });

  it('builds its subgraph without importing a sibling', async () => {
    await expect(loadSchema()).resolves.toBeDefined();
  });

  it('exposes a query root, so the subgraph is executable and not merely built', async () => {
    const schema = await loadSchema();
    expect(fieldNamesOf(schema.getQueryType(), 'Query')).toContain('person');
  });
});

describe('it owns the Person key', () => {
  it('defines Person with the fields it is the source of record for', async () => {
    const schema = await loadSchema();
    const person = fieldNamesOf(schema.getType('Person'), 'Person');
    expect(person).toEqual(expect.arrayContaining(['id', 'givenName', 'familyName', 'workEmail']));
  });

  it('publishes Person as a federated entity', async () => {
    const schema = await loadSchema();
    // Owning the key means other modules can extend it. Without `_entities`
    // the type is local, and Time Off's `leaveBalanceDays` would have nothing
    // to attach to.
    const query = fieldNamesOf(schema.getQueryType(), 'Query');
    expect(query).toContain('_entities');
    expect(query).toContain('_service');
  });

  it('carries no field belonging to another module', async () => {
    const schema = await loadSchema();
    // People is the source of record for a person, not for their leave. A
    // leave field here would mean Time Off's data had migrated into the module
    // that must remain sellable without it.
    const person = fieldNamesOf(schema.getType('Person'), 'Person');
    expect(person).not.toContain('leaveBalanceDays');
  });
});

describe('the standalone harness itself works', () => {
  it('fails an import that reaches a sibling', async () => {
    // A negative control. Without it every assertion above would still pass if
    // the alias were misconfigured and the sibling silently resolvable.
    // TypeScript cannot resolve `@kithena/timeoff` from here either, which is the
    // same guarantee one level up.
    // @ts-expect-error -- a sibling module is deliberately not resolvable
    await expect(import('@kithena/timeoff')).rejects.toThrow(/sibling module was imported/);
  });
});
