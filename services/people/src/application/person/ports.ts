import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Result } from '@kithena/domain-kit';

import type { ViewerRelations } from '../../domain/access/field-access.js';
import type { PersonSnapshot } from '../../domain/person/person.js';
import type { PublishedVersion } from '../../domain/schema/publish.js';

/**
 * What the person use cases read and write through, and nothing wider.
 *
 * Every method takes the transaction, for the reason `unit-of-work.ts` gives:
 * `app.tenant_id` is scoped to the transaction that set it, so a port that
 * opened its own would read a connection with no tenant and RLS would answer
 * with an empty result.
 */

/** Somebody asking. The account, and the tenant roles their token carries. */
export interface Viewer {
  readonly accountId: string;
  /**
   * `hr`, `finance`, `people_admin`: tenant-wide relations.
   *
   * ponytail: taken from the forwarded principal until an OpenFGA client
   * exists in this repository; the resolver is the one place that changes.
   */
  readonly roles: ReadonlySet<string>;
}

/** A person row, with its values keyed by attribute key. */
export interface PersonRecord {
  readonly snapshot: PersonSnapshot;
  /** Core columns and `custom`, merged, keyed by attribute key. Null columns are absent. */
  readonly values: Readonly<Record<string, unknown>>;
  /** `custom` alone, which is what a write replaces. */
  readonly custom: Readonly<Record<string, unknown>>;
  /** The published version this record was last written under. */
  readonly schemaVersion: number | null;
  readonly legalEntityId: string | null;
  readonly employmentType: string | null;
  readonly workModel: string | null;
  /** `external` when an upstream system provisioned it (PEO-072); absent reads as `own`. */
  readonly sourceOfRecord?: 'own' | 'external';
}

/** A directory search: the text, and the core keys it may be matched against. */
export interface PersonSearch {
  readonly text: string;
  readonly keys: readonly ('given_name' | 'family_name' | 'preferred_name' | 'work_email')[];
}

export interface PersonReader {
  /** `lock` takes the row for update, so two writers merging `custom` cannot lose one another's keys. */
  record(
    tx: PostgresJsDatabase,
    tenantId: string,
    personId: string,
    lock?: boolean,
  ): Promise<PersonRecord | null>;

  /**
   * Keyset by id: the last page of a large tenant costs what the first does.
   *
   * `where` narrows to people whose tenant-defined value equals the one given,
   * per key. Only `custom` keys: the caller has already refused anything else,
   * and checked the viewer may read every key it filters on.
   *
   * `search` is a case-insensitive substring over the named core columns,
   * which the caller has likewise checked the viewer reads on everybody.
   *
   * `gaps` narrows to people with a staff gap (`people.completeness_gap`)
   * in one of these keys: the completeness grid's pages (PEO-122), which
   * name the keys it shows so no page comes up short.
   *
   * `leavers` false leaves out anybody in a `LEAVERS` state: what a list is
   * to a viewer who may not read status (§6.3).
   */
  page(
    tx: PostgresJsDatabase,
    tenantId: string,
    after: string | null,
    limit: number,
    where?: Readonly<Record<string, string>>,
    search?: PersonSearch,
    gaps?: readonly string[],
    leavers?: boolean,
  ): Promise<readonly PersonRecord[]>;

  /** How many people `where` and `search` match, by status: the directory's summary. */
  count(
    tx: PostgresJsDatabase,
    tenantId: string,
    where?: Readonly<Record<string, string>>,
    search?: PersonSearch,
    leavers?: boolean,
  ): Promise<{ readonly all: number; readonly active: number }>;

  /** Which person signs in as this account, if any: "my profile" starts here. */
  personOf(tx: PostgresJsDatabase, tenantId: string, accountId: string): Promise<string | null>;
}

export interface SchemaVersions {
  current(tx: PostgresJsDatabase, tenantId: string): Promise<PublishedVersion | null>;
  byNumber(
    tx: PostgresJsDatabase,
    tenantId: string,
    version: number,
  ): Promise<PublishedVersion | null>;
  /** Newest first. */
  list(tx: PostgresJsDatabase, tenantId: string): Promise<readonly PublishedVersion[]>;
}

/** The OpenFGA question, asked once per person per request. */
export interface RelationsResolver {
  relations(
    tx: PostgresJsDatabase,
    tenantId: string,
    viewer: Viewer,
    personId: string,
  ): Promise<ViewerRelations>;
  /**
   * Who the viewer is to everybody at once: the people they sign in as,
   * manage directly, and have anywhere below them — OpenFGA's `ListObjects`,
   * three questions for a whole page rather than one check per person.
   * Absent, `relationsToMany` asks per person.
   */
  reach?(tx: PostgresJsDatabase, tenantId: string, viewer: Viewer): Promise<Reach>;
}

/** The person-level half of a viewer's relations, for everybody at once. */
export interface Reach {
  readonly self: ReadonlySet<string>;
  readonly direct: ReadonlySet<string>;
  readonly chain: ReadonlySet<string>;
  /**
   * False when a list hit the resolver's cap (OpenFGA answers at most 1,000
   * objects), so a person in none of the sets may still be reached: ask them
   * one at a time. Never read as a no.
   */
  readonly complete: boolean;
}

/**
 * Scheduled rows the domain refused on their day (PEO-124, §8.5), by history
 * row: never tried again, and HR's grid asks for a correction.
 */
export interface ScheduledRefusals {
  /** The history rows refused for this person. */
  refused(tx: PostgresJsDatabase, tenantId: string, personId: string): Promise<readonly string[]>;
  /** Record one; true the first time, which is when its event is raised. */
  record(
    tx: PostgresJsDatabase,
    tenantId: string,
    refusal: {
      readonly historyId: string;
      readonly personId: string;
      readonly attributeKey: string;
      readonly reason: string;
      /** The job's instant, from its clock: HR's later rows are compared with it. */
      readonly refusedAt: string;
    },
  ): Promise<boolean>;
}

/** `drizzleSecretStore` satisfies this; the application never sees a ciphertext. */
export interface Secrets {
  put(
    tx: PostgresJsDatabase,
    where: { tenantId: string; personId: string; attributeKey: string },
    plaintext: string,
  ): Promise<{ readonly last4: string | null }>;
  list(
    tx: PostgresJsDatabase,
    tenantId: string,
    personId: string,
  ): Promise<readonly { readonly attributeKey: string; readonly last4: string | null }[]>;
}

/** `drizzleUniqueClaims` satisfies this. */
export interface Uniques {
  /** Lock these rules in one global order, before any claim; see `unique.ts`. */
  lock(
    tx: PostgresJsDatabase,
    tenantId: string,
    rules: readonly { attributeKey: string; scopeId: string }[],
  ): Promise<void>;
  claim(
    tx: PostgresJsDatabase,
    tenantId: string,
    claim: { attributeKey: string; scopeId: string; value: string; personId: string },
  ): Promise<Result<void>>;
  release(
    tx: PostgresJsDatabase,
    tenantId: string,
    where: { personId: string; attributeKey: string },
  ): Promise<void>;
}

/** Whoever has left, or was never a person: listed to HR alone (§6.3). */
export const LEAVERS = ['terminated', 'discarded', 'merged'] as const;

export interface Asking {
  readonly tenantId: string;
  readonly viewer: Viewer;
  readonly correlationId: string;
  /**
   * Write values that require approval straight through, recorded on the
   * event as applied without it (PEO-077): the import's "apply sensitive
   * values without approval", and bulk edit's. HR's alone; anybody else
   * asking is refused.
   */
  readonly applySensitiveWithoutApproval?: boolean;
}

/** What an encrypted value reads as. The plaintext has its own, audited, path. */
export interface SealedValue {
  readonly last4: string | null;
}
