import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ok, type Result } from '@kithena/domain-kit';
import type { Actor } from '@kithena/contracts';

import { DEPARTMENT_FIELD } from '../../country-packs/core.js';
import { SchemaDraft } from '../../domain/schema/draft.js';
import type { FoldSectionsDeps } from './fold-sections.js';

/**
 * A department and a manager are picked, never typed. For a company set up
 * before People had the Department field, the version in force gains it, and
 * a company's own free-text `department` field is retired once the company
 * has departments of its own. A company's own field standing in for the
 * manager ("Manager Employee Number", "Supervisor ID") is retired at once:
 * Manager is a core field every company has, picked by name. Published
 * by the system with its reason, as `foldSections` publishes, and the stored
 * draft is changed the same way so an administrator's next publish keeps it.
 *
 * The retired field is hidden from forms and the import, never deleted: its
 * values stay in history and in exports. Idempotent, so it runs every day.
 */

export const PICKED_REASON = 'Departments and managers are picked, not typed';
const ACTOR: Actor = { kind: 'system', process: 'people-picked-fields' };
const OWN = 'department';
/** A company's own field for the manager, by its key: `supervisor_id`, `manager_employee_number`. */
const MANAGER_STAND_IN =
  /^(manager|supervisor|reports_to|line_manager)(_(id|number|email|name|employee_(number|id)))?$/u;

export interface PickedFieldsDeps extends FoldSectionsDeps {
  /** How many departments the company has. */
  readonly departments: (tx: PostgresJsDatabase, tenantId: string) => Promise<number>;
}

/** What changes in one draft: the field added, the free-text one retired. */
function apply(
  draft: SchemaDraft,
  retire: boolean,
  deps: PickedFieldsDeps,
): { readonly added: boolean; readonly retired: readonly string[] } {
  const added =
    draft.attribute(DEPARTMENT_FIELD.key) === undefined && draft.addAttribute(DEPARTMENT_FIELD).ok;
  const retired = draft
    .liveAttributes()
    .filter(
      (a) =>
        a.origin !== 'core' &&
        a.dataType !== 'person_ref' &&
        a.dataType !== 'org_unit_ref' &&
        ((retire && a.key === OWN) || MANAGER_STAND_IN.test(a.key)),
    )
    .map((a) => a.key)
    .filter((key) => draft.archiveAttribute(key, deps.clock).ok);
  return { added, retired };
}

export function pickedFields(deps: PickedFieldsDeps) {
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
    if (changed.added || changed.retired.length > 0) {
      const published = await deps.publisher.publish(tx, {
        tenantId,
        actor: ACTOR,
        publishedBy: null,
        correlationId,
        artifactUrl: deps.artifactUrl(current.version + 1),
        draft: inForce,
        reason: PICKED_REASON,
      });
      if (!published.ok) return published;
      version = published.value.version.version;
    }
    const draft = SchemaDraft.rehydrate(stored.sections, stored.attributes);
    const drafted = apply(draft, retire, deps);
    for (const key of [...(drafted.added ? [DEPARTMENT_FIELD.key] : []), ...drafted.retired]) {
      const attribute = draft.attribute(key);
      if (attribute !== undefined) await deps.draft.saveAttribute(tx, tenantId, attribute);
    }
    return ok({ version });
  };
}
