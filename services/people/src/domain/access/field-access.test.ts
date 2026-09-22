import { describe, expect, it } from 'vitest';
import { AttributeDefinition, type AttributeDefinitionInput } from '@kithena/contracts';

import { canWrite, readable, visibleTo, type ViewerRelations } from './field-access.js';

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
    expect(Object.hasOwn(seen, 'base_salary')).toBe(visibleTo(salary, relations({ isFinance: true })));
  });
});
