import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';
import { AttributeDefinition, type AttributeDefinitionInput } from '@kithena/contracts';

import { Person, type EventContext, type PersonSnapshot } from './person.js';
import { changedAttribute } from './profile.js';

/**
 * A profile change and a correction, as events.
 *
 * §10.3 decides what rides on them: the key, the section and the
 * classification always; the value only when the definition opted in; never
 * for an encrypted or special-category field. The contract refuses the last
 * two at parse time, so these tests are about the domain choosing correctly
 * rather than about a filter somebody could skip.
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

function context(): EventContext {
  let n = 0;
  return {
    clock: fixedClock('2026-09-22T09:00:00.000Z'),
    newEventId: () => {
      n += 1;
      return `01890000-0000-7000-8000-${String(n).padStart(12, '0')}`;
    },
    actor: { kind: 'system', process: 'test' },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: null,
  };
}

const person = (over: Partial<PersonSnapshot> = {}) =>
  Person.rehydrate({
    id: '00000000-0000-4000-8000-0000000000a1',
    tenantId: '00000000-0000-4000-8000-000000000001',
    status: 'active',
    identityAccountId: null,
    hireDate: '2026-01-01',
    lastWorkingDay: null,
    ...over,
  });

describe('what a changed attribute carries', () => {
  it('carries the value of an internal field, which travels by default', () => {
    expect(changedAttribute(define({ key: 'job_title' }), 'Staff Engineer')).toEqual({
      key: 'job_title',
      sectionKey: 'hr_information',
      classification: 'internal',
      encrypted: false,
      value: 'Staff Engineer',
    });
  });

  it('carries the fact of change and not the value of a confidential field', () => {
    const changed = changedAttribute(
      define({
        key: 'performance_rating',
        classification: {
          classification: 'confidential',
          piiKind: 'none',
          exportable: true,
          aiEligible: false,
        },
      }),
      'exceeds',
    );
    expect(changed).not.toHaveProperty('value');
  });

  it('never carries an encrypted value, even one somebody opted in', () => {
    const changed = changedAttribute(
      define({
        key: 'iban',
        encrypted: true,
        classification: {
          classification: 'confidential',
          piiKind: 'financial',
          exportable: true,
          aiEligible: false,
        },
      }),
      'DE89370400440532013000',
    );
    expect(changed).not.toHaveProperty('value');
    expect(changed.encrypted).toBe(true);
  });
});

describe('a profile update', () => {
  it('raises one profile_updated naming every changed attribute and the version', () => {
    const p = person();
    const changed = [changedAttribute(define({ key: 'job_title' }), 'Staff Engineer')];
    expect(p.updateProfile(changed, 3, context(), '2026-09-01').ok).toBe(true);

    const [event] = p.drainEvents();
    expect(event?.eventName).toBe('people.person.profile_updated');
    expect(event?.effectiveFrom).toBe('2026-09-01');
    expect(event?.payload).toEqual({
      personId: p.id,
      identityAccountId: null,
      changed,
      schemaVersion: 3,
    });
  });

  it('refuses an update that changes nothing', () => {
    const result = person().updateProfile([], 3, context(), null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOTHING_CHANGED');
  });

  it('refuses to edit a terminated record back into life, or a discarded one', () => {
    const changed = [changedAttribute(define({ key: 'job_title' }), 'x')];
    for (const status of ['terminated', 'discarded'] as const) {
      const result = person({ status }).updateProfile(changed, 3, context(), null);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_TRANSITION');
    }
  });
});

describe('a correction', () => {
  it('raises attribute_corrected carrying supersedes, dated when the original took effect', () => {
    const p = person({ status: 'terminated' });
    const attribute = changedAttribute(define({ key: 'job_title' }), 'Staff Engineer');
    const supersedes = '01890000-0000-7000-8000-0000000000ff';

    // A leaver's record is still correctable: a tombstone that is wrong is
    // still wrong, and an auditor reads it.
    expect(p.correctAttribute(attribute, supersedes, 'typo', context(), '2026-01-01').ok).toBe(
      true,
    );

    const [event] = p.drainEvents();
    expect(event?.eventName).toBe('people.person.attribute_corrected');
    expect(event?.effectiveFrom).toBe('2026-01-01');
    expect(event?.payload).toEqual({ personId: p.id, attribute, supersedes, reason: 'typo' });
  });

  it('refuses to correct a discarded record', () => {
    const attribute = changedAttribute(define({ key: 'job_title' }), 'x');
    const result = person({ status: 'discarded' }).correctAttribute(
      attribute,
      '01890000-0000-7000-8000-0000000000ff',
      null,
      context(),
      '2026-01-01',
    );
    expect(result.ok).toBe(false);
  });
});
