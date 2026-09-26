import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';
import type { AttributeDefinitionInput } from '@kithena/contracts';

import { SchemaDraft, type SectionInput } from './draft.js';

/**
 * The registry, before anybody publishes it.
 *
 * Every invariant here is a way a tenant can lock themselves — or their
 * employees — out of their own records, and each one is cheap to test because
 * this layer is pure. The expensive version of each of these bugs is a support
 * call on a Monday from somebody whose four hundred people cannot complete a
 * profile.
 *
 * Nothing in this file touches a database, a clock or an event. The draft is
 * what a settings screen edits; publishing it is PEO-012's problem.
 */

/** No `new Date()` anywhere below: the domain is told what time it is. */
const clock = fixedClock('2026-09-22T09:00:00.000Z');

const section: SectionInput = {
  key: 'hr_information',
  label: { default: 'HR information' },
  order: 0,
  defaultVisibility: ['self', 'manager', 'hr'],
  origin: 'core',
};

const attribute: AttributeDefinitionInput = {
  key: 'employee_number',
  sectionKey: 'hr_information',
  label: { default: 'Employee number' },
  dataType: 'text',
  typeConfig: { kind: 'text' },
  requiredness: { mode: 'always' },
  ownership: ['hr'],
  visibility: ['self', 'hr'],
  collectAt: 'hr_only',
  classification: {
    classification: 'internal',
    piiKind: 'identity',
    exportable: true,
    aiEligible: false,
  },
  classificationSource: 'human',
  origin: 'core',
};

/** A draft with one section and one attribute in it, the ordinary starting point. */
function draft(): SchemaDraft {
  const d = SchemaDraft.empty();
  expect(d.addSection(section).ok).toBe(true);
  expect(d.addAttribute(attribute).ok).toBe(true);
  return d;
}

describe('a key', () => {
  it('cannot be used twice', () => {
    const d = draft();
    expect(d.addAttribute(attribute).ok).toBe(false);
    expect(d.addSection(section).ok).toBe(false);
  });

  it('cannot be changed, because there is no operation that changes it', () => {
    // Immutability by absence rather than by a guard: a rename is a new
    // attribute plus a migration of values, offered explicitly, because every
    // integration that ever read the old key is still reading it.
    const d = draft();
    const changed = d.updateAttribute('employee_number', {
      label: { default: 'Staff number' },
    });
    expect(changed.ok).toBe(true);
    expect(d.attribute('employee_number')?.key).toBe('employee_number');
  });

  it('must name a section that exists', () => {
    const d = SchemaDraft.empty();
    const orphan = d.addAttribute(attribute);
    expect(orphan.ok).toBe(false);
    if (orphan.ok) return;
    expect(orphan.error.code).toBe('SECTION_UNKNOWN');
  });
});

describe('a core attribute', () => {
  it('may be relabelled', () => {
    // The tenant's own words for their own field. This is the whole reason
    // `label` is localized and `key` is not.
    const d = draft();
    expect(d.updateAttribute('employee_number', { label: { default: 'Staff number' } }).ok).toBe(
      true,
    );
  });

  it('may have its classification tightened', () => {
    const d = draft();
    const tightened = d.updateAttribute('employee_number', {
      classification: {
        classification: 'confidential',
        piiKind: 'identity',
        exportable: true,
        aiEligible: false,
      },
    });
    expect(tightened.ok).toBe(true);
  });

  it('cannot have its classification loosened', () => {
    const d = draft();
    const loosened = d.updateAttribute('employee_number', {
      classification: {
        classification: 'public',
        piiKind: 'identity',
        exportable: true,
        aiEligible: true,
      },
    });
    expect(loosened.ok).toBe(false);
    if (loosened.ok) return;
    expect(loosened.error.code).toBe('CLASSIFICATION_LOOSENED');
  });

  it('cannot be made AI-eligible', () => {
    const d = draft();
    const opened = d.updateAttribute('employee_number', {
      classification: {
        classification: 'internal',
        piiKind: 'identity',
        exportable: true,
        aiEligible: true,
      },
    });
    expect(opened.ok).toBe(false);
  });

  it('cannot have its requiredness lowered', () => {
    const d = draft();
    const lowered = d.updateAttribute('employee_number', { requiredness: { mode: 'never' } });
    expect(lowered.ok).toBe(false);
    if (lowered.ok) return;
    expect(lowered.error.code).toBe('REQUIREDNESS_LOWERED');
  });

  it('cannot be archived at all', () => {
    // Kithena ships it and something depends on it. Deprecating a tenant's own
    // field is their business; deprecating `employee_number` is not.
    const d = draft();
    const archived = d.archiveAttribute('employee_number', clock);
    expect(archived.ok).toBe(false);
    if (archived.ok) return;
    expect(archived.error.code).toBe('CORE_ATTRIBUTE');
  });
});

describe("a tenant's own attribute", () => {
  const own: AttributeDefinitionInput = {
    ...attribute,
    key: 'works_council_id',
    origin: 'tenant',
    requiredness: { mode: 'always' },
  };

  it('may be loosened, archived and relaxed freely', () => {
    const d = draft();
    expect(d.addAttribute(own).ok).toBe(true);
    expect(d.updateAttribute('works_council_id', { requiredness: { mode: 'never' } }).ok).toBe(
      true,
    );
    expect(d.archiveAttribute('works_council_id', clock).ok).toBe(true);
  });

  it('is hidden once archived but still known', () => {
    // Hidden from forms, still exported, still in history. The honest
    // alternative to deleting a field somebody's integration reads.
    const d = draft();
    d.addAttribute(own);
    d.archiveAttribute('works_council_id', clock);
    expect(d.attribute('works_council_id')).toBeDefined();
    expect(d.liveAttributes().map((a) => a.key)).not.toContain('works_council_id');
  });
});

describe('a required attribute', () => {
  it('cannot be invisible to everyone who owns it', () => {
    // A field required of an employee who cannot see it is a task they cannot
    // complete, shown to them as a nag they cannot answer.
    const d = draft();
    const blinded = d.updateAttribute('employee_number', {
      ownership: ['employee'],
      visibility: ['hr'],
    });
    expect(blinded.ok).toBe(false);
    if (blinded.ok) return;
    expect(blinded.error.code).toBe('REQUIRED_BUT_UNREADABLE');
  });

  it('is fine when at least one owner can read it', () => {
    const d = draft();
    expect(
      d.updateAttribute('employee_number', { ownership: ['employee', 'hr'], visibility: ['hr'] })
        .ok,
    ).toBe(true);
  });

  it('may be invisible to its owner when nobody is required to fill it in', () => {
    // Diversity self-identification: employee-owned, visible to nobody,
    // answerable only in aggregate — and never required.
    const d = draft();
    expect(
      d.addAttribute({
        ...attribute,
        key: 'ethnicity',
        requiredness: { mode: 'never' },
        ownership: ['employee'],
        visibility: [],
        classification: {
          classification: 'special-category',
          piiKind: 'health',
          exportable: true,
          aiEligible: false,
        },
        origin: 'tenant',
      }).ok,
    ).toBe(true);
  });
});

describe('an archived section', () => {
  it('cannot hold a required attribute', () => {
    // Archiving the section would hide the field from every form while the
    // recompute went on counting the records that do not have it.
    const d = draft();
    const archived = d.archiveSection('hr_information', clock);
    expect(archived.ok).toBe(false);
    if (archived.ok) return;
    expect(archived.error.code).toBe('SECTION_HOLDS_REQUIRED');
  });

  it('can be archived once nothing in it is required', () => {
    const d = draft();
    // `employee_number` is core, so its requiredness cannot be lowered — the
    // way out is to move it, which is what an admin would actually do.
    expect(d.addSection({ ...section, key: 'general', order: 1 }).ok).toBe(true);
    expect(d.updateAttribute('employee_number', { sectionKey: 'general' }).ok).toBe(true);
    expect(d.archiveSection('hr_information', clock).ok).toBe(true);
  });

  it('cannot take a new attribute', () => {
    const d = SchemaDraft.empty();
    d.addSection({ ...section, key: 'general' });
    d.archiveSection('general', clock);
    const added = d.addAttribute({ ...attribute, sectionKey: 'general', origin: 'tenant' });
    expect(added.ok).toBe(false);
  });
});

describe('the draft itself', () => {
  it('refuses a definition the contract refuses, without throwing', () => {
    // A financial attribute that is not encrypted. The contract says no; the
    // domain has to say no in its own vocabulary rather than raising a
    // `ZodError` at whatever called it.
    const d = draft();
    const refused = d.addAttribute({
      ...attribute,
      key: 'bank_account',
      origin: 'tenant',
      dataType: 'bank_account',
      typeConfig: { kind: 'bank_account', country: 'ES' },
      classification: {
        classification: 'confidential',
        piiKind: 'financial',
        exportable: true,
        aiEligible: false,
      },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe('DEFINITION_INVALID');
    expect(refused.error.path).toEqual(['encrypted']);
  });

  it('leaves itself unchanged when an operation refuses', () => {
    // A half-applied edit is the failure mode a Result-returning domain exists
    // to prevent: the caller sees a refusal and the aggregate has moved anyway.
    const d = draft();
    d.updateAttribute('employee_number', { requiredness: { mode: 'never' } });
    expect(d.attribute('employee_number')?.requiredness.mode).toBe('always');
  });

  it('orders sections and their attributes for rendering', () => {
    const d = draft();
    d.addSection({ ...section, key: 'public_profile', order: 1 });
    d.addAttribute({
      ...attribute,
      key: 'bio',
      sectionKey: 'public_profile',
      origin: 'tenant',
      order: 2,
    });
    d.addAttribute({
      ...attribute,
      key: 'skills',
      sectionKey: 'public_profile',
      origin: 'tenant',
      order: 1,
    });

    expect(d.liveSections().map((s) => s.key)).toEqual(['hr_information', 'public_profile']);
    expect(d.attributesIn('public_profile').map((a) => a.key)).toEqual(['skills', 'bio']);
  });
});

/** A tenant field managers may see for people on a given grade. */
const onGrade = (key: string, scopes: string[] = ['manager']): AttributeDefinitionInput => ({
  ...attribute,
  key: 'bonus_band',
  origin: 'tenant',
  requiredness: { mode: 'never' },
  visibility: ['hr'],
  visibilityRules: [
    {
      scopes: scopes as never,
      when: {
        combine: 'all',
        clauses: [{ operand: 'attribute', key, is: 'equals', equals: 'senior' }],
      },
    },
  ],
});
const grade = (visibility: string[], over: Partial<AttributeDefinitionInput> = {}) => ({
  ...attribute,
  key: 'grade',
  origin: 'tenant' as const,
  requiredness: { mode: 'never' as const },
  visibility: visibility as never,
  ...over,
});

describe('a custom visibility rule (PEO-066)', () => {
  it('may depend on a field everybody it shows to can already read', () => {
    const d = draft();
    expect(d.addAttribute(grade(['manager', 'hr'])).ok).toBe(true);
    expect(d.addAttribute(onGrade('grade')).ok).toBe(true);
  });

  it("counts a manager as in their own report's chain, and everybody as the directory", () => {
    const d = draft();
    expect(d.addAttribute(grade(['manager_chain'])).ok).toBe(true);
    expect(d.addAttribute(onGrade('grade')).ok).toBe(true);

    const e = draft();
    expect(e.addAttribute(grade(['directory'])).ok).toBe(true);
    expect(e.addAttribute(onGrade('grade', ['finance', 'self'])).ok).toBe(true);
  });

  it('may not depend on a field the scope cannot read: showing it would disclose that value', () => {
    // "Managers see bonus band when grade is senior" tells a manager every
    // report's grade, one field at a time.
    const d = draft();
    expect(d.addAttribute(grade(['hr'])).ok).toBe(true);
    const refused = d.addAttribute(onGrade('grade'));
    expect(!refused.ok && refused.error.code).toBe('VISIBILITY_RULE_DISCLOSES');
    expect(!refused.ok && refused.error.path).toEqual(['visibilityRules']);
  });

  it('may not depend on a field that does not exist', () => {
    const refused = draft().addAttribute(onGrade('grade'));
    expect(!refused.ok && refused.error.code).toBe('VISIBILITY_RULE_DISCLOSES');
  });

  it('may not depend on special-category data, even for a scope that reads it', () => {
    const d = draft();
    const health = grade(['manager', 'hr'], {
      classification: {
        classification: 'special-category',
        piiKind: 'health',
        exportable: true,
        aiEligible: false,
      },
    });
    expect(d.addAttribute(health).ok).toBe(true);
    const refused = d.addAttribute(onGrade('grade'));
    expect(!refused.ok && refused.error.code).toBe('VISIBILITY_RULE_DISCLOSES');
  });

  it('is checked again when an edit changes it', () => {
    const d = draft();
    expect(d.addAttribute(grade(['manager', 'hr'])).ok).toBe(true);
    expect(d.addAttribute({ ...onGrade('grade'), visibilityRules: undefined }).ok).toBe(true);
    const refused = d.updateAttribute('bonus_band', {
      visibilityRules: onGrade('grade', ['finance']).visibilityRules,
    });
    expect(!refused.ok && refused.error.code).toBe('VISIBILITY_RULE_DISCLOSES');
  });
});

/** A tenant field managers may see on a placement fact rather than a field. */
const onPlacement = (
  clause: Record<string, unknown>,
  scopes: string[] = ['manager'],
): AttributeDefinitionInput => ({
  ...onGrade('grade', scopes),
  visibilityRules: [
    { scopes: scopes as never, when: { combine: 'all', clauses: [clause as never] } },
  ],
});
const placed = (key: string, visibility: string[]) => grade(visibility, { key });

describe('a custom visibility rule on a placement fact', () => {
  it('may use a fact each scope it grants already reads, through the field that holds it', () => {
    const d = draft();
    expect(d.addAttribute(placed('employment_type', ['manager', 'hr'])).ok).toBe(true);
    expect(d.addAttribute(onPlacement({ operand: 'employmentType', in: ['contractor'] })).ok).toBe(
      true,
    );
  });

  it('may not use one the scope cannot read: showing the field would disclose it', () => {
    const d = draft();
    expect(d.addAttribute(placed('work_model', ['hr'])).ok).toBe(true);
    const refused = d.addAttribute(onPlacement({ operand: 'workModel', in: ['remote'] }));
    expect(!refused.ok && refused.error.code).toBe('VISIBILITY_RULE_DISCLOSES');
    expect(!refused.ok && refused.error.message).toContain('work model');
  });

  it('may not use one the schema holds no field for', () => {
    const refused = draft().addAttribute(
      onPlacement({ operand: 'legalEntity', in: ['00000000-0000-4000-8000-0000000000e1'] }),
    );
    expect(!refused.ok && refused.error.code).toBe('VISIBILITY_RULE_DISCLOSES');
  });

  it('reads country from every field it can come from', () => {
    const d = draft();
    expect(d.addAttribute(placed('country', ['manager', 'hr'])).ok).toBe(true);
    expect(d.addAttribute(placed('home_address', ['self', 'hr'])).ok).toBe(true);
    const refused = d.addAttribute(onPlacement({ operand: 'country', in: ['ES'] }));
    expect(!refused.ok && refused.error.code).toBe('VISIBILITY_RULE_DISCLOSES');
  });

  it('may use status for HR alone: who is on leave is not a manager’s to infer', () => {
    const onLeave = { operand: 'status', in: ['on_leave'] };
    const refused = draft().addAttribute(onPlacement(onLeave));
    expect(!refused.ok && refused.error.code).toBe('VISIBILITY_RULE_DISCLOSES');
    expect(!refused.ok && refused.error.message).toContain('employment status');
    expect(draft().addAttribute(onPlacement(onLeave, ['hr'])).ok).toBe(true);
  });
});

const health = grade(['hr'], {
  key: 'disability',
  classification: {
    classification: 'special-category',
    piiKind: 'health',
    exportable: true,
    aiEligible: false,
  },
});
const requiredOnHealth: AttributeDefinitionInput = {
  ...attribute,
  key: 'workplace_adjustment',
  origin: 'tenant',
  requiredness: {
    mode: 'conditional',
    when: { combine: 'all', clauses: [{ operand: 'attribute', key: 'disability', is: 'set' }] },
  },
};

describe('a requiredness predicate', () => {
  it('may not name special-category data: "missing" would tell its readers the condition held', () => {
    const d = draft();
    expect(d.addAttribute(health).ok).toBe(true);
    const refused = d.addAttribute(requiredOnHealth);
    expect(!refused.ok && refused.error.code).toBe('PREDICATE_DISCLOSES');
    expect(!refused.ok && refused.error.path).toEqual(['requiredness']);
    expect(!refused.ok && refused.error.message).toContain('disability');
  });

  it('is checked again when an edit changes it', () => {
    const d = draft();
    expect(d.addAttribute(health).ok).toBe(true);
    expect(d.addAttribute({ ...requiredOnHealth, requiredness: { mode: 'never' } }).ok).toBe(true);
    const refused = d.updateAttribute('workplace_adjustment', {
      requiredness: requiredOnHealth.requiredness,
    });
    expect(!refused.ok && refused.error.code).toBe('PREDICATE_DISCLOSES');
  });
});
