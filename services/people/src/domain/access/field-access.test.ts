import { describe, expect, it } from 'vitest';
import { AttributeDefinition, type AttributeDefinitionInput } from '@kithena/contracts';

import {
  canWrite,
  readable,
  readableHistory,
  statusVisibleTo,
  visibleTo,
  type ViewerRelations,
} from './field-access.js';

/**
 * Who may read a field, and who may write it.
 *
 * One rule decides the shape of everything here: **a field the viewer may not
 * read is absent from the result, not present-and-null.** Present-and-null
 * tells a manager that a field exists and has a value, and for a diversity
 * self-identification answer that is the disclosure itself — "declined to
 * answer" and "answered something" become distinguishable without either
 * being shown.
 *
 * The second rule is that the read path and the write path call the same
 * decision. A rule enforced in a resolver leaks through REST, SCIM, webhooks
 * and workers; a rule enforced here holds for all five.
 */

const define = (over: Partial<AttributeDefinitionInput> & { key: string }) =>
  AttributeDefinition.parse({
    sectionKey: 'hr_information',
    label: { default: over.key },
    dataType: 'text',
    typeConfig: { kind: 'text' },
    requiredness: { mode: 'never' },
    ownership: ['hr'],
    visibility: ['self', 'hr'],
    collectAt: 'hr_only',
    classification: {
      classification: 'internal',
      piiKind: 'none',
      exportable: true,
      aiEligible: true,
    },
    classificationSource: 'human',
    origin: 'tenant',
    ...over,
  });

const salary = define({ key: 'base_salary', visibility: ['self', 'finance'], ownership: ['finance'] });
const title = define({ key: 'job_title', visibility: ['self', 'manager', 'hr', 'directory'] });
const ethnicity = define({
  key: 'ethnicity',
  visibility: [],
  ownership: ['employee'],
  classification: {
    classification: 'special-category',
    piiKind: 'health',
    exportable: true,
    aiEligible: false,
  },
});

const relations = (over: Partial<ViewerRelations> = {}): ViewerRelations => ({
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: false,
  isFinance: false,
  isAdmin: false,
  ...over,
});

describe('who may read what', () => {
  it('lets the person see their own salary', () => {
    expect(visibleTo(salary, relations({ isSelf: true }))).toBe(true);
  });

  it('does not let their manager see it', () => {
    // §6.3: compensation is self, finance and HR. A manager sees the person,
    // not their pay.
    expect(visibleTo(salary, relations({ isManager: true }))).toBe(false);
  });

  it('lets finance see it', () => {
    expect(visibleTo(salary, relations({ isFinance: true }))).toBe(true);
  });

  it('separates a direct manager from the chain above them', () => {
    // A skip-level manager is in the chain and is not the manager. A field
    // visible to `manager` alone is the direct relationship only.
    const direct = define({ key: 'performance_note', visibility: ['manager'] });
    const chain = define({ key: 'performance_note', visibility: ['manager_chain'] });

    expect(visibleTo(direct, relations({ isInManagerChain: true }))).toBe(false);
    expect(visibleTo(chain, relations({ isInManagerChain: true }))).toBe(true);
    // And a direct manager is in their own report's chain, which the reverse
    // is not.
    expect(visibleTo(chain, relations({ isManager: true }))).toBe(true);
  });

  it('shows a directory field to anybody in the tenant', () => {
    expect(visibleTo(title, relations())).toBe(true);
  });

  it('shows a self-identification answer to nobody, including an admin', () => {
    // Visible to nobody as an individual value, including HR and including the
    // tenant's own administrators. Answerable only in aggregate.
    for (const viewer of [
      relations({ isSelf: true }),
      relations({ isHr: true }),
      relations({ isAdmin: true }),
      relations({ isFinance: true }),
    ]) {
      expect(visibleTo(ethnicity, viewer)).toBe(false);
    }
  });
});

describe('who may read employment status', () => {
  // Status is not an attribute and no visibility setting reaches it: HR's, and
  // the person's own (§6.3). "On leave" or "on notice" told to a manager or a
  // peer is the disclosure §7 refuses a visibility rule for.
  it.each([
    ['HR', relations({ isHr: true }), true],
    ['the person', relations({ isSelf: true }), true],
    ['their manager', relations({ isManager: true, isInManagerChain: true }), false],
    ['the chain above', relations({ isInManagerChain: true }), false],
    ['finance', relations({ isFinance: true }), false],
    ['an administrator', relations({ isAdmin: true }), false],
    ['a peer', relations(), false],
  ])('%s', (_who, viewer, sees) => {
    expect(statusVisibleTo(viewer)).toBe(sees);
  });
});

describe('a redaction', () => {
  const values = { base_salary: 55_000_00, job_title: 'Staff Engineer', ethnicity: 'declined' };
  const definitions = [salary, title, ethnicity];

  it('removes the key entirely rather than nulling it', () => {
    // The assertion this whole file is written around. `{ base_salary: null }`
    // tells a manager the field exists and that somebody filled it in.
    const seen = readable(definitions, values, relations({ isManager: true }));
    expect(seen).not.toHaveProperty('base_salary');
    expect(Object.keys(seen)).toEqual(['job_title']);
  });

  it('shows the whole record to somebody entitled to it', () => {
    const seen = readable(definitions, values, relations({ isSelf: true }));
    expect(seen).toEqual({ base_salary: 55_000_00, job_title: 'Staff Engineer' });
  });

  it('withholds a value that is absent as firmly as one that is present', () => {
    // Otherwise the shape of the response answers the question: a key that
    // appears only when there is something to hide is a disclosure.
    const withoutSalary = readable(definitions, { job_title: 'Staff Engineer' }, relations({ isManager: true }));
    const withSalary = readable(definitions, values, relations({ isManager: true }));
    expect(Object.keys(withoutSalary)).toEqual(Object.keys(withSalary));
  });

  it('never leaks a special-category answer to its own owner through a read', () => {
    const seen = readable(definitions, values, relations({ isSelf: true }));
    expect(seen).not.toHaveProperty('ethnicity');
  });
});

describe('who may write what', () => {
  it('lets the owner write', () => {
    expect(canWrite(salary, relations({ isFinance: true })).ok).toBe(true);
  });

  it('refuses a writer who is not an owner, whatever they can read', () => {
    // HR reads a salary and does not set one. Ownership and visibility are
    // separate rules precisely because they differ.
    const refused = canWrite(salary, relations({ isHr: true }));
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe('FIELD_NOT_WRITABLE');
  });

  it('lets somebody answer a question they cannot read back', () => {
    // Self-identification is employee-owned and visible to nobody. Writing it
    // and reading it are genuinely different permissions.
    expect(canWrite(ethnicity, relations({ isSelf: true })).ok).toBe(true);
    expect(visibleTo(ethnicity, relations({ isSelf: true }))).toBe(false);
  });

  it('refuses an HR admin writing somebody self-identification answer', () => {
    expect(canWrite(ethnicity, relations({ isHr: true, isAdmin: true })).ok).toBe(false);
  });

  it('refuses a write to a deprecated field', () => {
    // Hidden from forms, still exported, still in history. Accepting a write
    // would put a new value in a field no form shows.
    const gone = define({ key: 'legacy_code', deprecatedAt: '2026-01-01T00:00:00.000Z' });
    expect(canWrite(gone, relations({ isHr: true })).ok).toBe(false);
  });
});

describe('the decision both paths share', () => {
  it('is the same function, so a resolver cannot disagree with a worker', () => {
    // `readable` is what a GraphQL resolver, a REST handler, a webhook filter
    // and an export all call. If any of them reimplemented the intersection,
    // the four would drift and the one that drifted would be discovered by a
    // customer.
    const seen = readable([salary], { base_salary: 1 }, relations({ isFinance: true }));
    expect(Object.hasOwn(seen, 'base_salary')).toBe(
      visibleTo(salary, relations({ isFinance: true })),
    );
  });
});

describe('what history shows (PEO-064)', () => {
  const row = (attributeKey: string, value: unknown) => ({ id: attributeKey, attributeKey, value });
  // Written in plaintext before the field was sealed: a classification that
  // tightened later does not unseal what was written under the looser one.
  const iban = define({
    key: 'iban',
    encrypted: true,
    includeInEvents: false,
    includeInDirectory: false,
    visibility: ['self', 'hr'],
  });
  const rows = [
    row('job_title', 'Engineer'),
    row('base_salary', { amountMinor: 1, currency: 'EUR' }),
    row('ethnicity', 'answered'),
    row('iban', 'ES9121000418450200051332'),
    row('retired_key', 'from a field no longer in the schema'),
  ];

  it('drops every row of a field the viewer cannot read now', () => {
    const seen = readableHistory(
      [salary, title, ethnicity, iban],
      rows,
      relations({ isManager: true }),
    );
    expect(seen.map((r) => r.attributeKey)).toEqual(['job_title']);
  });

  it('never shows a sealed field its past plaintext, only that it changed', () => {
    const seen = readableHistory([iban], rows, relations({ isHr: true }));
    expect(seen).toEqual([{ id: 'iban', attributeKey: 'iban', value: null }]);
  });

  it('keeps a self-ID answer out of its own history, as out of the record', () => {
    expect(readableHistory([ethnicity], rows, relations({ isSelf: true, isHr: true }))).toEqual([]);
  });
});

describe('custom visibility rules (PEO-066)', () => {
  const inSpain = {
    legalEntityId: null,
    country: 'ES',
    employmentType: 'permanent' as const,
    workModel: null,
    status: 'active' as const,
    values: {},
    knownAttributes: new Set<string>(),
  };
  const inGermany = { ...inSpain, country: 'DE' };
  const permit = define({
    key: 'work_permit_expiry',
    visibility: ['hr'],
    visibilityRules: [
      {
        scopes: ['manager'],
        when: { combine: 'all', clauses: [{ operand: 'country', in: ['ES'] }] },
      },
    ],
  });

  it('show the field to the scope on the records the predicate holds for', () => {
    expect(visibleTo(permit, relations({ isManager: true, subject: inSpain }))).toBe(true);
  });

  it('and not on the others', () => {
    expect(visibleTo(permit, relations({ isManager: true, subject: inGermany }))).toBe(false);
  });

  it('grant nothing to a scope the rule does not name', () => {
    expect(visibleTo(permit, relations({ isFinance: true, subject: inSpain }))).toBe(false);
  });

  it('grant nothing when the record is not known: a question about everybody', () => {
    // A filter or a search over this field would answer for the people the
    // rule does not hold for, so without a subject no rule applies.
    expect(visibleTo(permit, relations({ isManager: true }))).toBe(false);
  });

  it('grant nothing when the predicate cannot be evaluated', () => {
    const onArchived = define({
      key: 'notes',
      visibility: ['hr'],
      visibilityRules: [
        {
          scopes: ['manager'],
          when: {
            combine: 'any',
            clauses: [
              { operand: 'country', in: ['ES'] },
              { operand: 'attribute', key: 'archived_thing', is: 'set' },
            ],
          },
        },
      ],
    });
    expect(visibleTo(onArchived, relations({ isManager: true, subject: inSpain }))).toBe(false);
  });

  it('are what the read path filters by, absent rather than null', () => {
    const values = { work_permit_expiry: '2027-01-01' };
    expect(readable([permit], values, relations({ isManager: true, subject: inGermany }))).toEqual(
      {},
    );
    expect(readable([permit], values, relations({ isManager: true, subject: inSpain }))).toEqual(
      values,
    );
  });

  it('never show special-category data, even from a document that slipped past the contract', () => {
    const smuggled: AttributeDefinition = {
      ...ethnicity,
      visibilityRules: permit.visibilityRules ?? [],
    };
    expect(visibleTo(smuggled, relations({ isManager: true, subject: inSpain }))).toBe(false);
  });
});

describe('an external source of record (PEO-073, PRD §13.6)', () => {
  const OKTA = '00000000-0000-4000-8000-0000000000c5';
  const WORKDAY = '00000000-0000-4000-8000-0000000000c6';
  const given = define({ key: 'given_name', ownership: ['employee', 'hr'] });
  const contact = define({ key: 'emergency_contact', ownership: ['employee'] });
  const sources = new Map([['given_name', { connectionId: OKTA, system: 'Okta' }]]);

  it('refuses every other writer, naming the system that owns it', () => {
    for (const viewer of [relations({ isHr: true, sources }), relations({ isSelf: true, sources })]) {
      const refused = canWrite(given, viewer);
      expect(refused.ok).toBe(false);
      if (refused.ok) continue;
      expect(refused.error.code).toBe('SOURCE_OF_RECORD_EXTERNAL');
      expect(refused.error.message).toContain('Okta');
      expect(refused.error.path).toEqual(['given_name']);
    }
  });

  it('leaves what Kithena owns to its own writers', () => {
    expect(canWrite(contact, relations({ isSelf: true, sources })).ok).toBe(true);
  });

  it('lets the owning integration write exactly what it owns', () => {
    const okta = relations({ integrationId: OKTA, sources });
    expect(canWrite(given, okta).ok).toBe(true);
    expect(canWrite(contact, okta).ok).toBe(false);
    // Another integration is just another writer.
    expect(canWrite(given, relations({ integrationId: WORKDAY, sources })).ok).toBe(false);
  });

  it('still refuses a deprecated field to its integration', () => {
    const gone = define({ key: 'given_name', deprecatedAt: '2026-01-01T00:00:00.000Z' });
    expect(canWrite(gone, relations({ integrationId: OKTA, sources })).ok).toBe(false);
  });

  it('shows an integration only what it owns, and never a sealed or special-category value', () => {
    const okta = relations({ integrationId: OKTA, sources });
    expect(visibleTo(given, okta)).toBe(true);
    // `directory` is everybody in the tenant; an integration is nobody in it.
    expect(visibleTo(title, okta)).toBe(false);
    const mapped = (key: string) => new Map([[key, { connectionId: OKTA, system: 'Okta' }]]);
    expect(
      visibleTo(ethnicity, relations({ integrationId: OKTA, sources: mapped('ethnicity') })),
    ).toBe(false);
    const sealed = define({ key: 'national_id', encrypted: true, includeInEvents: false });
    expect(
      visibleTo(sealed, relations({ integrationId: OKTA, sources: mapped('national_id') })),
    ).toBe(false);
  });

  it('changes nothing about who may read it', () => {
    expect(visibleTo(given, relations({ isHr: true, sources }))).toBe(true);
  });
});
