import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ok, type Result } from '@kithena/domain-kit';
import type { Actor } from '@kithena/contracts';

import type { Attribute } from '../../domain/schema/draft.js';
import type { PersonAccess } from '../person/person-access.js';
import type { SchemaVersions } from '../person/ports.js';
import { SYSTEM_VIEWER } from '../person/subject.js';
import { aliasOf } from '../../domain/import/aliases.js';
import {
  CORE_PACK,
  DEPARTMENT_FIELD,
  EMPLOYEE_NUMBER_FIELD,
  SIGNATURE_FIELD,
  STANDARD_FIELDS,
} from '../../country-packs/core.js';
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
 *
 * A company with no signature field gains People's own (`SIGNATURE_FIELD`) the
 * same way, so a hire's contract signature always has somewhere to go, and
 * every core section and field it lacks (`CORE_PACK`): the personal,
 * employment and pay fields every company has. A company's own field under a
 * core key is left as it is. The employee number becomes Kithena's to give and
 * required, and People numbers whoever has none (`PersonAccess.number`).
 */

export const PICKED_REASON = 'Every company has the core fields; departments and managers are picked, not typed';
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
/** The core fields a company's own may stand in for: the personal, employment and pay ones. */
const FOLDABLE: ReadonlySet<string> = new Set(STANDARD_FIELDS.map((f) => f.key));

/**
 * A company's own field that means a core one: "Probation End Date" beside
 * Probation end, of the same type, named as an import names it (`aliasOf`).
 * Its values are copied onto the core field (`foldStandIns`), then it is retired.
 */
export function standIns(
  attributes: readonly Attribute[],
): readonly { readonly own: Attribute; readonly core: Attribute }[] {
  const live = attributes.filter((a) => a.deprecatedAt === null);
  return live.flatMap((own) => {
    if (own.origin !== 'tenant' || own.cardinality !== 'single') return [];
    const key = aliasOf(own.label.default) ?? aliasOf(own.key.replaceAll('_', ' '));
    if (key === null || !FOLDABLE.has(key)) return [];
    const core = live.find((a) => a.key === key && a.origin === 'core');
    return core !== undefined && core.dataType === own.dataType ? [{ own, core }] : [];
  });
}

function apply(
  draft: SchemaDraft,
  retire: boolean,
  deps: PickedFieldsDeps,
  /** Their values are on the core fields now: retire the company's stand-ins. */
  folded: boolean,
): {
  readonly sections: readonly string[];
  readonly added: readonly string[];
  readonly retired: readonly string[];
} {
  const sections = CORE_PACK.sections
    .filter((s) => draft.section(s.key) === undefined && draft.addSection(s).ok)
    .map((s) => s.key);
  // The employee number Kithena gives and nobody types (`EMPLOYEE_NUMBER_FIELD`).
  const number = draft.attribute(EMPLOYEE_NUMBER_FIELD.key);
  const locked =
    number !== undefined &&
    number.origin === 'core' &&
    number.ownership.some((r) => r !== 'system') &&
    draft.updateAttribute(number.key, {
      ownership: EMPLOYEE_NUMBER_FIELD.ownership,
      requiredness: EMPLOYEE_NUMBER_FIELD.requiredness,
    }).ok
      ? number.key
      : null;
  // A salary keeps its history: a core pay field from before that, dated now.
  const dated = CORE_PACK.attributes
    .filter((c) => c.effectiveDated === true)
    .map((c) => draft.attribute(c.key))
    .filter(
      (a) =>
        a !== undefined &&
        a.origin === 'core' &&
        !a.effectiveDated &&
        draft.updateAttribute(a.key, { effectiveDated: true }).ok,
    )
    .map((a) => a?.key ?? null);
  const added = [
    locked,
    ...dated,
    draft.attribute(DEPARTMENT_FIELD.key) === undefined && draft.addAttribute(DEPARTMENT_FIELD).ok
      ? DEPARTMENT_FIELD.key
      : null,
    draft.liveAttributes().some((a) => a.dataType === 'signature') ||
    draft.attribute(SIGNATURE_FIELD.key) !== undefined ||
    !draft.addAttribute(SIGNATURE_FIELD).ok
      ? null
      : SIGNATURE_FIELD.key,
    ...CORE_PACK.attributes
      .filter((a) => a.key !== DEPARTMENT_FIELD.key && a.key !== SIGNATURE_FIELD.key)
      .map((a) => (draft.attribute(a.key) === undefined && draft.addAttribute(a).ok ? a.key : null)),
  ].filter((k) => k !== null);
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
  const foldedAway = folded
    ? standIns(draft.liveAttributes())
        .map(({ own }) => own.key)
        .filter((key) => draft.archiveAttribute(key, deps.clock).ok)
    : [];
  return { sections, added, retired: [...retired, ...foldedAway] };
}

export function pickedFields(deps: PickedFieldsDeps) {
  return async (
    tx: PostgresJsDatabase,
    tenantId: string,
    correlationId: string,
    /** Every stand-in's values are on its core field already (`foldStandIns`). */
    folded = false,
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
    const changed = apply(inForce, retire, deps, folded);

    // The version first: a refusal returns before any draft row is written.
    let version: number | null = null;
    if (changed.sections.length > 0 || changed.added.length > 0 || changed.retired.length > 0) {
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
    const drafted = apply(draft, retire, deps, folded);
    for (const key of drafted.sections) {
      const section = draft.section(key);
      if (section !== undefined) await deps.draft.saveSection(tx, tenantId, section);
    }
    for (const key of [...drafted.added, ...drafted.retired]) {
      const attribute = draft.attribute(key);
      if (attribute !== undefined) await deps.draft.saveAttribute(tx, tenantId, attribute);
    }
    return ok({ version });
  };
}

type Run = <T>(work: (tx: PostgresJsDatabase) => Promise<T>) => Promise<T>;

/**
 * Copies a stand-in's values onto its core field (`standIns`) for everyone
 * whose core field is empty, as the system, a person per transaction, so the
 * stand-in can be retired without anybody's value disappearing from their
 * record; it stays in history and exports. `done` is false while any copy was
 * refused, and the stand-ins are then kept for another day.
 */
export function foldStandIns(deps: {
  readonly access: Pick<PersonAccess, 'list' | 'update'>;
  readonly schemas: Pick<SchemaVersions, 'current'>;
}) {
  return async (
    run: Run,
    tenantId: string,
    correlationId: string,
  ): Promise<{ readonly copied: number; readonly done: boolean }> => {
    const version = await run((tx) => deps.schemas.current(tx, tenantId));
    const pairs = version === null ? [] : standIns(version.document.attributes);
    if (pairs.length === 0) return { copied: 0, done: true };
    const asking = { tenantId, viewer: SYSTEM_VIEWER, correlationId };
    const empty = (v: unknown) => v === undefined || v === null || v === '';
    let copied = 0;
    let done = true;
    let after: string | null = null;
    do {
      const from: string | null = after;
      const page: Awaited<ReturnType<PersonAccess['list']>> = await run((tx) =>
        deps.access.list(tx, { ...asking, limit: 200, ...(from === null ? {} : { after: from }) }),
      );
      if (!page.ok) return { copied, done: false };
      for (const person of page.value.items) {
        const changes = Object.fromEntries(
          pairs
            .filter(
              ({ own, core }) =>
                !empty(person.attributes[own.key]) && empty(person.attributes[core.key]),
            )
            .map(({ own, core }) => [core.key, person.attributes[own.key]]),
        );
        if (Object.keys(changes).length === 0) continue;
        // eslint-disable-next-line no-await-in-loop -- a person per transaction, in turn
        const written = await run((tx) =>
          deps.access.update(tx, {
            ...asking,
            personId: person.id,
            changes,
            applySensitiveWithoutApproval: true,
          }),
        );
        if (written.ok) copied += 1;
        else done = false;
      }
      after = page.value.next;
    } while (after !== null);
    return { copied, done };
  };
}
