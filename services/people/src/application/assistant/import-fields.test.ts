import { describe, expect, it } from 'vitest';
import { fixedClock, ok } from '@kithena/domain-kit';

import { PlanBudget, type ToolCall } from '../../domain/assistant/settings-plan.js';
import { FIELDS, snapshot } from '../../domain/assistant/settings.fixture.js';
import { IMPORT_REQUEST, proposeImportFields, type ImportFieldsDeps } from './import-fields.js';
import { fakePlanner } from './settings-fixtures.js';

/**
 * An import's columns that match no field, proposed as fields: from local
 * shapes and defaults, and from a model shown the headers and shapes only.
 */

const cells = {
  iban: ['ES91 2100 0418 4502 0005 1332', 'ES79 2100 0813 6101 2345 6789'],
  emergency: ['Ana López', 'Bo Chen'],
  shirt: ['XS', 'XXL', 'XS'],
};

function deps(options: { admin?: boolean; answers?: Record<string, readonly ToolCall[]> } = {}) {
  const planner = options.answers === undefined ? undefined : fakePlanner(options.answers);
  const d: ImportFieldsDeps = {
    service: {
      inTenant: (_t: string, fn: (s: { tx: never }) => unknown) => fn({ tx: {} as never }),
    } as never,
    relations: {
      relations: () => Promise.resolve({ isAdmin: options.admin ?? true, isHr: true } as never),
    },
    clock: fixedClock('2026-09-29T10:00:00.000Z'),
    planBudget: new PlanBudget(20, 3_600_000),
    readSettings: () =>
      Promise.resolve({
        snapshot: snapshot(),
        draft: {
          sections: snapshot().sections.map((s, order) => ({
            key: s.key as never,
            label: { default: s.label, translations: {} },
            order,
            defaultVisibility: ['self', 'hr'],
            origin: s.origin as never,
            archivedAt: null,
          })),
          attributes: FIELDS,
        },
      }),
    unmatched: () =>
      Promise.resolve(
        ok([
          { index: 3, header: 'IBAN', cells: cells.iban },
          { index: 4, header: 'Emergency contact', cells: cells.emergency },
          { index: 5, header: 'T-shirt size', cells: cells.shirt },
        ]),
      ),
    ...(planner === undefined ? {} : { settingsPlanner: planner }),
  };
  return { deps: d, planner };
}

const asking = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  viewer: { accountId: '00000000-0000-4000-8000-0000000000a1', roles: new Set(['people_admin']) },
  correlationId: '00000000-0000-4000-8000-0000000000c1',
};

describe('fields for unmatched columns', () => {
  it('with no model: local defaults, one field per column, in a section that fits', async () => {
    const got = await proposeImportFields(deps().deps, asking, 'u1');
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const fields = got.value.changes.flatMap((c) =>
      c.change.kind === 'add_field' ? [c.change] : [],
    );
    expect(fields.map((f) => [f.column, f.field.key, f.field.dataType])).toEqual([
      [3, 'iban', 'bank_account'],
      [4, 'emergency_contact', 'text'],
      [5, 't_shirt_size', 'select'],
    ]);
    expect(fields[0]?.field).toMatchObject({
      encrypted: true,
      aiEligible: false,
      piiKind: 'financial',
      sectionKey: 'bank',
    });
    expect(fields[2]?.field).toMatchObject({ options: ['XS', 'XXL'], aiEligible: true });
    // The IBAN is flagged for an explicit tick, as in any plan.
    expect(got.value.changes.find((c) => c.subject.startsWith('IBAN'))?.confirm).not.toBeNull();
    expect(got.value).toMatchObject({ canCreate: true, byModel: false });
    expect(got.value.columns[0]).toEqual({
      index: 3,
      header: 'IBAN',
      shape: 'IBAN-like, country ES',
    });
  });

  it('sends the model the headers and the shapes, never a value, and keeps choices from the file', async () => {
    const { deps: d, planner } = deps({
      answers: {
        [IMPORT_REQUEST]: [
          { name: 'add_section', input: { label: 'Kit' } },
          {
            name: 'add_field',
            input: {
              column: 5,
              field: {
                sectionKey: 'Kit',
                label: 'T-shirt size',
                dataType: 'select',
                options: ['invented'],
                requiredness: 'always',
                ownership: ['employee'],
                visibility: ['self', 'hr'],
                collectAt: 'onboarding',
                classification: 'internal',
                piiKind: 'none',
              },
            },
          },
          { name: 'add_field', input: { column: 99, field: {} } },
          // Never touches an existing field or section, whatever it is asked.
          { name: 'edit_field', input: { key: 'shirt_size', changes: { label: 'Renamed' } } },
          { name: 'rename_section', input: { sectionKey: 'bank', label: 'Money' } },
          { name: 'finish_plan', input: { summary: 'A kit section with a T-shirt size.' } },
        ],
      },
    });
    const got = await proposeImportFields(d, asking, 'u1');
    const sent = JSON.stringify(planner?.prompts);
    for (const value of [...cells.iban, ...cells.emergency, ...cells.shirt]) {
      expect(sent).not.toContain(`"${value}"`);
    }
    expect(sent).toContain('"header":"IBAN","shape":"IBAN-like, country ES"');
    expect(sent).toContain('"shape":"2 distinct short values"');
    expect(got.ok && got.value.byModel).toBe(true);
    const field = got.ok
      ? got.value.changes.find((c) => c.change.kind === 'add_field')?.change
      : undefined;
    // Never required, and the choices are the file's, not the model's.
    expect(field).toMatchObject({
      column: 5,
      field: { requiredness: 'never', options: ['XS', 'XXL'], key: 't_shirt_size' },
    });
    expect(got.ok && got.value.summary).toBe('A kit section with a T-shirt size.');
    expect(got.ok && got.value.changes.map((c) => c.change.kind)).toEqual([
      'add_section',
      'add_field',
    ]);
  });

  it('HR without an administrator: the list only, read-only, and no model asked', async () => {
    const { deps: d, planner } = deps({ admin: false, answers: {} });
    const got = await proposeImportFields(d, asking, 'u1');
    expect(got.ok && got.value.canCreate).toBe(false);
    expect(got.ok && got.value.reason).toContain('administrator');
    expect(got.ok && got.value.changes.length).toBeGreaterThan(0);
    expect(planner?.prompts).toEqual([]);
  });
});
