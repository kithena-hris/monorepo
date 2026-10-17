import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ok, type Result } from '@kithena/domain-kit';
import type { Actor } from '@kithena/contracts';

import { DEPARTMENT_FIELD } from '../../country-packs/core.js';
import { SchemaDraft } from '../../domain/schema/draft.js';
import type { FoldSectionsDeps } from './fold-sections.js';

/**
 * Departments as a list to pick from, for a company set up before People had
 * the field: the version in force gains the core Department field, and a
 * company's own free-text `department` field is retired once the company has
 * departments of its own, so a department can no longer be typed. Published
 * by the system with its reason, as `foldSections` publishes, and the stored
 * draft is changed the same way so an administrator's next publish keeps it.
 *
 * The retired field is hidden from forms and the import, never deleted: its
 * values stay in history and in exports. Idempotent, so it runs every day.
 */

export const DEPARTMENT_REASON = 'Departments are picked from the company’s own list';
const ACTOR: Actor = { kind: 'system', process: 'people-department-field' };
const OWN = 'department';

export interface DepartmentFieldDeps extends FoldSectionsDeps {
  /** How many departments the company has. */
  readonly departments: (tx: PostgresJsDatabase, tenantId: string) => Promise<number>;
}

/** What changes in one draft: the field added, the free-text one retired. */
function apply(
  draft: SchemaDraft,
  retire: boolean,
  deps: DepartmentFieldDeps,
): { readonly added: boolean; readonly retired: boolean } {
  const added =
    draft.attribute(DEPARTMENT_FIELD.key) === undefined && draft.addAttribute(DEPARTMENT_FIELD).ok;
  const own = draft.attribute(OWN);
  const retired =
    retire &&
    own !== undefined &&
    own.origin !== 'core' &&
    own.deprecatedAt === null &&
    draft.archiveAttribute(OWN, deps.clock).ok;
  return { added, retired };
}

export function departmentField(deps: DepartmentFieldDeps) {
  return async (
    tx: PostgresJsDatabase,
    tenantId: string,
    correlationId: string,
  ): Promise<Result<{ readonly version: number | null }>> => {
    const [stored, current, departments] = await Promise.all([
      deps.schema.loadDraft(tx, tenantId),
      deps.schema.currentVersion(tx, tenantId),
      deps.departments(tx, tenantId),
    ]);
    // Nothing published yet: setup seeds the core pack, the field with it.
    if (current === null) return ok({ version: null });
    const retire = departments > 0;
    const inForce = SchemaDraft.rehydrate(current.document.sections, current.document.attributes);
    const changed = apply(inForce, retire, deps);

    // The version first: a refusal returns before any draft row is written.
    let version: number | null = null;
    if (changed.added || changed.retired) {
      const published = await deps.publisher.publish(tx, {
        tenantId,
        actor: ACTOR,
        publishedBy: null,
        correlationId,
        artifactUrl: deps.artifactUrl(current.version + 1),
        draft: inForce,
        reason: DEPARTMENT_REASON,
      });
      if (!published.ok) return published;
      version = published.value.version.version;
    }
    const draft = SchemaDraft.rehydrate(stored.sections, stored.attributes);
    const drafted = apply(draft, retire, deps);
    for (const key of [
      ...(drafted.added ? [DEPARTMENT_FIELD.key] : []),
      ...(drafted.retired ? [OWN] : []),
    ]) {
      const attribute = draft.attribute(key);
      if (attribute !== undefined) await deps.draft.saveAttribute(tx, tenantId, attribute);
    }
    return ok({ version });
  };
}
