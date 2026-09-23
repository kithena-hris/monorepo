import * as z from 'zod';
import { defineEvent } from '../event.js';
import { CalendarDate, Instant, LegalEntityId, Money, PersonId, Period } from '../primitives.js';
import {
  policy,
  asContact,
  asFreeText,
  asIdentity,
  asInternal,
  asPublic,
} from '../classification.js';
import { AttributeKey, LocalizedString, SectionKey } from '../people/primitives.js';
import { AttributeDataType } from '../people/data-type.js';
import { ClassificationSchema, FieldPolicySchema } from '../people/policy.js';
import { Requiredness } from '../people/requiredness.js';
import { AttributeOrigin, ViewerScope, WriterRole } from '../people/attribute-definition.js';

export const EmploymentStatus = z.enum(['pending', 'active', 'on_leave', 'notice', 'terminated']);

/**
 * The lifecycle as §8.1 defines it, which is longer than `EmploymentStatus`.
 *
 * Both exist because they answer different questions. `EmploymentStatus` is
 * what a consumer of `person.hired` needs — is this person working here. This
 * is the record's own state machine, which starts before employment does:
 * a `provisional` record is an account with nobody's details in it yet, and
 * `discarded` is the only state a hard delete is permitted from.
 */
export const PersonState = z.enum([
  'provisional',
  'pre_hire',
  'active',
  'on_leave',
  'notice',
  'terminated',
  'discarded',
]);

const PersonName = z.object({
  given: z.string().min(1).register(policy, asIdentity()),
  family: z.string().min(1).register(policy, asIdentity()),
  /** Display order differs by locale. Store the parts, format at the edge. */
  preferred: z.string().nullable().register(policy, asIdentity()),
});

/** Whether People owns this record or is mirroring somebody else's system. */
const SourceOfRecord = z.enum(['own', 'external']).register(policy, asPublic());

/** Which published version the record was written under. */
const SchemaVersion = z.int().positive().register(policy, asPublic());

/* ------------------------------------------------------- what may travel -- */

/**
 * One attribute that changed, and the rule about whether its value comes too.
 *
 * §10.3 in three lines, enforced at parse time rather than trusted to the
 * caller:
 *
 *   always     the key, its section, its classification, the fact of change
 *   sometimes  the value, when the definition says `includeInEvents`
 *   never      an encrypted attribute, a special-category attribute
 *
 * The refusal is here, on the contract, because a Kafka topic is a durable
 * replayable copy of whatever is put on it. A filter in the publisher is a
 * filter one code path can skip; a payload that cannot be *constructed* with
 * a salary in it is the version that survives somebody wiring up a new
 * producer in a hurry. A consumer that needs a value it was not sent reads it
 * back through the API, where authorization applies per field — one extra
 * round trip, against years of retention on a mistake.
 */
export const ChangedAttribute = z
  .object({
    key: AttributeKey,
    sectionKey: SectionKey,
    /** The label, not the whole policy. A consumer decides how to treat it. */
    classification: ClassificationSchema,
    /** Whether the value lives in `people.person_secret`. */
    encrypted: z.boolean().register(policy, asPublic()),
    /**
     * Present only when the definition opted in.
     *
     * Classified confidential rather than by the attribute's own policy,
     * because the registry is per tenant and this schema is not: the static
     * walk has to assume the most sensitive thing a tenant could put here.
     * That makes it a redaction path and an AI deny-list entry for every
     * tenant, which is the right default for a field whose contents nobody
     * can predict at build time.
     */
    value: z
      .unknown()
      .optional()
      .register(policy, {
        classification: 'confidential',
        piiKind: 'none',
        exportable: true,
        aiEligible: false,
      }),
  })
  .refine((a) => a.classification !== 'special-category' || a.value === undefined, {
    message: 'special-category values never travel on an event',
    path: ['value'],
  })
  .refine((a) => !a.encrypted || a.value === undefined, {
    message: 'an encrypted value never travels on an event',
    path: ['value'],
  });
export type ChangedAttribute = z.infer<typeof ChangedAttribute>;

/* ---------------------------------------------------------- schema events -- */

/**
 * Schema events carry field **definitions**, never employee values.
 *
 * A consumer wanting the whole shape fetches the published artifact by version
 * — that is what `schema.published` is for. These say a thing changed and what
 * kind of thing it was, at a summary level, which is everything an integrator
 * needs to decide whether to re-read the artifact.
 */
export const SectionCreated = defineEvent(
  'people.schema.section_created',
  1,
  z.object({
    sectionKey: SectionKey,
    label: LocalizedString,
    order: z.int().nonnegative().register(policy, asInternal()),
    /** The default every attribute in the section inherits. */
    /* Arrays are leaves to the codegen walk, which descends into objects and
     * not into element schemas. Classifying the array is therefore the honest
     * place: it is what reaches the redaction paths and the deny list. */
    defaultVisibility: z.array(ViewerScope).register(policy, asPublic()),
    origin: AttributeOrigin,
  }),
);

export const SectionUpdated = defineEvent(
  'people.schema.section_updated',
  1,
  z.object({
    sectionKey: SectionKey,
    /** Field names, never their old or new contents. */
    fieldsChanged: z.array(z.string()).register(policy, asInternal()),
  }),
);

export const SectionArchived = defineEvent(
  'people.schema.section_archived',
  1,
  z.object({ sectionKey: SectionKey }),
);

export const AttributeCreated = defineEvent(
  'people.schema.attribute_created',
  1,
  z.object({
    attributeKey: AttributeKey,
    sectionKey: SectionKey,
    label: LocalizedString,
    dataType: AttributeDataType,
    cardinality: z.enum(['single', 'repeating']).register(policy, asPublic()),
    requiredness: Requiredness,
    ownership: z.array(WriterRole).register(policy, asPublic()),
    visibility: z.array(ViewerScope).register(policy, asPublic()),
    /**
     * The whole policy, because this is the event the runtime registry in
     * PEO-034 builds its redaction paths from. A consumer that learns a field
     * exists and not how it is classified has learned the dangerous half.
     */
    classification: FieldPolicySchema,
    origin: AttributeOrigin,
  }),
);

export const AttributeUpdated = defineEvent(
  'people.schema.attribute_updated',
  1,
  z.object({
    attributeKey: AttributeKey,
    fieldsChanged: z.array(z.string()).register(policy, asInternal()),
    /**
     * Whether the field became required, stopped being, or neither.
     *
     * Called out rather than left inside `fieldsChanged`, because this is the
     * transition that makes four hundred records incomplete and a consumer
     * driving a task list needs to notice it without diffing two artifacts.
     */
    requirednessTransition: z
      .enum(['tightened', 'loosened', 'unchanged'])
      .register(policy, asPublic()),
  }),
);

export const AttributeArchived = defineEvent(
  'people.schema.attribute_archived',
  1,
  z.object({
    attributeKey: AttributeKey,
    /**
     * Whether the values survive the archive.
     *
     * They normally do — a deprecated field is hidden from forms, still
     * exported and still in history, which is the honest alternative to
     * deleting a field somebody's integration reads.
     */
    valuesKept: z.boolean().register(policy, asPublic()),
  }),
);

export const SchemaPublished = defineEvent(
  'people.schema.published',
  1,
  z.object({
    schemaVersion: SchemaVersion,
    /** Of the version document. Two publishes of identical content differ. */
    checksum: z.string().length(64).register(policy, asPublic()),
    counts: z.object({
      sections: z.int().nonnegative().register(policy, asInternal()),
      attributes: z.int().nonnegative().register(policy, asInternal()),
      added: z.int().nonnegative().register(policy, asInternal()),
      tightened: z.int().nonnegative().register(policy, asInternal()),
      archived: z.int().nonnegative().register(policy, asInternal()),
    }),
    /** Where the full artifact is. The event never carries the document. */
    artifactUrl: z.url().register(policy, asInternal()),
  }),
);

/* ---------------------------------------------------------- person events -- */

export const PersonProvisioned = defineEvent(
  'people.person.provisioned',
  1,
  z.object({
    personId: PersonId,
    /** The account this record was created from. Nothing else is known yet. */
    identityAccountId: z.uuid().register(policy, asPublic()),
    workEmail: z.email().register(policy, asContact()),
    timeZone: z.string().register(policy, asInternal()),
    employmentStart: CalendarDate,
  }),
);

/**
 * A person and an identity account were connected.
 *
 * `direction` because both happen: People provisions a hire and identity
 * creates the account, or a tenant buys People later and a reconciliation run
 * finds an account with no person. A consumer counting one path needs to know
 * which it is looking at.
 */
export const PersonIdentityLinked = defineEvent(
  'people.person.identity_linked',
  1,
  z.object({
    personId: PersonId,
    identityAccountId: z.uuid().register(policy, asPublic()),
    direction: z
      .enum(['person_first', 'account_first'])
      .register(policy, asPublic()),
  }),
);

export const PersonHired = defineEvent(
  'people.person.hired',
  1,
  z.object({
    personId: PersonId,
    /** The account this person signs in with, when they have one. */
    identityAccountId: z.uuid().nullable().register(policy, asPublic()),
    legalEntityId: LegalEntityId,
    name: PersonName,
    workEmail: z.email().register(policy, asContact()),
    employment: Period,
    status: EmploymentStatus.register(policy, asPublic()),
    managerId: PersonId.nullable(),
    orgUnitId: z.uuid().nullable().register(policy, asPublic()),
    /**
     * Which published version this record was written under.
     *
     * On the event as well as the row because a DSAR export is generated from
     * the version the record was written under, and a consumer replaying the
     * stream years later has no other way to know which shape it is reading.
     */
    schemaVersion: SchemaVersion,
    sourceOfRecord: SourceOfRecord,
  }),
);

export const PersonProfileUpdated = defineEvent(
  'people.person.profile_updated',
  1,
  z.object({
    personId: PersonId,
    /** The account this person signs in with, when they have one. */
    identityAccountId: z.uuid().nullable().register(policy, asPublic()),
    /* Confidential as a whole, because what a tenant put in it is unknowable
     * at build time. That makes the array a redaction path and a deny-list
     * entry for every tenant, which is the right default for a field whose
     * contents nobody can predict. */
    changed: z
      .array(ChangedAttribute)
      .min(1)
      .register(policy, {
        classification: 'confidential',
        piiKind: 'none',
        exportable: true,
        aiEligible: false,
      }),
    schemaVersion: SchemaVersion,
  }),
);

/**
 * The facts identity keeps a copy of changed, with their values.
 *
 * §5: People is the source of record for a linked person's name and start
 * date, and identity caches both because the WebAuthn prompt and the
 * enrolment gate cannot wait for a module the tenant may not have bought.
 * `profile_updated` cannot carry them: a name is `confidential`, and §10.3
 * keeps confidential values off that event. This is the one narrow exception,
 * and it is narrow on purpose — two facts, one consumer, and raised only for a
 * person who has an account to correct.
 *
 * Each fact is the whole current value, not a delta, so a consumer can apply
 * the latest one it has seen and ignore the rest. Null means People holds no
 * value yet, and identity keeps its own. When it took effect and when it was
 * recorded are the envelope's `effectiveFrom` and `occurredAt`.
 */
export const PersonIdentityFactsChanged = defineEvent(
  'people.person.identity_facts_changed',
  1,
  z.object({
    personId: PersonId,
    identityAccountId: z.uuid().register(policy, asPublic()),
    name: PersonName.nullable(),
    employmentStart: CalendarDate.nullable(),
  }),
);

/**
 * A correction, which is never an overwrite.
 *
 * `supersedes` names the history row this replaces. A salary typo corrected
 * three months later must not read as a pay cut followed by a raise, and the
 * only way that holds is if a correction is a typed event rather than an
 * UPDATE somebody ran.
 */
export const PersonAttributeCorrected = defineEvent(
  'people.person.attribute_corrected',
  1,
  z.object({
    personId: PersonId,
    attribute: ChangedAttribute,
    supersedes: z.uuid().register(policy, asPublic()),
    reason: z.string().max(500).nullable().register(policy, asFreeText()),
  }),
);

export const PersonJobChanged = defineEvent(
  'people.person.job_changed',
  1,
  z.object({
    personId: PersonId,
    /** Titles are free text somebody typed, so they are treated as such. */
    title: z.string().nullable().register(policy, asFreeText()),
    level: z.string().nullable().register(policy, asInternal()),
    jobFamily: z.string().nullable().register(policy, asInternal()),
    /** Effective dating lives on the envelope. This is what changed. */
    previousTitle: z.string().nullable().register(policy, asFreeText()),
  }),
);

export const PersonOrgChanged = defineEvent(
  'people.person.org_changed',
  1,
  z.object({
    personId: PersonId,
    orgUnitId: z.uuid().nullable().register(policy, asPublic()),
    costCentre: z.string().nullable().register(policy, asInternal()),
    legalEntityId: LegalEntityId.nullable(),
    locationId: z.uuid().nullable().register(policy, asPublic()),
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

/**
 * Pay changed, and the amount travels only if somebody opted in.
 *
 * `amount` is nullable rather than absent so the shape stays one thing, and
 * `includeInEvents` on the compensation attribute is what decides which it is.
 * A consumer that is not sent the number reads it back through the API, where
 * the finance relation is checked per field.
 */
export const PersonCompensationChanged = defineEvent(
  'people.person.compensation_changed',
  1,
  z.object({
    personId: PersonId,
    amount: Money.nullable(),
    previousAmount: Money.nullable(),
    /** Why the number is absent, so a consumer does not read it as a removal. */
    amountWithheld: z.boolean().register(policy, asPublic()),
    changeKind: z
      .enum(['hire', 'promotion', 'merit', 'market', 'correction', 'other'])
      .register(policy, asInternal()),
  }),
);

export const PersonStatusChanged = defineEvent(
  'people.person.status_changed',
  1,
  z.object({
    personId: PersonId,
    previous: PersonState.register(policy, asPublic()),
    next: PersonState.register(policy, asPublic()),
    /** A closed set, not free text: this is filtered on, and typed reasons
     *  are the only ones a report can count. */
    reason: z
      .enum([
        'hired',
        'started',
        'leave_started',
        'leave_ended',
        'resigned',
        'dismissed',
        'end_of_contract',
        'discarded',
        'corrected',
      ])
      .register(policy, asInternal()),
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

/**
 * A record is missing something, with the keys and who owns each.
 *
 * The owners are in the payload because that is what decides what happens
 * next: an employee-owned gap becomes a task and a reminder on a decaying
 * schedule, and an HR-owned gap aggregates into one grid rather than four
 * hundred tasks. A consumer that learned only "incomplete" would have to ask
 * per field to tell those apart.
 */
export const PersonProfileIncomplete = defineEvent(
  'people.person.profile_incomplete',
  1,
  z.object({
    personId: PersonId,
    /* Keys and owners, never values — so `internal` rather than
     * `confidential`: which field is blank is not itself personal data, and a
     * consumer driving a task list has to be able to log what it is doing. */
    missing: z
      .array(
        z.object({
          key: AttributeKey,
          sectionKey: SectionKey,
          owners: z.array(WriterRole).register(policy, asPublic()),
        }),
      )
      .min(1)
      .register(policy, asInternal()),
    schemaVersion: SchemaVersion,
  }),
);

export const PersonProfileCompleted = defineEvent(
  'people.person.profile_completed',
  1,
  z.object({ personId: PersonId, schemaVersion: SchemaVersion }),
);

/**
 * Two records became one.
 *
 * A merge is additive: both histories survive and the absorbed record becomes
 * a tombstone pointing at the survivor. The event carries both ids for that
 * reason — a consumer holding the absorbed id has to be able to follow it
 * rather than discover its rows have vanished.
 */
export const PersonMerged = defineEvent(
  'people.person.merged',
  1,
  z.object({
    survivingPersonId: PersonId,
    absorbedPersonId: PersonId,
    /** Keys whose value came from the absorbed record. Names, not values. */
    attributesTaken: z.array(AttributeKey).register(policy, asInternal()),
  }),
);

/**
 * Retention executed against a terminated record.
 *
 * Which classes were cleared, never what was in them. `anonymised` rather than
 * `deleted` because the row survives: employment records outlive employment,
 * and an aggregate headcount for 2019 must not change because somebody's
 * retention window closed in 2026.
 */
export const PersonAnonymised = defineEvent(
  'people.person.anonymised',
  1,
  z.object({
    personId: PersonId,
    classesCleared: z.array(ClassificationSchema).register(policy, asPublic()),
    attributeKeys: z.array(AttributeKey).register(policy, asInternal()),
    /** Which policy decided, so an auditor can tell law from configuration. */
    under: z.enum(['tenant_policy', 'statutory_floor']).register(policy, asPublic()),
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

/* ---------------------------------------------------------- import events -- */

/**
 * An import, as counts and attribute keys.
 *
 * Never a value and never the file. A spreadsheet of four hundred people is
 * the single most sensitive artifact this module handles, and an event
 * carrying it — or a link to it — is that artifact in every consumer's
 * retention window.
 */
export const ImportStarted = defineEvent(
  'people.import.started',
  1,
  z.object({
    importId: z.uuid().register(policy, asPublic()),
    rowCount: z.int().nonnegative().register(policy, asInternal()),
    attributeKeys: z.array(AttributeKey).register(policy, asInternal()),
  }),
);

export const ImportCompleted = defineEvent(
  'people.import.completed',
  1,
  z.object({
    importId: z.uuid().register(policy, asPublic()),
    counts: z.object({
      created: z.int().nonnegative().register(policy, asInternal()),
      updated: z.int().nonnegative().register(policy, asInternal()),
      unchanged: z.int().nonnegative().register(policy, asInternal()),
      blocked: z.int().nonnegative().register(policy, asInternal()),
      duplicate: z.int().nonnegative().register(policy, asInternal()),
      incomplete: z.int().nonnegative().register(policy, asInternal()),
    }),
    completedAt: Instant,
  }),
);

/**
 * Somebody exported people, and what they exported.
 *
 * The actor, the field keys, the row count and the format — which is the audit
 * trail an export needs and the reason §15.1 requires a stated reason for a
 * financial or special-category export. No values, and no link to the file:
 * the file lands in object storage behind a signed link, never in an event and
 * never as an email attachment.
 */
export const ExportCompleted = defineEvent(
  'people.export.completed',
  1,
  z.object({
    exportId: z.uuid().register(policy, asPublic()),
    attributeKeys: z.array(AttributeKey).register(policy, asInternal()),
    rowCount: z.int().nonnegative().register(policy, asInternal()),
    format: z.enum(['csv', 'xlsx', 'pdf', 'json']).register(policy, asPublic()),
    /** Required when a financial or special-category field was included. */
    reason: z.string().max(500).nullable().register(policy, asFreeText()),
  }),
);

export const peopleEvents = [
  SectionCreated,
  SectionUpdated,
  SectionArchived,
  AttributeCreated,
  AttributeUpdated,
  AttributeArchived,
  SchemaPublished,
  PersonProvisioned,
  PersonIdentityLinked,
  PersonHired,
  PersonProfileUpdated,
  PersonIdentityFactsChanged,
  PersonAttributeCorrected,
  PersonJobChanged,
  PersonOrgChanged,
  PersonManagerChanged,
  PersonCompensationChanged,
  PersonStatusChanged,
  PersonTerminated,
  PersonProfileIncomplete,
  PersonProfileCompleted,
  PersonMerged,
  PersonAnonymised,
  PersonSyncedFromExternal,
  ImportStarted,
  ImportCompleted,
  ExportCompleted,
] as const;
