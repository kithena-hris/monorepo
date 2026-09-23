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
   */
  page(
    tx: PostgresJsDatabase,
    tenantId: string,
    after: string | null,
    limit: number,
    where?: Readonly<Record<string, string>>,
  ): Promise<readonly PersonRecord[]>;

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
