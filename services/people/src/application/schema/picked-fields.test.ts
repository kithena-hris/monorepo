import { describe, expect, it } from 'vitest';
import { ok, type Clock } from '@kithena/domain-kit';

import { CORE_PACK, DEPARTMENT_FIELD } from '../../country-packs/core.js';
import { SchemaDraft, type Attribute } from '../../domain/schema/draft.js';
import type { PublishSchema } from './publish-schema.js';
import type { DraftWriter, SchemaRepository } from './schema-repository.js';
import { pickedFields } from './picked-fields.js';

const clock = {
  instant: () => '2026-10-18T10:00:00.000Z',
  date: () => '2026-10-18',
} as unknown as Clock;

/** A company set up before People had Department, with a free-text one of its own. */
function before(): SchemaDraft {
  const draft = SchemaDraft.rehydrate([], []);
  for (const s of CORE_PACK.sections) expect(draft.addSection(s).ok).toBe(true);
  const text = CORE_PACK.attributes.find((a) => a.key === 'preferred_name');
  if (text === undefined) throw new Error('no text field in the core pack');
  for (const [key, label] of [
    ['department', 'Department'],
    ['manager_employee_number', 'Manager Employee Number'],
  ] as const) {
    const own = draft.addAttribute({
      ...text,
      key,
      sectionKey: 'employment',
      label: { default: label, translations: {} },
      origin: 'tenant',
    });
    expect(own.ok).toBe(true);
  }
  return draft;
}

const every = (d: SchemaDraft): readonly Attribute[] => [
  ...d.liveAttributes(),
  ...['department', 'manager_employee_number', DEPARTMENT_FIELD.key].flatMap((k) => {
    const a = d.attribute(k);
    return a !== undefined && a.deprecatedAt !== null ? [a] : [];
  }),
];

function company(departments: number) {
  let inForce = before();
  let version = 1;
  const saved: string[] = [];
  const schema = {
    loadDraft: () =>
      Promise.resolve({ sections: inForce.liveSections(), attributes: every(inForce) }),
    currentVersion: () =>
      Promise.resolve({
        version,
        document: { sections: inForce.liveSections(), attributes: every(inForce) },
      }),
  } as unknown as SchemaRepository;
  const publisher = {
    publish: (_tx: unknown, request: { draft: SchemaDraft }) => {
      inForce = request.draft;
      version += 1;
      return Promise.resolve(ok({ version: { version } }));
    },
  } as unknown as PublishSchema;
  const draft = {
    saveAttribute: (_tx: unknown, _tenant: string, a: Attribute) => {
      saved.push(a.key);
      return Promise.resolve();
    },
  } as unknown as DraftWriter;
  const run = pickedFields({
    schema,
    draft,
    publisher,
    clock,
    artifactUrl: (v) => `https://people.test/v1/schema/versions/${String(v)}`,
    departments: () => Promise.resolve(departments),
  });
  return {
    run: () => run(null as never, 'tenant', 'correlation'),
    now: () => inForce,
    saved,
  };
}

describe('departments and managers picked, never typed', () => {
  it('adds Department and retires the free-text field once the company has departments', async () => {
    const c = company(15);
    const done = await c.run();
    expect(done).toEqual(ok({ version: 2 }));
    expect(c.now().attribute('org_unit_id')?.dataType).toBe('org_unit_ref');
    expect(c.now().attribute('department')?.deprecatedAt).not.toBeNull();
    expect(c.now().attribute('manager_employee_number')?.deprecatedAt).not.toBeNull();
    expect(c.saved.toSorted()).toEqual(['department', 'manager_employee_number', 'org_unit_id']);
    // Again: nothing left to do, nothing published.
    expect(await c.run()).toEqual(ok({ version: null }));
  });

  it('keeps the free-text field while the company has no departments to pick from', async () => {
    const c = company(0);
    await c.run();
    expect(c.now().attribute('org_unit_id')).toBeDefined();
    expect(c.now().attribute('department')?.deprecatedAt).toBeNull();
    // A typed stand-in for the manager goes whatever: Manager is always there to pick.
    expect(c.now().attribute('manager_employee_number')?.deprecatedAt).not.toBeNull();
  });
});
