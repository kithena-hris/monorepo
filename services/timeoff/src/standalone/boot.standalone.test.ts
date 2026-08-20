import { describe, expect, it } from 'vitest';

import manifest from '../../module.manifest.js';

/**
 * Time Off with no siblings present.
 *
 * `vitest.standalone.ts` aliases `@hris/people` to a module that throws on
 * evaluation, so anything in this module's import graph that reaches sideways
 * fails the moment it is loaded. That is the point: in a deployment that bought
 * Time Off alone, People is not on disk, and a monorepo will happily resolve an
 * import that production cannot.
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
    // If any transitive import reached `@hris/people`, the alias would throw
    // here, and this is where that failure belongs.
    await expect(loadSchema()).resolves.toBeDefined();
  });

  it('exposes a query root, so the subgraph is executable and not merely built', async () => {
    const schema = await loadSchema();
    const query = schema.getQueryType();
    expect(query).toBeDefined();
    expect(fieldNamesOf(query, 'Query').length).toBeGreaterThan(0);
  });
});

describe('it contributes to the People Graph without owning it', () => {
  it('adds its field to Person', async () => {
    const schema = await loadSchema();
    expect(fieldNamesOf(schema.getType('Person'), 'Person')).toContain('leaveBalanceDays');
  });

  it('resolves Person through federation rather than from a local table', async () => {
    const schema = await loadSchema();
    // `_entities` and `_service` are what make this a subgraph. Without them
    // `Person` is a local type that happens to share a name, the key resolves
    // nowhere, and a customer could not point the People Graph at Workday.
    const query = fieldNamesOf(schema.getQueryType(), 'Query');
    expect(query).toContain('_entities');
    expect(query).toContain('_service');
  });

  it('does not own the Person key', async () => {
    const schema = await loadSchema();
    // Owning `Person` would mean defining the fields People owns. Time Off
    // contributes exactly one field and knows nothing else about a person.
    const person = fieldNamesOf(schema.getType('Person'), 'Person');
    expect(person).not.toContain('workEmail');
    expect(person).not.toContain('legalName');
  });

  it('names People only as an enrichment', () => {
    // The soft edge is allowed and the hard one is not: People makes Time Off
    // better, and its absence must not make Time Off unusable.
    expect(manifest.enrichedBy).toContain('people');
    expect(manifest.dependsOn).not.toContain('people');
    expect(manifest.requiresPeopleSource).toBe('either');
  });
});

describe('the standalone harness itself works', () => {
  it('fails an import that reaches a sibling', async () => {
    // A negative control. Without it every assertion above would still pass if
    // the alias were misconfigured and the sibling silently resolvable — the
    // check would be measuring nothing.
    //
    // TypeScript cannot resolve `@hris/people` from here either, which is the
    // same guarantee one level up: the sibling is not a dependency of this
    // module, so there are no types for it. The suppression is the assertion.
    // @ts-expect-error -- a sibling module is deliberately not resolvable
    await expect(import('@hris/people')).rejects.toThrow(/sibling module was imported/);
  });
});
