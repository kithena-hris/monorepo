import * as z from 'zod';
import { defineEvent } from '../event.js';
import { CalendarDate, LegalEntityId, PersonId, Period } from '../primitives.js';
import {
  policy,
  asContact,
  asFreeText,
  asIdentity,
  asInternal,
  asPublic,
} from '../classification.js';

export const EmploymentStatus = z.enum(['pending', 'active', 'on_leave', 'notice', 'terminated']);

const PersonName = z.object({
  given: z.string().min(1).register(policy, asIdentity()),
  family: z.string().min(1).register(policy, asIdentity()),
  /** Display order differs by locale. Store the parts, format at the edge. */
  preferred: z.string().nullable().register(policy, asIdentity()),
});

export const PersonHired = defineEvent(
  'people.person.hired',
  1,
  z.object({
    personId: PersonId,
    legalEntityId: LegalEntityId,
    name: PersonName,
    workEmail: z.email().register(policy, asContact()),
    employment: Period,
    status: EmploymentStatus.register(policy, asPublic()),
    managerId: PersonId.nullable(),
    orgUnitId: z.uuid().nullable().register(policy, asPublic()),
  }),
);

export const PersonManagerChanged = defineEvent(
  'people.person.manager_changed',
  1,
  z.object({
    personId: PersonId,
    previousManagerId: PersonId.nullable(),
    managerId: PersonId.nullable(),
    /** Effective dating lives on the envelope, not here. */
  }),
);

export const PersonTerminated = defineEvent(
  'people.person.terminated',
  1,
  z.object({
    personId: PersonId,
    lastWorkingDay: CalendarDate,
    /** Reason is free text entered by HR and can contain anything. Treat as
     *  confidential and keep it out of model prompts. */
    reason: z.string().nullable().register(policy, asFreeText()),
    /** An HR judgement about a person, not a fact about them. Confidential,
     *  exportable on request, and never an input to a model. */
    eligibleForRehire: z.boolean().nullable().register(policy, {
      classification: 'confidential',
      piiKind: 'none',
      exportable: true,
      aiEligible: false,
    }),
  }),
);

/** Emitted when the source of record is external. Downstream modules cannot
 *  tell the difference, which is the whole point of the People Graph. */
export const PersonSyncedFromExternal = defineEvent(
  'people.person.synced_from_external',
  1,
  z.object({
    personId: PersonId,
    provider: z.string().register(policy, asPublic()),
    /** Identifies the same person in the upstream system. */
    externalId: z.string().register(policy, asIdentity()),
    /** Field names, not values. */
    fieldsChanged: z.array(z.string()).register(policy, asInternal()),
  }),
);

export const peopleEvents = [
  PersonHired,
  PersonManagerChanged,
  PersonTerminated,
  PersonSyncedFromExternal,
] as const;
