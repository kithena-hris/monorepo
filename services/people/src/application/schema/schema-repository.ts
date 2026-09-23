import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PendingEvent } from '@kithena/domain-kit';

import type { Attribute, Section } from '../../domain/schema/draft.js';
import type { PublishedVersion } from '../../domain/schema/publish.js';
import type { EvaluablePerson } from './impact.js';

/**
 * Reading and writing the registry, and nothing else.
 *
 * Every method takes the transaction, for the reason `unit-of-work.ts` sets
 * out: `app.tenant_id` is scoped to the transaction that set it, so a
 * repository opening its own would be reading a connection where no tenant was
 * ever set — and row-level security answers that with an empty result rather
 * than an error.
 */
export interface SchemaRepository {
  /** The draft a settings screen edits: everything, archived rows included. */
  loadDraft(
    tx: PostgresJsDatabase,
    tenantId: string,
  ): Promise<{ sections: readonly Section[]; attributes: readonly Attribute[] }>;

  /** The version in force, or null for a tenant that has never published. */
  currentVersion(tx: PostgresJsDatabase, tenantId: string): Promise<PublishedVersion | null>;

  /**
   * Append a version and its events, in the caller's transaction.
   *
   * Append, because `people.schema_version` refuses an UPDATE and a DELETE by
   * trigger as well as by grant. Events travel with it for the same reason
   * every other write here drains its own: an event that exists without the
   * row it describes is a consumer acting on a version nobody can fetch.
   */
  appendVersion(
    tx: PostgresJsDatabase,
    tenantId: string,
    version: PublishedVersion,
    events: readonly PendingEvent[],
    /** The tenant default's date at `evaluatedAt`, kept for versions read by date. */
    evaluatedOn: string,
    /**
     * The instant the impact preview evaluated at. Each person's `requiredFrom`
     * is read on their own calendar at this instant (PRD §6.8), so the
     * recompute replays the instant rather than one date.
     */
    evaluatedAt?: string,
  ): Promise<void>;
}

/**
 * The people a publish would be evaluated against.
 *
 * Separate from `PersonRepository` because this is a read of a different
 * shape: the impact preview needs the facts a predicate can see, for everybody
 * at once, and it does not want an aggregate per person. Loading 50,000
 * `Person` objects to count who becomes incomplete would be the slowest
 * possible way to answer a question about JSONB.
 */
export interface PeopleFactsReader {
  /**
   * Every person in the tenant, in pages.
   *
   * An async iterable rather than an array, because §8.4 calls the recompute a
   * *bounded* job: a tenant with 50,000 people should stream through memory
   * rather than arrive in it.
   */
  forImpact(
    tx: PostgresJsDatabase,
    tenantId: string,
    pageSize?: number,
  ): AsyncIterable<EvaluablePerson>;
}
