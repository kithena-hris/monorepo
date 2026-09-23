import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  err,
  failure,
  fixedClock,
  localDate,
  ok,
  type Clock,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import type { Actor } from '@kithena/contracts';

import { SchemaDraft } from '../../domain/schema/draft.js';
import { diff, publish, type PublishedVersion, type SchemaDiff } from '../../domain/schema/publish.js';
import { utcCalendars, type Calendars } from '../org/org.js';
import {
  computeImpact,
  ownersOf,
  type EvaluablePerson,
  type PublishImpact,
} from './impact.js';
import type { PeopleFactsReader, SchemaRepository } from './schema-repository.js';

/**
 * Configure the registry, then publish it — and show what publishing would do
 * before it does it.
 *
 * The preview is the part that earns this use case. §9.3 puts the number in
 * front of the admin: "88 of 412 people become incomplete, 61 fields owned by
 * employees, 27 owned by you". Somebody who can see that picks a sensible
 * `requiredFrom`; somebody who cannot marks six fields required on a Friday
 * and finds out from four hundred replies.
 *
 * So `preview` and `publish` are two calls over one computation. The preview
 * writes nothing and the publish recomputes rather than trusting a number the
 * caller passed back — a client that could hand in its own impact figure is a
 * client that can publish anything by claiming it affects nobody.
 */

export interface PublishRequest {
  readonly tenantId: string;
  readonly actor: Actor;
  /** The account publishing. Null for a country pack applied by the system. */
  readonly publishedBy: string | null;
  readonly correlationId: string;
  /** Where the published artifact will be fetchable. */
  readonly artifactUrl: string;
}

export interface PublishPreview {
  readonly nextVersion: number;
  readonly diff: SchemaDiff;
  readonly impact: PublishImpact;
  /** Which roles own what this version newly requires, for the alert copy. */
  readonly ownersAffected: readonly string[];
  /** True when the draft would publish to a byte-identical document. */
  readonly unchanged: boolean;
}

export interface PublishSchemaDeps {
  readonly schema: SchemaRepository;
  readonly people: PeopleFactsReader;
  readonly clock: Clock;
  readonly newEventId: () => string;
  /** Whose day each person's `requiredFrom` is read on. UTC when absent. */
  readonly calendars?: Calendars;
}

export interface PublishSchema {
  preview(tx: PostgresJsDatabase, request: PublishRequest): Promise<Result<PublishPreview>>;
  publish(
    tx: PostgresJsDatabase,
    request: PublishRequest,
  ): Promise<Result<{ version: PublishedVersion; preview: PublishPreview }>>;
}

export function publishSchema(deps: PublishSchemaDeps): PublishSchema {
  /**
   * The candidate version and what it would do, computed once.
   *
   * Both entry points go through here, which is what makes the preview and the
   * publish agree. They are the same walk over the same people with the same
   * pure functions; the only difference is whether anything is written
   * afterwards.
   */
  async function evaluate(
    tx: PostgresJsDatabase,
    request: PublishRequest,
  ): Promise<
    Result<{
      candidate: PublishedVersion;
      preview: PublishPreview;
      evaluatedOn: string;
      evaluatedAt: string;
    }>
  > {
    const [{ sections, attributes }, current] = await Promise.all([
      deps.schema.loadDraft(tx, request.tenantId),
      deps.schema.currentVersion(tx, request.tenantId),
    ]);

    const draft = SchemaDraft.rehydrate(sections, attributes);
    const candidate = publish(draft, current, { clock: deps.clock, actor: request.publishedBy });
    if (!candidate.ok) return candidate;

    const before = current?.document.attributes ?? [];
    const after = candidate.value.document.attributes;

    /*
     * Drained into memory here, and that is the bound worth naming.
     *
     * The reader streams, so a tenant with 50,000 people does not arrive all
     * at once — but the preview needs a total before it can report one, so the
     * list is held while it is counted. What is held is the id and the facts a
     * predicate can read, not an aggregate per person.
     *
     * `ponytail: one pass, whole tenant. If a customer's directory outgrows
     * this, `computeImpact` already takes an iterable — fold the counters in
     * as the pages arrive and the array goes away.
     */
    const people: EvaluablePerson[] = [];
    for await (const person of deps.people.forImpact(tx, request.tenantId)) {
      people.push(person);
    }

    /*
     * One instant, taken once. Each person's `requiredFrom` is read on their
     * own calendar at it (PRD §6.8), and the publish records it on the
     * version, so the recompute that runs later off `schema.published`
     * replays the same instant — and so the same day for each person —
     * rather than whatever day it happens to be when the event arrives.
     */
    const calendar = await (deps.calendars ?? utcCalendars).load(tx, request.tenantId);
    const evaluatedAt = deps.clock.instant();
    const evaluatedOn = localDate(evaluatedAt, calendar.defaultZone);
    const impact = computeImpact(before, after, people, fixedClock(evaluatedAt), calendar);
    const newlyRequired = [...new Set(impact.people.flatMap((p) => p.newlyMissing))];

    return ok({
      candidate: candidate.value,
      evaluatedOn,
      evaluatedAt,
      preview: {
        nextVersion: candidate.value.version,
        diff: diff(current?.document ?? { sections: [], attributes: [] }, candidate.value.document),
        impact,
        ownersAffected: ownersOf(after, newlyRequired),
        unchanged: current !== null && current.checksum === candidate.value.checksum,
      },
    });
  }

  return {
    async preview(tx, request) {
      const evaluated = await evaluate(tx, request);
      if (!evaluated.ok) return evaluated;
      return ok(evaluated.value.preview);
    },

    async publish(tx, request) {
      const evaluated = await evaluate(tx, request);
      if (!evaluated.ok) return evaluated;

      const { candidate, preview, evaluatedOn, evaluatedAt } = evaluated.value;

      /*
       * A version identical to the one in force is refused.
       *
       * Not for tidiness: every publish raises `schema.published`, and every
       * integration re-reads the artifact when it sees one. A settings screen
       * whose Publish button is pressed twice would otherwise tell three
       * integrations to re-read a document that did not change.
       */
      if (preview.unchanged) {
        return err(
          failure('SCHEMA_UNCHANGED', 'This version is identical to the one already published', [
            'version',
          ]),
        );
      }

      await deps.schema.appendVersion(
        tx,
        request.tenantId,
        candidate,
        events(candidate, preview, request, deps),
        evaluatedOn,
        evaluatedAt,
      );

      return ok({ version: candidate, preview });
    },
  };
}

/**
 * What a publish tells the rest of the system.
 *
 * `schema.published` carries counts and a link, never the document: a consumer
 * wanting the shape fetches the artifact by version, which is the whole reason
 * versions are immutable. The per-person `profile_incomplete` events are
 * PEO-026's, raised by the recompute rather than here — this transaction is
 * already holding a write to a table every tenant reads, and four hundred
 * events is not something to add to it.
 */
function events(
  version: PublishedVersion,
  preview: PublishPreview,
  request: PublishRequest,
  deps: PublishSchemaDeps,
): readonly PendingEvent[] {
  const at = deps.clock.instant();

  return [
    {
      eventId: deps.newEventId(),
      eventName: 'people.schema.published',
      eventVersion: 1,
      tenantId: request.tenantId as PendingEvent['tenantId'],
      occurredAt: at,
      effectiveFrom: null,
      aggregate: { type: 'Schema', id: String(version.version), version: version.version },
      actor: request.actor,
      correlationId: request.correlationId,
      causationId: null,
      payload: {
        schemaVersion: version.version,
        checksum: version.checksum,
        counts: {
          sections: version.document.sections.length,
          attributes: version.document.attributes.length,
          added: preview.diff.added.length,
          tightened: preview.diff.tightened.length,
          archived: preview.diff.archived.length,
        },
        artifactUrl: request.artifactUrl,
      },
    },
  ];
}
