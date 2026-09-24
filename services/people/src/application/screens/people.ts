import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import type { EmploymentPeriodRow } from '../../domain/person/person.js';

import { visibleTo } from '../../domain/access/field-access.js';
import { filterable, type Asking, type PersonView } from '../person/person-access.js';
import { run } from '../person/service.js';
import type { FormValues, RecordSection } from './model.js';
import {
  formValues,
  nameOf,
  NOBODY,
  personOfViewer,
  recordSections,
  saveSection,
  toForm,
  type ScreenDeps,
  type Tx,
} from './record.js';

/**
 * The screens about people: onboarding, a profile, the directory and the
 * completeness grid (PRD §8.3, §6.6, §13.1, §8.4; screens 5 to 8).
 *
 * Every one reads through `PersonAccess`, so a withheld field is absent here
 * for the reason it is absent from REST: the same call made the decision.
 */

/** People as the options of a person picker: who this viewer can see, by name. */
function pickable(people: readonly PersonView[]): { value: string; label: string }[] {
  return people.flatMap((p) => {
    const name = nameOf(p.attributes);
    return name === null ? [] : [{ value: p.id, label: name }];
  });
}

/**
 * The people a record's person fields name, as picker options: each read as
 * this viewer may read them, so a name they cannot see is not offered. The
 * rest of the picker is searched a page at a time (`pickerView`).
 */
async function named(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  ids: Iterable<string>,
): Promise<{ value: string; label: string }[]> {
  const options: { value: string; label: string }[] = [];
  for (const personId of new Set(ids)) {
    const read = await deps.service.access.read(tx, { ...asking, personId });
    if (read.ok) options.push(...pickable([read.value]));
  }
  return options;
}

/** The ids a record's person fields hold. */
function referenced(
  definitions: readonly AttributeDefinition[],
  attributes: Readonly<Record<string, unknown>>,
): string[] {
  return definitions
    .filter((d) => d.typeConfig.kind === 'person_ref')
    .map((d) => attributes[d.key])
    .filter((v): v is string => typeof v === 'string');
}

/* ------------------------------------------------------------- picker -- */

/** A picker's page. Twenty is what a list under a text box shows. */
export const PICKER_PAGE = 20;

export interface PickerView {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** The cursor for the page after this one; null on the last page. */
  readonly next: string | null;
}

/**
 * People to pick from, a page at a time (PEO-122): the same keyset list and
 * the same search as the directory (PEO-117), so a picker reaches the
 * 50,000th person by typing their name, and names only who this viewer reads.
 */
export async function pickerView(
  deps: ScreenDeps,
  asking: Asking,
  query: { readonly search: string; readonly after?: string | null },
): Promise<Result<PickerView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const listed = await deps.service.access.list(tx, {
      ...asking,
      ...(query.search.trim() === '' ? {} : { search: query.search }),
      after: query.after ?? null,
      limit: PICKER_PAGE,
    });
    if (!listed.ok) return listed;
    return ok({ options: pickable(listed.value.items), next: listed.value.next });
  });
}

/* --------------------------------------------------------- onboarding -- */

export interface OnboardingView {
  readonly firstName: string;
  readonly sections: readonly (RecordSection & {
    readonly ask: 'required' | 'optional' | 'voluntary';
  })[];
  readonly values: FormValues;
  readonly saved: readonly string[];
}

/** What a person is asked for after their first sign-in: never an `hr_only` field (§8.3). */
const askedOfEmployee = (d: AttributeDefinition) => d.collectAt !== 'hr_only';

export async function onboardingView(
  deps: ScreenDeps,
  asking: Asking,
): Promise<Result<OnboardingView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const own = await personOfViewer(deps, tx, asking);
    if (!own.ok) return own;
    const record = await ownRecord(deps, tx, asking, own.value, askedOfEmployee);
    if (!record.ok) return record;
    const { view, sections, version } = record.value;
    const values = formValues(view, sections);
    const special = new Set(
      version.document.attributes
        .filter((d) => d.classification.classification === 'special-category')
        .map((d) => d.sectionKey as string),
    );
    return ok({
      firstName:
        typeof view.attributes['preferred_name'] === 'string' &&
        view.attributes['preferred_name'] !== ''
          ? view.attributes['preferred_name']
          : typeof view.attributes['given_name'] === 'string'
            ? view.attributes['given_name']
            : 'there',
      sections: sections.map((s) => ({
        ...s,
        ask: special.has(s.key)
          ? 'voluntary'
          : s.fields.some((f) => f.required && !f.readOnly)
            ? 'required'
            : 'optional',
      })),
      values,
      // A section is done once it holds an answer and nothing it requires is missing.
      saved: sections
        .filter(
          (s) =>
            s.fields.some((f) => !f.readOnly && values[f.key] != null) &&
            s.fields.every((f) => !f.required || values[f.key] != null),
        )
        .map((s) => s.key),
    });
  });
}

async function ownRecord(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  personId: string,
  include: (d: AttributeDefinition) => boolean,
) {
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
  const view = await deps.service.access.read(tx, { ...asking, personId });
  if (!view.ok) return view;
  const people = await named(
    deps,
    tx,
    asking,
    referenced(version.document.attributes, view.value.attributes),
  );
  const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, personId);
  const verdict = await deps.service.access.completeness(tx, { ...asking, personId });
  const missing = new Set(verdict.ok ? verdict.value.missing.map((m) => m.key) : []);
  const sections = recordSections(version, relations, include, missing, people);
  return ok({ view: view.value, sections, version, missing: verdict.ok ? missing.size : null });
}

/* ------------------------------------------------------------ profile -- */

export interface ProfileView {
  readonly person: {
    readonly name: string;
    readonly summary: string | null;
    readonly avatarUrl: string | null;
    readonly missing: number | null;
  };
  readonly sections: readonly (RecordSection & { readonly readsLogged: boolean })[];
  readonly values: FormValues;
  /** Whose day it is for them, and what day: HR's alone, absent for anybody else (PEO-119). */
  readonly calendar: { readonly today: string; readonly timeZone: string } | null;
  /** HR's alone, beside the calendar: where they stand and every employment (PEO-120). */
  readonly employment: {
    readonly status: string;
    readonly periods: readonly EmploymentPeriodRow[];
  } | null;
  /**
   * Where the person sits, and where HR may move them (PEO-123). Null unless
   * the viewer is HR, the schema has a legal entity or location to place, and
   * the person is not a leaver.
   */
  readonly placement: PlacementView | null;
}

export interface PlacementView {
  readonly legalEntityId: string | null;
  readonly locationId: string | null;
  /** The entities a person may be placed in: the live ones, and theirs. */
  readonly entities: readonly { readonly value: string; readonly label: string }[];
  readonly locations: readonly {
    readonly value: string;
    readonly label: string;
    readonly legalEntityId: string;
  }[];
}

/** The attributes the placement control writes (PEO-123). */
const PLACED = new Set(['legal_entity_id', 'location_id']);

/**
 * One person, as this viewer may see them. `personId` null is "my profile".
 *
 * The same screen for everybody (§6.6): it differs only by what the read
 * returned and what the viewer may write.
 */
export async function profileView(
  deps: ScreenDeps,
  asking: Asking,
  personId: string | null,
): Promise<Result<ProfileView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const id = personId === null ? await personOfViewer(deps, tx, asking) : ok(personId);
    if (!id.ok) return id;
    const record = await ownRecord(deps, tx, asking, id.value, () => true);
    if (!record.ok) return record;
    const { view, sections } = record.value;
    const calendar = await deps.service.access.calendar(tx, { ...asking, personId: id.value });
    const periods = calendar.ok
      ? await deps.service.access.employmentPeriods(tx, { ...asking, personId: id.value })
      : null;
    const title = view.attributes['job_title'];
    const photo = view.attributes['photo'];

    // Entities and locations by name, and the placement control for HR.
    const org = await deps.calendars.load(tx, asking.tenantId);
    const at = (key: string) => {
      const v = view.attributes[key];
      return typeof v === 'string' ? v : null;
    };
    const entities = [...org.entities.values()]
      .filter((e) => e.archived !== true || e.id === at('legal_entity_id'))
      .map((e) => ({ value: e.id, label: e.name }));
    const locations = [...org.locations.values()]
      .filter((l) => l.archived !== true || l.id === at('location_id'))
      .map((l) => ({ value: l.id, label: l.name, legalEntityId: l.legalEntityId }));
    const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, id.value);
    const placeable =
      relations.isHr &&
      !['terminated', 'discarded'].includes(view.status) &&
      sections.some((s) => s.fields.some((f) => PLACED.has(f.key)));
    const named = sections.map((s) => ({
      ...s,
      fields: s.fields.map((f) => {
        const options =
          f.key === 'legal_entity_id'
            ? entities
            : f.key === 'location_id'
              ? locations.map(({ value, label }) => ({ value, label }))
              : f.options;
        // Moved through the placement control, where the date and the transfer are.
        return PLACED.has(f.key) && placeable ? { ...f, options, readOnly: true } : { ...f, options };
      }),
    }));

    return ok({
      person: {
        name: nameOf(view.attributes) ?? 'Unnamed',
        summary: typeof title === 'string' ? title : null,
        avatarUrl: typeof photo === 'string' && photo.startsWith('https://') ? photo : null,
        missing: record.value.missing,
      },
      // Reading a sealed value in full is audited; this screen only ever shows the last four.
      calendar: calendar.ok ? calendar.value : null,
      employment: periods?.ok ? { status: view.status, periods: periods.value } : null,
      sections: named.map((s) => ({ ...s, readsLogged: false })),
      values: formValues(view, named),
      placement: placeable
        ? {
            legalEntityId: at('legal_entity_id'),
            locationId: at('location_id'),
            entities,
            locations,
          }
        : null,
    });
  });
}

export { saveSection };

/* ---------------------------------------------------------- directory -- */

export interface DirectoryView {
  /** Active people among everybody the search and filters match, not only this page. */
  readonly active: number;
  readonly incomplete: number | null;
  readonly columns: readonly { readonly key: string; readonly label: string }[];
  readonly filterable: readonly {
    readonly key: string;
    readonly label: string;
    readonly options: readonly { readonly value: string; readonly label: string }[];
  }[];
  readonly people: readonly {
    readonly id: string;
    readonly name: string;
    readonly email: string | null;
    readonly avatarUrl: string | null;
    readonly values: Readonly<Record<string, string>>;
    readonly missing: number | null;
  }[];
  /** The cursor for the page after this one; null on the last page. */
  readonly next: string | null;
  /** Which of the screen's two buttons this viewer gets (§13.1). */
  readonly can: { readonly import: boolean; readonly export: boolean };
}

/** Shown as columns: in the directory, and readable on everybody. */
const COLUMN_SKIP = new Set(['given_name', 'family_name', 'preferred_name', 'work_email']);

/** A directory page. Keyset, so the last page of 50,000 costs what the first does. */
export const DIRECTORY_PAGE = 50;

/**
 * One page of the directory (PEO-117).
 *
 * Search, filters and paging all run in Postgres through `PersonAccess.list`,
 * so they reach everybody rather than a first page, and are authorized as
 * every list is: a filter on a key the viewer cannot read on everybody, or a
 * search when no name is, is refused rather than answered.
 */
export async function directoryView(
  deps: ScreenDeps,
  asking: Asking,
  query: {
    readonly search: string;
    readonly filters: Readonly<Record<string, string>>;
    readonly after?: string | null;
  },
): Promise<Result<DirectoryView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const definitions = version.document.attributes.filter((d) => d.deprecatedAt === null);
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);

    const narrowed = {
      ...asking,
      where: query.filters,
      ...(query.search.trim() === '' ? {} : { search: query.search }),
    };
    const listed = await deps.service.access.list(tx, {
      ...narrowed,
      after: query.after ?? null,
      limit: DIRECTORY_PAGE,
    });
    if (!listed.ok) return listed;
    const counted = await deps.service.access.count(tx, narrowed);
    if (!counted.ok) return counted;
    const page = listed.value.items;

    const columns = definitions.filter(
      (d) => d.includeInDirectory && !COLUMN_SKIP.has(d.key) && visibleTo(d, everyone),
    );
    const selects = definitions.filter(
      (d) => d.typeConfig.kind === 'select' && filterable(definitions, [d.key], everyone).ok,
    );

    // A person column (a manager) names somebody who may be on another page:
    // each one this page mentions is read, as this viewer may read them.
    const names = new Map(pickable(page).map((p) => [p.value, p.label]));
    const refs = new Set(
      columns
        .filter((c) => c.typeConfig.kind === 'person_ref')
        .flatMap((c) => page.map((p) => p.attributes[c.key]))
        .filter((v): v is string => typeof v === 'string' && !names.has(v)),
    );
    for (const personId of refs) {
      const read = await deps.service.access.read(tx, { ...asking, personId });
      const name = read.ok ? nameOf(read.value.attributes) : null;
      if (name !== null) names.set(personId, name);
    }

    return ok({
      active: counted.value.active,
      incomplete: null,
      columns: columns.map((c) => ({ key: c.key, label: c.label.default })),
      filterable: selects.map((d) => ({
        key: d.key,
        label: d.label.default,
        options:
          d.typeConfig.kind === 'select'
            ? d.typeConfig.options
                .filter((o) => o.retiredAt === null)
                .map((o) => ({ value: o.value, label: o.label.default }))
            : [],
      })),
      people: page.map((p) => {
        const email = p.attributes['work_email'];
        return {
          id: p.id,
          name: nameOf(p.attributes) ?? (typeof email === 'string' ? email : 'Unnamed'),
          email: typeof email === 'string' ? email : null,
          avatarUrl: null,
          values: Object.fromEntries(
            columns.flatMap((c) => {
              const value = p.attributes[c.key];
              if (value === undefined || value === null) return [];
              const shown =
                c.typeConfig.kind === 'person_ref'
                  ? typeof value === 'string'
                    ? names.get(value)
                    : undefined
                  : toForm(value);
              return typeof shown === 'string' ? [[c.key, shown]] : [];
            }),
          ),
          missing: null,
        };
      }),
      next: listed.value.next,
      // An export is a read, so everybody may build one of what they can see.
      can: { import: everyone.isHr, export: true },
    });
  });
}

/* -------------------------------------------------------- completeness -- */

export interface CompletenessView {
  readonly since: string;
  readonly waiting: { readonly people: number; readonly lastReminded: string | null };
  readonly completedThisWeek: number;
  /** HR's missing values over everybody, not only this page. */
  readonly toFill: number;
  readonly fields: readonly {
    readonly key: string;
    readonly label: string;
    readonly options: readonly { readonly value: string; readonly label: string }[];
    /** A person reference: picked by searching people (`pickerView`), not from `options`. */
    readonly person: boolean;
  }[];
  readonly rows: readonly {
    readonly personId: string;
    readonly name: string;
    readonly department: string | null;
    readonly manager: string | null;
    readonly missing: readonly string[];
  }[];
  /** The cursor for the page after this one; null on the last page. */
  readonly next: string | null;
}

/** A grid page: the directory's size, so it costs what a directory page does. */
export const GRID_PAGE = DIRECTORY_PAGE;

/**
 * HR's grid over exactly the missing cells HR owns (§8.4). Employee-owned
 * gaps are counted, not shown: they are the employee's task and reminder.
 *
 * Paged by keyset over the people with a gap HR fills (PEO-122, PEO-124),
 * through `PersonAccess.list`, so page 1,000 costs what page 1 does; the
 * totals and the field list are over everybody, from the gap rows.
 */
export async function completenessView(
  deps: ScreenDeps,
  asking: Asking,
  query: { readonly after?: string | null } = {},
): Promise<Result<CompletenessView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    if (!everyone.isHr) return err(failure('FORBIDDEN', 'The completeness grid is HR’s'));
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const byKey = new Map(version.document.attributes.map((d) => [d.key as string, d]));
    const hrs = (key: string) => byKey.get(key)?.ownership.includes('hr') === true;
    // Selected by the keys the grid shows, HR's, so a page is never short of
    // people whose only gap is Finance's.
    const listed = await deps.service.access.list(tx, {
      ...asking,
      gaps: [...byKey.keys()].filter(hrs),
      after: query.after ?? null,
      limit: GRID_PAGE,
    });
    if (!listed.ok) return listed;
    const page = listed.value.items;
    const totals = await deps.gapTotals(tx, asking.tenantId);
    const managers = page
      .map((p) => p.attributes['manager_id'])
      .filter((m): m is string => typeof m === 'string');
    const names = new Map(
      [...pickable(page), ...(await named(deps, tx, asking, managers))].map((p) => [
        p.value,
        p.label,
      ]),
    );

    const rows: CompletenessView['rows'][number][] = [];
    for (const person of page) {
      const verdict = await deps.service.access.completeness(tx, {
        ...asking,
        personId: person.id,
      });
      if (!verdict.ok) continue;
      const missing = verdict.value.missing.filter((m) => m.owners.includes('hr'));
      if (missing.length === 0) continue;
      const manager = person.attributes['manager_id'];
      rows.push({
        personId: person.id,
        name: names.get(person.id) ?? 'Unnamed',
        department:
          typeof person.attributes['department'] === 'string'
            ? person.attributes['department']
            : null,
        manager: typeof manager === 'string' ? (names.get(manager) ?? null) : null,
        missing: missing.map((m) => m.key),
      });
    }
    const staff = totals.staff.filter((s) => hrs(s.key));
    return ok({
      since: `Since version ${String(version.version)} was published on ${version.publishedAt.slice(0, 10)}`,
      // ponytail: reminders are not sent yet (PEO-084), so nobody has been reminded.
      waiting: { people: totals.waiting, lastReminded: null },
      completedThisWeek: 0,
      toFill: staff.reduce((n, s) => n + s.people, 0),
      fields: staff.flatMap(({ key }) => {
        const d = byKey.get(key);
        if (d === undefined) return [];
        return [
          {
            key,
            label: d.label.default,
            options:
              d.typeConfig.kind === 'select'
                ? d.typeConfig.options
                    .filter((o) => o.retiredAt === null)
                    .map((o) => ({ value: o.value, label: o.label.default }))
                : [],
            person: d.typeConfig.kind === 'person_ref',
          },
        ];
      }),
      rows,
      next: listed.value.next,
    });
  });
}

/** The grid's bulk save: one write, and so one event, per person. */
export async function saveGrid(
  deps: ScreenDeps,
  asking: Asking,
  changes: readonly {
    readonly personId: string;
    readonly values: Readonly<Record<string, string>>;
  }[],
): Promise<Result<void>> {
  for (const change of changes) {
    const saved = await saveSection(deps, asking, change.personId, change.values);
    if (!saved.ok) return saved;
  }
  return ok(undefined);
}
