import { describe, expect, it } from 'vitest';
import type * as z from 'zod';

import { ChangedAttribute, peopleEvents } from './people.js';

/**
 * What a People payload is allowed to carry.
 *
 * §10.3 is three lines long and every one of them is a rule about a value
 * ending up somewhere permanent. A Kafka topic is a durable, replayable copy
 * of whatever is put on it: a salary published by mistake is a salary in every
 * consumer's log, in their backups, and in a subject access request that now
 * has to find all of them. So the refusals live on the contract, where a new
 * producer cannot skip them.
 */

/**
 * One event's payload keys, or a failure naming the event.
 *
 * A helper rather than `find(...)?.payload` at each call site: an optional
 * chain that short-circuits turns "this event was renamed" into a test that
 * quietly asserts nothing, which is the failure mode a registry test exists to
 * prevent.
 */
function payloadKeys(name: string): string[] {
  const event = peopleEvents.find((e) => e.name === name);
  if (!event) throw new Error(`${name} is missing from the registry`);
  return Object.keys((event.payload as unknown as z.ZodObject).shape);
}

const attribute = {
  key: 'accommodation_notes',
  sectionKey: 'health_and_safety',
  classification: 'confidential',
  encrypted: false,
} as const;

describe('a changed attribute', () => {
  it('always names the key, the section and the classification', () => {
    // A consumer that learns a field changed and not how it is classified has
    // learned the dangerous half.
    expect(ChangedAttribute.safeParse({ key: 'a_key', sectionKey: 'a_section' }).success).toBe(
      false,
    );
  });

  it('may carry a value the definition opted in to', () => {
    expect(
      ChangedAttribute.safeParse({ ...attribute, classification: 'internal', value: 'engineering' })
        .success,
    ).toBe(true);
  });

  it('refuses a special-category value outright', () => {
    expect(
      ChangedAttribute.safeParse({
        ...attribute,
        classification: 'special-category',
        value: 'wheelchair user',
      }).success,
    ).toBe(false);
  });

  it('refuses an encrypted value outright', () => {
    // The plaintext of a bank account, in a topic, forever.
    expect(
      ChangedAttribute.safeParse({ ...attribute, encrypted: true, value: 'ES91 2100 0418 45' })
        .success,
    ).toBe(false);
  });

  it('still describes the change when the value may not travel', () => {
    // The key, the section and the classification are enough to drive a task
    // list; the value is read back through the API, where authorization
    // applies per field.
    const parsed = ChangedAttribute.parse({ ...attribute, encrypted: true });
    expect(parsed).toMatchObject({ key: 'accommodation_notes', encrypted: true });
    expect(parsed).not.toHaveProperty('value');
  });

  it('refuses a null passed off as an absent value', () => {
    // `null` is a value a consumer would read as "cleared". Absence is the
    // only shape that means "not sent".
    expect(
      ChangedAttribute.safeParse({ ...attribute, encrypted: true, value: null }).success,
    ).toBe(false);
  });
});

describe('a profile update', () => {
  const update = peopleEvents.find((e) => e.name === 'people.person.profile_updated');

  it('cannot carry a special-category value through its array', () => {
    expect(update).toBeDefined();
    const refused = update?.payload.safeParse({
      personId: '00000000-0000-4000-8000-0000000000a1',
      schemaVersion: 3,
      changed: [{ ...attribute, classification: 'special-category', value: 'union member' }],
    });
    expect(refused?.success).toBe(false);
  });
});

describe('a schema event', () => {
  const schemaEvents = peopleEvents.filter((e) => e.name.startsWith('people.schema.'));

  it('exists for every change a registry can undergo', () => {
    expect(schemaEvents.map((e) => e.name)).toEqual([
      'people.schema.section_created',
      'people.schema.section_updated',
      'people.schema.section_archived',
      'people.schema.attribute_created',
      'people.schema.attribute_updated',
      'people.schema.attribute_archived',
      'people.schema.published',
    ]);
  });

  it('never holds a person id or a value', () => {
    // Schema events carry field definitions. A consumer wanting the shape
    // fetches the published artifact by version; a consumer wanting a value
    // asks the API, which checks who is asking.
    for (const event of schemaEvents) {
      for (const key of payloadKeys(event.name)) {
        expect(key, `${event.name}.${key}`).not.toMatch(/personId|value$|values$/u);
      }
    }
  });

  it('points at the artifact rather than carrying it', () => {
    const keys = payloadKeys('people.schema.published');
    expect(keys).toContain('artifactUrl');
    expect(keys).not.toContain('document');
  });
});

describe('the events a person record produces', () => {
  const names = peopleEvents.map((e) => e.name);

  it('covers the lifecycle §10.2 lists', () => {
    for (const expected of [
      'people.person.provisioned',
      'people.person.identity_linked',
      'people.person.profile_updated',
      'people.person.attribute_corrected',
      'people.person.job_changed',
      'people.person.org_changed',
      'people.person.compensation_changed',
      'people.person.status_changed',
      'people.person.profile_incomplete',
      'people.person.profile_completed',
      'people.person.merged',
      'people.person.anonymised',
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  it('says which schema version a hire was written under', () => {
    expect(payloadKeys('people.person.hired')).toEqual(
      expect.arrayContaining(['schemaVersion', 'sourceOfRecord']),
    );
  });

  it('makes a correction name what it supersedes', () => {
    const corrected = peopleEvents.find((e) => e.name === 'people.person.attribute_corrected');
    const refused = corrected?.payload.safeParse({
      personId: '00000000-0000-4000-8000-0000000000a1',
      attribute: { ...attribute, classification: 'internal', value: 'corrected' },
      reason: null,
    });
    expect(refused?.success).toBe(false);
  });

  it('says a withheld salary was withheld, rather than letting it read as removed', () => {
    const pay = peopleEvents.find((e) => e.name === 'people.person.compensation_changed');
    const refused = pay?.payload.safeParse({
      personId: '00000000-0000-4000-8000-0000000000a1',
      amount: null,
      previousAmount: null,
      changeKind: 'merit',
    });
    expect(refused?.success).toBe(false);
  });

  it('records which classes an anonymisation cleared, not what was in them', () => {
    const keys = payloadKeys('people.person.anonymised');
    expect(keys).toContain('classesCleared');
    expect(keys).not.toContain('values');
  });
});

describe('a unique-claim conflict', () => {
  it('names the attribute and the two people, never a value', () => {
    expect(payloadKeys('people.unique_claim.conflict').toSorted()).toEqual([
      'attributeKey',
      'heldBy',
      'staleClaimBy',
    ]);
  });
});

describe('an import or an export', () => {
  it('carries counts and keys, never the file and never a value', () => {
    for (const name of [
      'people.import.started',
      'people.import.completed',
      'people.export.completed',
    ]) {
      const keys = payloadKeys(name);
      for (const forbidden of ['file', 'fileUrl', 'rows', 'values', 'downloadUrl']) {
        expect(keys, `${name}.${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('names the file an import started from by its checksum (§14.5)', () => {
    expect(payloadKeys('people.import.started')).toContain('checksum');
  });
});

describe('what identity is told', () => {
  it('names the account on a hire and on a profile update, so identity needs no lookup', () => {
    expect(payloadKeys('people.person.hired')).toContain('identityAccountId');
    expect(payloadKeys('people.person.profile_updated')).toContain('identityAccountId');
  });

  it('carries the two cached facts and nothing else', () => {
    // The one event a confidential value rides on outside §10.3. Anything
    // added here reaches identity's consumer and every backup of the topic.
    expect(payloadKeys('people.person.identity_facts_changed').toSorted()).toEqual([
      'employmentStart',
      'identityAccountId',
      'name',
      'personId',
    ]);
  });

  it('ends access with ids, dates and why, never a name (PEO-109)', () => {
    expect(payloadKeys('people.person.access_ended').toSorted()).toEqual([
      'endedAt',
      'identityAccountId',
      'lastWorkingDay',
      'personId',
      'trigger',
    ]);
  });

  it('restores access with ids, an instant and why, never a name (PEO-110)', () => {
    expect(payloadKeys('people.person.access_restored').toSorted()).toEqual([
      'identityAccountId',
      'personId',
      'reason',
      'restoredAt',
    ]);
  });

  it('audits a rehire override with who, which period and why, and nothing else (PEO-110)', () => {
    expect(payloadKeys('people.person.rehire_override').toSorted()).toEqual([
      'period',
      'personId',
      'reason',
    ]);
  });

  it('is only for a person who has an account to correct', () => {
    const facts = peopleEvents.find((e) => e.name === 'people.person.identity_facts_changed');
    const unlinked = facts?.payload.safeParse({
      personId: '00000000-0000-4000-8000-0000000000a1',
      identityAccountId: null,
      name: null,
      employmentStart: '2026-10-01',
    });
    expect(unlinked?.success).toBe(false);
  });
});
