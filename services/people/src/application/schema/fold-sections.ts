import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ok, type Clock, type Result } from '@kithena/domain-kit';
import type { Actor } from '@kithena/contracts';

import { SchemaDraft, type SectionFold } from '../../domain/schema/draft.js';
import type { PublishSchema } from './publish-schema.js';
import type { DraftWriter, SchemaRepository } from './schema-repository.js';

/**
 * Fold sections that share a name, for one tenant, as a published version.
 *
 * Before `addSection` refused a duplicate name, an import could mint a second
 * "Employment" beside the core one, and every profile showed both. This
 * merges them the way any schema change is made: the version in force, with
 * the duplicates folded into the first of each name, published as the next
 * version by the system with its reason, so history, `schema.published` and
 * every integration see it. The stored draft is folded the same way, keeping
 * whatever an administrator has not published yet out of the system's version.
 *
 * Only definitions move — which section a field is in, and its order — so no
 * key changes and no person's record is touched. Idempotent: with nothing to
 * fold it writes nothing, so it runs at every boot.
 */

export const FOLD_REASON = 'Duplicate sections merged';
const ACTOR: Actor = { kind: 'system', process: 'people-schema-fold' };

export interface FoldSectionsDeps {
  readonly schema: SchemaRepository;
  readonly draft: DraftWriter;
  readonly publisher: PublishSchema;
  readonly clock: Clock;
  readonly artifactUrl: (version: number) => string;
}

export function foldSections(deps: FoldSectionsDeps) {
  return async (
    tx: PostgresJsDatabase,
    tenantId: string,
    correlationId: string,
  ): Promise<Result<{ readonly version: number | null; readonly folds: readonly SectionFold[] }>> => {
    const [stored, current] = await Promise.all([
      deps.schema.loadDraft(tx, tenantId),
      deps.schema.currentVersion(tx, tenantId),
    ]);
    const draft = SchemaDraft.rehydrate(stored.sections, stored.attributes);
    const draftFolds = draft.foldDuplicateSections(deps.clock);
    const inForce =
      current === null
        ? null
        : SchemaDraft.rehydrate(current.document.sections, current.document.attributes);
    const versionFolds = inForce?.foldDuplicateSections(deps.clock) ?? [];

    // The version first: a refusal returns before any draft row is written.
    let version: number | null = null;
    if (inForce !== null && current !== null && versionFolds.length > 0) {
      const published = await deps.publisher.publish(tx, {
        tenantId,
        actor: ACTOR,
        publishedBy: null,
        correlationId,
        artifactUrl: deps.artifactUrl(current.version + 1),
        draft: inForce,
        reason: FOLD_REASON,
      });
      if (!published.ok) return published;
      version = published.value.version.version;
    }
    for (const fold of draftFolds) {
      for (const key of fold.from) {
        const section = draft.section(key);
        if (section !== undefined) await deps.draft.saveSection(tx, tenantId, section);
      }
      for (const key of fold.moved) {
        const attribute = draft.attribute(key);
        if (attribute !== undefined) await deps.draft.saveAttribute(tx, tenantId, attribute);
      }
    }
    return ok({ version, folds: versionFolds.length > 0 ? versionFolds : draftFolds });
  };
}
