import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';
import type { Classification, PiiKind } from '@kithena/contracts';

import type { ViewerRelations } from '../../domain/access/field-access.js';
import { stateAt, type ApprovalState } from '../../domain/approval/approval.js';
import type { PendingChangeStore } from '../person/pending-changes.js';
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
  /**
   * Every change to their record that waited, or waits, for approval
   * (PEO-077), on exportable attributes: the value asked for — sealed ones
   * in full while they wait, as a sealed attribute is, and by their last four
   * once closed, when nothing that opens is kept — where it stands and when.
   * Who asked and who decided are said by role, never by name: a colleague's
   * identity is not the subject's data.
   */
  readonly changes: readonly DsarChange[];
}

export interface DsarChange {
  readonly id: string;
  readonly attributeKey: string;
  readonly label: string;
  readonly kind: 'value' | 'correction';
  readonly value: unknown;
  readonly state: ApprovalState;
  readonly effectiveFrom: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  /** True when the subject asked for it themselves. */
  readonly requestedBySubject: boolean;
  /** HR for a decision, the requester for a withdrawal, nobody for an expiry or a wait. */
  readonly decidedBy: 'hr' | 'requester' | null;
  readonly decidedAt: string | null;
  readonly reason: string | null;
  readonly note: string | null;
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
  /** Changes held for approval (PEO-077). Absent, the pack has none. */
  readonly pending?: Pick<PendingChangeStore, 'forPerson' | 'unseal'>;
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

    const now = deps.clock.instant();
    const labels = new Map(exportable.map((a) => [a.key as string, a.label.default]));
    const account = record.columns['identity_account_id'];
    const changes: DsarChange[] = [];
    for (const c of (await deps.pending?.forPerson(tx, tenantId, personId)) ?? []) {
      const label = labels.get(c.attributeKey);
      if (label === undefined) continue;
      const plaintext =
        c.sealed && c.approval.state === 'pending'
          ? // eslint-disable-next-line no-await-in-loop -- a handful of changes per person
            await deps.pending?.unseal(tx, tenantId, c.approval.id)
          : null;
      const state = stateAt(c.approval, now);
      changes.push({
        id: c.approval.id,
        attributeKey: c.attributeKey,
        label,
        kind: c.kind,
        value: !c.sealed
          ? c.value
          : plaintext !== null && plaintext !== undefined
            ? (JSON.parse(plaintext) as unknown)
            : { last4: c.last4 },
        state,
        effectiveFrom: c.effectiveFrom,
        requestedAt: c.approval.requestedAt,
        expiresAt: c.approval.expiresAt,
        requestedBySubject: typeof account === 'string' && account === c.approval.requestedBy,
        decidedBy:
          state === 'approved' || state === 'rejected'
            ? 'hr'
            : state === 'withdrawn'
              ? 'requester'
              : null,
        decidedAt: c.approval.decidedAt,
        reason: c.approval.reason === '' ? null : c.approval.reason,
        note: c.approval.note,
      });
    }

    return ok({
      personId,
      generatedAt: now,
      schemaVersion: manifest.version,
      attributes,
      history: history.filter((h) => !withheld.has(h.attributeKey)),
      events,
      changes,
    });
  };
}
