import { createHash } from 'node:crypto';

import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import {
  checkRequirednessPredicate,
  checkVisibilityRules,
  type Attribute,
  type SchemaDraft,
  type Section,
} from './draft.js';

/**
 * Publishing a draft, and what a published version is allowed to do afterwards.
 *
 * Which is nothing. A version is immutable and append-only: an integrator
 * pinned to version 3 must keep getting version 3, and an employee record
 * validated under version 3 has to stay explicable years later — the DSAR
 * export is generated from the version the record was written under, which is
 * why that number lives on the person row.
 *
 * Rolling back therefore publishes the previous content as a **new** version.
 * Editing the old one would erase the window in which the mistake was in
 * force, and that window is a fact: records were written during it.
 *
 * `node:crypto` is the one import here that is not a contract. A checksum is a
 * pure function of its input — no clock, no I/O, no configuration — so it does
 * not make this layer impure in the sense `no-domain-importing-infrastructure`
 * cares about. Injecting a hash function would be an interface with one
 * implementation and a test double that proves nothing.
 */

export interface SchemaDocument {
  readonly sections: readonly Section[];
  readonly attributes: readonly Attribute[];
}

export interface PublishedVersion {
  readonly version: number;
  readonly document: SchemaDocument;
  /** SHA-256 over the canonical document. Content only — never the timestamp. */
  readonly checksum: string;
  readonly publishedAt: string;
  readonly publishedBy: string | null;
  /** Set when this version exists because somebody reverted to an older one. */
  readonly rolledBackFrom: number | null;
}

export interface PublishContext {
  readonly clock: Clock;
  /** The account that published. Null for a country pack applied by the system. */
  readonly actor: string | null;
}

export interface SchemaDiff {
  readonly added: readonly string[];
  /** Became required, or was reclassified upward. Both make work for somebody. */
  readonly tightened: readonly string[];
  readonly loosened: readonly string[];
  /**
   * Who may read it, or when it is required, changed in a way no rank orders:
   * a preset or custom visibility rule (PEO-066), or a new predicate (PEO-065).
   */
  readonly changed: readonly string[];
  readonly archived: readonly string[];
}

const CLASSIFICATION_RANK = {
  public: 0,
  internal: 1,
  confidential: 2,
  'special-category': 3,
} as const;

const REQUIREDNESS_RANK = { never: 0, conditional: 1, always: 2 } as const;

/**
 * The document, in an order two publishes will always agree on.
 *
 * A checksum over `JSON.stringify` of whatever order a Map happened to iterate
 * in is a checksum that changes when nothing did, which makes it useless for
 * the one question it is asked: has anything actually changed. Keys are sorted
 * and so is every object's property order.
 */
function canonical(document: SchemaDocument): string {
  return JSON.stringify({
    sections: [...document.sections]
      .toSorted((a, b) => a.key.localeCompare(b.key))
      .map((s) => sortKeys(s)),
    attributes: [...document.attributes]
      .toSorted((a, b) => a.key.localeCompare(b.key))
      .map((a) => sortKeys(a)),
  });
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => sortKeys(v));
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => [key, sortKeys(v)]),
  );
}

export function checksumOf(document: SchemaDocument): string {
  return createHash('sha256').update(canonical(document)).digest('hex');
}

/**
 * Freeze the version and everything under it.
 *
 * `readonly` is advice the compiler gives; this is the rule a running process
 * obeys. The value crosses into the application layer, a GraphQL resolver and
 * a cache, and any of those could hold it while something else edits it.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  return Object.freeze(value);
}

/**
 * Publish a draft as the next version.
 *
 * The draft's *live* content is what gets published: an archived section or a
 * deprecated attribute is hidden from forms, and a version is what forms and
 * APIs are rendered from. History keeps the rest.
 */
export function publish(
  draft: SchemaDraft,
  previous: PublishedVersion | null,
  ctx: PublishContext,
): Result<PublishedVersion> {
  const document: SchemaDocument = {
    sections: draft.liveSections(),
    attributes: draft.liveAttributes(),
  };

  if (document.sections.length === 0 || document.attributes.length === 0) {
    return err(
      failure(
        'NOTHING_TO_PUBLISH',
        'A version with no fields validates every record as complete',
        ['attributes'],
      ),
    );
  }

  for (const attribute of document.attributes) {
    const discloses = checkVisibilityRules(attribute, document.attributes);
    if (!discloses.ok) return discloses;
    const predicate = checkRequirednessPredicate(attribute, document.attributes);
    if (!predicate.ok) return predicate;
  }

  return ok(
    deepFreeze({
      version: (previous?.version ?? 0) + 1,
      document,
      checksum: checksumOf(document),
      publishedAt: ctx.clock.instant(),
      publishedBy: ctx.actor,
      rolledBackFrom: null,
    }),
  );
}

/**
 * What changed between two versions.
 *
 * `tightened` is the number that matters and the reason this is computed
 * before anything is written: it is how many people are about to become
 * incomplete, and showing it is what stops an admin marking six fields
 * required on a Friday afternoon and mailing four hundred people.
 */
export function diff(before: SchemaDocument, after: SchemaDocument): SchemaDiff {
  const was = new Map(before.attributes.map((a) => [a.key as string, a]));
  const is = new Map(after.attributes.map((a) => [a.key as string, a]));

  const added: string[] = [];
  const tightened: string[] = [];
  const loosened: string[] = [];
  const changed: string[] = [];

  for (const [key, next] of is) {
    const current = was.get(key);
    if (!current) {
      added.push(key);
      continue;
    }

    const requiredness =
      REQUIREDNESS_RANK[next.requiredness.mode] - REQUIREDNESS_RANK[current.requiredness.mode];
    const classification =
      CLASSIFICATION_RANK[next.classification.classification] -
      CLASSIFICATION_RANK[current.classification.classification];

    if (requiredness > 0 || classification > 0) tightened.push(key);
    else if (requiredness < 0 || classification < 0) loosened.push(key);
    else if (
      JSON.stringify(sortKeys([next.visibility, next.visibilityRules ?? [], next.requiredness])) !==
      JSON.stringify(sortKeys([current.visibility, current.visibilityRules ?? [], current.requiredness]))
    ) {
      changed.push(key);
    }
  }

  const archived = [...was.keys()].filter((key) => !is.has(key));

  return {
    added: added.toSorted(),
    tightened: tightened.toSorted(),
    loosened: loosened.toSorted(),
    changed: changed.toSorted(),
    archived: archived.toSorted(),
  };
}

/**
 * Republish an older version's content as the next version.
 *
 * `rolledBackFrom` records what was in force when somebody decided to revert,
 * because "version 3 is identical to version 1" and "version 3 exists because
 * version 2 was wrong" are different facts and only the second one explains
 * the support ticket.
 */
export function rollbackTo(
  target: PublishedVersion,
  current: PublishedVersion,
  ctx: PublishContext,
): Result<PublishedVersion> {
  if (target.version === current.version) {
    return err(
      failure('ALREADY_IN_FORCE', `Version ${String(target.version)} is already in force`, [
        'version',
      ]),
    );
  }

  return ok(
    deepFreeze({
      version: current.version + 1,
      document: target.document,
      checksum: target.checksum,
      publishedAt: ctx.clock.instant(),
      publishedBy: ctx.actor,
      rolledBackFrom: current.version,
    }),
  );
}
