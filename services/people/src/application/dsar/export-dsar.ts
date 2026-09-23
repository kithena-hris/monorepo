import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';
import type { Classification, PiiKind } from '@kithena/contracts';

import type { ViewerRelations } from '../../domain/access/field-access.js';
import type { HistoryEntry } from '../../domain/person/history.js';
import type { SchemaDocument } from '../../domain/schema/publish.js';
import type { PersonRepository } from '../person-repository.js';

/**
 * A subject access request, answered from the registry rather than from memory
 * (PRD §12.2, §15.5).
 *
 * **The manifest is the version the record was written under.** Which
 * attributes exist, and which are exportable, is read from the published
 * schema version on the person row — not from today's registry, which may have
 * archived a field the record still holds, and not from the static codegen
 * set, which has never heard of a field the tenant invented.
 *
 * **It runs as the subject.** Visibility rules are for viewers; the subject's
 * right of access is not a viewer's, so a diversity answer nobody may see as
 * an individual value is still in the subject's own pack. The one question
 * asked of the requester is whether they are the subject.
 *
 * Every exportable attribute appears, filled in or not: a pack that omits
 * empty fields cannot be told apart from one that lost them.
 *
 * `ponytail: JSON only. The zip with a PDF for reading and the attached
 * documents waits for PEO-061's PDF renderer and a document store; this is
 * the JSON file that pack will contain.`
 */

export interface DsarAttribute {
  readonly key: string;
  readonly label: string;
  readonly sectionKey: string;
  readonly classification: Classification;
  readonly piiKind: PiiKind;
  readonly value: unknown;
}

export interface DsarPackage {
  readonly personId: string;
  readonly generatedAt: string;
  /** The version the manifest came from. */
  readonly schemaVersion: number;
  readonly attributes: readonly DsarAttribute[];
  /** Every dated fact for an exportable attribute, corrections included. */
  readonly history: readonly HistoryEntry[];
  /** Every event this person's record produced. */
  readonly events: readonly unknown[];
}

/** What the export reads. Every method takes the caller's tenant transaction. */
export interface DsarSource {
  /** The row, keyed by column name, or null when there is no such person. */
  record(
    tx: PostgresJsDatabase,
    tenantId: string,
    personId: string,
  ): Promise<{
    readonly schemaVersion: number | null;
    readonly columns: Readonly<Record<string, unknown>>;
    readonly custom: Readonly<Record<string, unknown>>;
  } | null>;
  /** A published version's document; the latest when `version` is null. */
  document(tx: PostgresJsDatabase, tenantId: string, version: number | null): Promise<{ version: number; document: SchemaDocument } | null>;
  events(tx: PostgresJsDatabase, tenantId: string, personId: string): Promise<readonly unknown[]>;
}

export interface ExportDsarDeps {
  readonly source: DsarSource;
  readonly people: Pick<PersonRepository, 'history'>;
  /** `drizzleSecretStore(...).reveal`, the one call named for returning a plaintext. */
  readonly secrets: {
    reveal(
      tx: PostgresJsDatabase,
      where: { tenantId: string; personId: string; attributeKey: string },
    ): Promise<string | null>;
  };
  readonly clock: Clock;
}

export interface DsarRequest {
  readonly tenantId: string;
  readonly personId: string;
  readonly requester: ViewerRelations;
}

export function exportDsar(
  deps: ExportDsarDeps,
): (tx: PostgresJsDatabase, request: DsarRequest) => Promise<Result<DsarPackage>> {
  return async (tx, { tenantId, personId, requester }) => {
    if (!requester.isSelf) {
      return err(failure('DSAR_NOT_SUBJECT', 'A subject access export is run as the subject'));
    }

    const record = await deps.source.record(tx, tenantId, personId);
    if (!record) return err(failure('PERSON_NOT_FOUND', 'No such person', ['personId']));

    /*
     * A record never validated against a version (a provisional one) is read
     * under the latest. No version at all is refused rather than answered
     * with an empty pack: an incomplete DSAR that looks complete is the one
     * outcome worse than a late one.
     */
    const manifest = await deps.source.document(tx, tenantId, record.schemaVersion);
    if (!manifest) {
      return err(failure('DSAR_NO_SCHEMA', 'No published schema version to export under'));
    }

    const exportable = manifest.document.attributes.filter((a) => a.classification.exportable);
    const withheld = new Set(
      manifest.document.attributes.filter((a) => !a.classification.exportable).map((a) => a.key as string),
    );

    const attributes: DsarAttribute[] = [];
    for (const a of exportable) {
      const key = a.key as string;
      const value = a.encrypted
        ? // eslint-disable-next-line no-await-in-loop -- a handful of secrets per person
          await deps.secrets.reveal(tx, { tenantId, personId, attributeKey: key })
        : // A tenant field lives in `custom`; a core one is a typed column of the same name.
          Object.hasOwn(record.custom, key)
          ? record.custom[key]
          : record.columns[key];
      attributes.push({
        key,
        label: a.label.default,
        sectionKey: a.sectionKey,
        classification: a.classification.classification,
        piiKind: a.classification.piiKind,
        value: value ?? null,
      });
    }

    const [history, events] = await Promise.all([
      deps.people.history(tx, tenantId, personId),
      deps.source.events(tx, tenantId, personId),
    ]);

    return ok({
      personId,
      generatedAt: deps.clock.instant(),
      schemaVersion: manifest.version,
      attributes,
      history: history.filter((h) => !withheld.has(h.attributeKey)),
      events,
    });
  };
}
