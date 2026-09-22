import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';
import type { AttributeDefinitionInput } from '@kithena/contracts';

import { SchemaDraft, type SectionInput } from './draft.js';
import { diff, publish, rollbackTo } from './publish.js';

/**
 * Publishing, which is what makes a draft real.
 *
 * Two properties carry the whole design. A published version is **immutable**,
 * because an integrator pinned to version 3 has to keep getting version 3 —
 * that is the entire reason a draft and a version are separate objects. And
 * rolling back publishes the previous content as a **new** version, for the
 * same reason there are no down migrations: the history of what this tenant's
 * records were validated against is not something a mistake gets to erase.
 */

const clock = fixedClock('2026-09-22T09:00:00.000Z');
const later = fixedClock('2026-09-23T09:00:00.000Z');
const actor = '00000000-0000-4000-8000-0000000000e1';

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
  requiredness: { mode: 'never' },
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
  origin: 'tenant',
};

function draft(): SchemaDraft {
  const d = SchemaDraft.empty();
  d.addSection(section);
  d.addAttribute(attribute);
  return d;
}

const published = (d: SchemaDraft, previous: ReturnType<typeof publish> | null = null) => {
  const result = publish(d, previous?.ok === true ? previous.value : null, { clock, actor });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe('a published version', () => {
  it('starts at 1 and counts up', () => {
    const first = published(draft());
    expect(first.version).toBe(1);

    const d = draft();
    d.addAttribute({ ...attribute, key: 'department' });
    const second = publish(d, first, { clock: later, actor });
    expect(second.ok && second.value.version).toBe(2);
  });

  it('cannot be mutated', () => {
    const version = published(draft());
    // Frozen rather than merely typed readonly: an integrator pinned to
    // version 3 has to keep getting version 3, and `readonly` is advice a
    // compiler gives rather than a rule a running process obeys.
    expect(Object.isFrozen(version)).toBe(true);
    expect(Object.isFrozen(version.document)).toBe(true);
    expect(() => {
      (version as { version: number }).version = 99;
    }).toThrow();
  });

  it('carries a checksum of its content, not of the moment it was published', () => {
    // Two tenants publishing identical registries get identical checksums, and
    // the same registry published twice does too. That is what makes the
    // checksum usable as "has anything actually changed".
    const a = published(draft());
    const b = publish(draft(), a, { clock: later, actor });
    expect(b.ok && b.value.checksum).toBe(a.checksum);
    expect(a.checksum).toHaveLength(64);
  });

  it('notices a single relabelled field', () => {
    const a = published(draft());
    const d = draft();
    d.updateAttribute('employee_number', { label: { default: 'Staff number' } });
    const b = publish(d, a, { clock: later, actor });
    expect(b.ok && b.value.checksum).not.toBe(a.checksum);
  });

  it('refuses to publish nothing at all', () => {
    // An empty registry publishes as a version that validates every record as
    // complete, which is worse than refusing.
    const empty = publish(SchemaDraft.empty(), null, { clock, actor });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.code).toBe('NOTHING_TO_PUBLISH');
  });
});

describe('the diff a publish produces', () => {
  it('names what was added', () => {
    const before = published(draft());
    const d = draft();
    d.addAttribute({ ...attribute, key: 'department' });
    const after = published(d, publish(d, before, { clock: later, actor }));

    expect(diff(before.document, after.document).added).toEqual(['department']);
  });

  it('names what was tightened, which is the one that costs money', () => {
    // A field that became required is four hundred records becoming
    // incomplete. §9.3 shows this count before anything is written.
    const before = published(draft());
    const d = draft();
    d.updateAttribute('employee_number', { requiredness: { mode: 'always' } });
    const after = publish(d, before, { clock: later, actor });

    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(diff(before.document, after.value.document).tightened).toEqual(['employee_number']);
  });

  it('counts a reclassification as a tightening too', () => {
    const before = published(draft());
    const d = draft();
    d.updateAttribute('employee_number', {
      classification: {
        classification: 'confidential',
        piiKind: 'identity',
        exportable: true,
        aiEligible: false,
      },
    });
    const after = publish(d, before, { clock: later, actor });
    expect(after.ok && diff(before.document, after.value.document).tightened).toEqual([
      'employee_number',
    ]);
  });

  it('names what was archived', () => {
    // Two fields, because a version with none validates every record as
    // complete and `publish` refuses it.
    const start = draft();
    start.addAttribute({ ...attribute, key: 'department' });
    const before = published(start);

    const d = draft();
    d.addAttribute({ ...attribute, key: 'department' });
    d.archiveAttribute('employee_number', later);
    const after = publish(d, before, { clock: later, actor });
    expect(after.ok && diff(before.document, after.value.document).archived).toEqual([
      'employee_number',
    ]);
  });

  it('is empty between two identical versions', () => {
    const before = published(draft());
    const after = publish(draft(), before, { clock: later, actor });
    expect(after.ok && diff(before.document, after.value.document)).toEqual({
      added: [],
      tightened: [],
      loosened: [],
      archived: [],
    });
  });
});

describe('rolling back', () => {
  it('produces version n+1 rather than editing n−1', () => {
    // The same argument as expand-contract migrations: what a record was
    // validated against is a fact, and reversing a decision does not unmake
    // the window in which it was in force.
    const one = published(draft());
    const d = draft();
    d.updateAttribute('employee_number', { requiredness: { mode: 'always' } });
    const two = publish(d, one, { clock: later, actor });
    expect(two.ok).toBe(true);
    if (!two.ok) return;

    const back = rollbackTo(one, two.value, { clock: later, actor });
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    expect(back.value.version).toBe(3);
    expect(back.value.checksum).toBe(one.checksum);
    expect(back.value.rolledBackFrom).toBe(2);
    expect(back.value.document.attributes[0]?.requiredness.mode).toBe('never');
  });

  it('leaves the version it rolled back to untouched', () => {
    const one = published(draft());
    const d = draft();
    d.addAttribute({ ...attribute, key: 'department' });
    const two = publish(d, one, { clock: later, actor });
    if (!two.ok) return;

    rollbackTo(one, two.value, { clock: later, actor });
    expect(one.version).toBe(1);
    expect(two.value.document.attributes).toHaveLength(2);
  });

  it('refuses to roll back to the version already in force', () => {
    const one = published(draft());
    const pointless = rollbackTo(one, one, { clock: later, actor });
    expect(pointless.ok).toBe(false);
    if (pointless.ok) return;
    expect(pointless.error.code).toBe('ALREADY_IN_FORCE');
  });
});
