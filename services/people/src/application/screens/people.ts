import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';
import { requiresApproval, type Actor, type AttributeDefinition } from '@kithena/contracts';

import type { EmploymentPeriodRow } from '../../domain/person/person.js';

import { visibleTo } from '../../domain/access/field-access.js';
import { filterable, type Asking, type PersonView } from '../person/person-access.js';
import { run } from '../person/service.js';
import { LEAVERS } from '../person/ports.js';
import { segmentFor, segmentsFor } from './segments.js';
import type {
  FormValue,
  FormValues,
  IdentifierFindingView,
  IdentifierReviewEntry,
  PendingFieldView,
  RecordSection,
} from './model.js';
import { approvalsInbox, pendingFor } from '../person/pending-changes.js';
import {
  formValues,
  nameOf,
  NOBODY,
  personOfViewer,
  recordSections,
  checkSection,
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
  /** Their doubted identifiers still open: with HR, or sent back to them (PEO-125). */
  readonly reviews: readonly IdentifierReviewEntry[];
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
    const { view, sections, version, reviews } = record.value;
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
      reviews,
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
  // The person's doubted identifiers still open, on fields this viewer reads (PEO-125).
  const open = await deps.service.access.personReviews(tx, { ...asking, personId });
  const labels = new Map(
    version.document.attributes.map((d) => [d.key as string, d.label.default]),
  );
  const reviews: IdentifierReviewEntry[] = (open.ok ? open.value : []).flatMap((r) =>
    r.state === 'pending' || r.state === 'sent_back'
      ? [
          {
            key: r.attributeKey,
            label: labels.get(r.attributeKey) ?? r.attributeKey,
            state: r.state,
            findings: r.findings.filter((f) => f.level !== 'ok'),
            note: r.state === 'sent_back' ? r.note : null,
          },
        ]
      : [],
  );
  return ok({
    view: view.value,
    sections,
    version,
    missing: verdict.ok ? missing.size : null,
    reviews,
  });
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
  /** Their doubted identifiers still open, on fields this viewer reads (PEO-125). */
  readonly reviews: readonly IdentifierReviewEntry[];
  /**
   * Changes to them waiting for HR's approval (PEO-077), on fields this viewer
   * reads. Never in `values`: those are what is in force.
   */
  readonly pending: readonly PendingFieldView[];
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
    // HR reads the status, so `status` is here whenever `isHr` is (§6.3).
    const status = view.status ?? null;
    const placeable =
      relations.isHr &&
      status !== null &&
      !(LEAVERS as readonly string[]).includes(status) &&
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
        return PLACED.has(f.key) && placeable
          ? { ...f, options, readOnly: true }
          : { ...f, options };
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
      employment: periods?.ok && status !== null ? { status, periods: periods.value } : null,
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
      reviews: record.value.reviews,
      pending: await pendingOnRecord(deps, tx, asking, id.value),
    });
  });
}

/** A person's changes waiting for HR, as this viewer may see them (PEO-077). */
async function pendingOnRecord(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  personId: string,
): Promise<PendingFieldView[]> {
  const pending = deps.service.pending;
  if (!pending) return [];
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  const labels = new Map(
    (version?.document.attributes ?? []).map((d) => [d.key as string, d.label.default]),
  );
  const found = await pendingFor(tx, pending, { ...asking, personId });
  if (!found.ok) return [];
  const by = await actors(
    deps,
    tx,
    asking,
    found.value.map((c) => ({ kind: 'user' as const, userId: c.requestedBy })),
  );
  return found.value.map((c) => ({
    id: c.id,
    key: c.attributeKey,
    label: labels.get(c.attributeKey) ?? c.attributeKey,
    kind: c.kind,
    value: toForm(c.value),
    effectiveFrom: c.effectiveFrom,
    requestedAt: c.requestedAt,
    expiresAt: c.expiresAt,
    requestedBy: by({ kind: 'user', userId: c.requestedBy }),
    reason: c.reason,
    mine: c.mine,
    canDecide: c.canDecide,
  }));
}

/* ------------------------------------------------------------ approvals -- */

/** One change in the approvals inbox (PEO-077). */
export interface ApprovalItem extends PendingFieldView {
  readonly personId: string;
  /** The person, as the viewer may name them. */
  readonly name: string;
  /** Null where the viewer may not read the field: they decide on who, when and why. */
  readonly value: FormValue;
  readonly readable: boolean;
  /** What is in force now, masked the same way; null when unreadable or empty. */
  readonly current: FormValue;
}

export interface ApprovalsView {
  /** HR sees every change waiting in the tenant; anybody else, their own. */
  readonly isHr: boolean;
  readonly items: readonly ApprovalItem[];
}

/**
 * The approvals inbox (PEO-077): oldest first, each with who it is about, the
 * field, the value asked for and the value in force, who asked and when it
 * lapses. HR decides here; a requester withdraws here.
 */
export async function approvalsView(
  deps: ScreenDeps,
  asking: Asking,
): Promise<Result<ApprovalsView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const pending = deps.service.pending;
    if (!pending) return ok({ isHr: false, items: [] });
    const inbox = await approvalsInbox(tx, pending, asking);
    if (!inbox.ok) return inbox;
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    const labels = new Map(
      (version?.document.attributes ?? []).map((d) => [d.key as string, d.label.default]),
    );
    const by = await actors(
      deps,
      tx,
      asking,
      inbox.value.items.map((c) => ({ kind: 'user' as const, userId: c.requestedBy })),
    );
    const items: ApprovalItem[] = [];
    for (const c of inbox.value.items) {
      const person = await deps.service.access.read(tx, { ...asking, personId: c.personId });
      const attributes = person.ok ? person.value.attributes : {};
      items.push({
        id: c.id,
        personId: c.personId,
        name: nameOf(attributes) ?? 'Unnamed',
        key: c.attributeKey,
        label: labels.get(c.attributeKey) ?? c.attributeKey,
        kind: c.kind,
        value: c.readable ? toForm(c.value) : null,
        readable: c.readable,
        current: c.readable ? toForm(attributes[c.attributeKey]) : null,
        effectiveFrom: c.effectiveFrom,
        requestedAt: c.requestedAt,
        expiresAt: c.expiresAt,
        requestedBy: by({ kind: 'user', userId: c.requestedBy }),
        reason: c.reason,
        mine: c.mine,
        canDecide: c.canDecide,
      });
    }
    return ok({ isHr: inbox.value.isHr, items });
  });
}

export { checkSection, saveSection };

/* ------------------------------------------------------------ history -- */

/** One recorded change, as the history screen draws it (PEO-064). */
export interface HistoryChange {
  readonly id: string;
  readonly key: string;
  /** A sealed field's change reads `{ last4: null }`: that it changed, never what to. */
  readonly value: FormValue;
  /** When it takes effect in the domain. */
  readonly effectiveFrom: string;
  /** When we recorded it. */
  readonly recordedAt: string;
  /** Who recorded it, in words: "You", a name the viewer may read, an integration. */
  readonly by: string;
  /** The change this one corrects. */
  readonly supersedes: string | null;
  /** The correction that replaced this one; it no longer stands. */
  readonly supersededBy: string | null;
}

export interface HistoryView {
  readonly person: { readonly id: string; readonly name: string };
  /** The date the values are read as of; null is today, on the person's own calendar. */
  readonly asOf: string | null;
  readonly sections: readonly RecordSection[];
  /**
   * Keys with an "as of" (§8.5). A field kept without dates — a phone number —
   * has its changes and no value on a past date, so with `asOf` set it is not
   * in `values`.
   */
  readonly dated: readonly string[];
  readonly values: FormValues;
  /** Every change to a field in `sections`, newest in effect first. */
  readonly changes: readonly HistoryChange[];
}

/**
 * One person's record as it stood on a date, and every change behind it
 * (PEO-064, §8.5): "what did this look like in March".
 *
 * Both halves read through `PersonAccess` — `read` with `asOf`, and
 * `history`, which drops a field the viewer cannot read now and a sealed
 * field's values (`readableHistory`) — so the screen cannot show a past value
 * of anything the profile would not show today.
 */
export async function historyView(
  deps: ScreenDeps,
  asking: Asking,
  personId: string | null,
  asOf: string | null,
): Promise<Result<HistoryView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const id = personId === null ? await personOfViewer(deps, tx, asking) : ok(personId);
    if (!id.ok) return id;
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const view = await deps.service.access.read(tx, {
      ...asking,
      personId: id.value,
      ...(asOf === null ? {} : { asOf }),
    });
    if (!view.ok) return view;
    const history = await deps.service.access.history(tx, { ...asking, personId: id.value });
    if (!history.ok) return history;
    // The name as it is now, whatever date the record is read as of.
    const now =
      asOf === null ? view : await deps.service.access.read(tx, { ...asking, personId: id.value });

    const definitions = version.document.attributes;
    const byKey = new Map(definitions.map((d) => [d.key as string, d]));
    const people = await named(deps, tx, asking, [
      ...referenced(definitions, view.value.attributes),
      ...history.value.flatMap((e) =>
        byKey.get(e.attributeKey)?.typeConfig.kind === 'person_ref' && typeof e.value === 'string'
          ? [e.value]
          : [],
      ),
    ]);
    const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, id.value);
    // Entities and locations by name, archived ones too: history names them.
    const org = await deps.calendars.load(tx, asking.tenantId);
    const places: Record<string, { value: string; label: string }[]> = {
      legal_entity_id: [...org.entities.values()].map((e) => ({ value: e.id, label: e.name })),
      location_id: [...org.locations.values()].map((l) => ({ value: l.id, label: l.name })),
    };
    const sections = recordSections(version, relations, () => true, new Set(), people).map((s) => ({
      ...s,
      fields: s.fields.map((f) => ({ ...f, options: places[f.key] ?? f.options, readOnly: true })),
    }));
    const shown = new Set(sections.flatMap((s) => s.fields.map((f) => f.key)));
    const dated = definitions
      .filter((d) => d.effectiveDated && shown.has(d.key))
      .map((d) => d.key as string);
    const undated = new Set([...shown].filter((k) => !dated.includes(k)));

    const values = formValues(view.value, sections);
    const supersededBy = new Map(
      history.value.flatMap((e) => (e.supersedes === null ? [] : [[e.supersedes, e.id] as const])),
    );
    const by = await actors(
      deps,
      tx,
      asking,
      history.value.map((e) => e.actor),
    );
    const changes = history.value
      .filter((e) => shown.has(e.attributeKey))
      .toSorted(
        (a, b) =>
          b.effectiveFrom.localeCompare(a.effectiveFrom) ||
          b.recordedAt.localeCompare(a.recordedAt),
      )
      .map((e) => ({
        id: e.id,
        key: e.attributeKey,
        value: byKey.get(e.attributeKey)?.encrypted === true ? { last4: null } : toForm(e.value),
        effectiveFrom: e.effectiveFrom,
        recordedAt: e.recordedAt,
        by: by(e.actor),
        supersedes: e.supersedes,
        supersededBy: supersededBy.get(e.id) ?? null,
      }));

    return ok({
      person: { id: id.value, name: (now.ok ? nameOf(now.value.attributes) : null) ?? 'Unnamed' },
      asOf,
      sections,
      dated,
      values:
        asOf === null
          ? values
          : Object.fromEntries(Object.entries(values).filter(([k]) => !undated.has(k))),
      changes,
    });
  });
}

/**
 * Who made each change, in words the viewer may read. A person is named only
 * if this viewer can read their name; otherwise "A colleague".
 */
async function actors(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  all: readonly Actor[],
): Promise<(actor: Actor) => string> {
  const names = new Map<string, string>();
  for (const actor of all) {
    if (actor.kind !== 'user' || names.has(actor.userId)) continue;
    if (actor.userId === asking.viewer.accountId) {
      names.set(actor.userId, 'You');
      continue;
    }
    const personId = await deps.personOf(tx, asking.tenantId, actor.userId);
    const read =
      personId === null ? null : await deps.service.access.read(tx, { ...asking, personId });
    names.set(
      actor.userId,
      (read?.ok === true ? nameOf(read.value.attributes) : null) ?? 'A colleague',
    );
  }
  return (actor) =>
    actor.kind === 'user'
      ? (names.get(actor.userId) ?? 'A colleague')
      : actor.kind === 'integration'
        ? `An integration (${actor.provider})`
        : 'Automatically';
}

/* ------------------------------------------------- identifier reviews -- */

/** One doubted identifier in HR's queue. The value is never here: `last4`, or the audited reveal. */
export interface IdentifierReviewItem {
  readonly personId: string;
  readonly name: string;
  readonly attributeKey: string;
  readonly label: string;
  readonly last4: string | null;
  readonly findings: readonly {
    readonly level: string;
    readonly code: string;
    readonly message: string;
  }[];
  readonly enteredAt: string;
}

export interface IdentifierReviewsView {
  readonly items: readonly IdentifierReviewItem[];
}

/**
 * HR's queue of doubted national identifiers (PEO-125; PRD §8.4), oldest
 * first, each named as HR may read the person. HR's alone; the decision and
 * the reveal are their own, audited, calls.
 */
export async function identifierReviewsView(
  deps: ScreenDeps,
  asking: Asking,
): Promise<Result<IdentifierReviewsView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const queue = await deps.service.access.identifierReviews(tx, asking);
    if (!queue.ok) return queue;
    const items: IdentifierReviewItem[] = [];
    for (const r of queue.value) {
      const person = await deps.service.access.read(tx, { ...asking, personId: r.personId });
      items.push({
        personId: r.personId,
        name: (person.ok ? nameOf(person.value.attributes) : null) ?? 'Unnamed',
        attributeKey: r.attributeKey,
        label: r.label,
        last4: r.last4,
        findings: r.findings.filter((f) => f.level !== 'ok'),
        enteredAt: r.createdAt,
      });
    }
    return ok({ items });
  });
}

/* ---------------------------------------------------------- duplicates -- */

/** One side of a comparison: who, and whether they may absorb the other. */
export interface ComparedPerson {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  /** Why this record may not absorb the other; null when it may. */
  readonly refusal: string | null;
}

/** One attribute, side by side, as this viewer may read it. Never a value they may not. */
export interface ComparedRow {
  readonly key: string;
  readonly label: string;
  readonly values: readonly [string | null, string | null];
  /** Equal, or both sealed and holding the same keyed hash. */
  readonly same: boolean;
  /** Whether each side's value could be copied onto the other if the other survived. */
  readonly takeable: readonly [boolean, boolean];
}

export interface DuplicatesView {
  readonly items: readonly {
    readonly personIds: readonly [string, string];
    readonly names: readonly [string, string];
    readonly reasons: readonly string[];
  }[];
  /** The pair asked about, side by side; null when none was. */
  readonly comparison: {
    readonly people: readonly [ComparedPerson, ComparedPerson];
    readonly rows: readonly ComparedRow[];
  } | null;
}

const SIGNAL_WORDS = {
  work_email: 'Same work email',
  name_and_birth_date: 'Same name and date of birth',
} as const;

/** A value as the comparison shows it: text, or a sealed value's last four. */
function shown(
  value: unknown,
  options: readonly { value: string; label: string }[],
): string | null {
  const form = toForm(value);
  if (form === null || form === '') return null;
  if (typeof form === 'string') return options.find((o) => o.value === form)?.label ?? form;
  if (typeof form === 'boolean') return form ? 'Yes' : 'No';
  if (Array.isArray(form)) return (form as readonly string[]).join(', ');
  if ('last4' in form) return form.last4 === null ? '••••' : `•••• ${form.last4}`;
  if (!('amountMinor' in form)) return null;
  return `${form.amountMinor} ${form.currency}`;
}

/**
 * HR's duplicate review (PEO-074; PRD §12.4): the queue, and one pair side
 * by side when asked. Every value is read through `PersonAccess.read`, so
 * what HR may not read is absent here too; what may be copied, and which way
 * a merge may go, are `mergeOptions`', the same rules `merge` applies.
 */
export async function duplicatesView(
  deps: ScreenDeps,
  asking: Asking,
  pair: readonly [string, string] | null,
): Promise<Result<DuplicatesView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const access = deps.service.access;
    const queue = await access.duplicates(tx, asking);
    if (!queue.ok) return queue;
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const labelOf = (key: string) =>
      version.document.attributes.find((d) => d.key === key)?.label.default ?? key;
    const nameFor = async (personId: string) => {
      const read = await access.read(tx, { ...asking, personId });
      return (read.ok ? nameOf(read.value.attributes) : null) ?? 'Unnamed';
    };

    const items: DuplicatesView['items'][number][] = [];
    for (const c of queue.value) {
      items.push({
        personIds: c.personIds,
        names: [await nameFor(c.personIds[0]), await nameFor(c.personIds[1])],
        reasons: c.signals.map((s) =>
          s.signal === 'unique_value'
            ? `Same ${labelOf(s.attributeKey ?? '')}`
            : SIGNAL_WORDS[s.signal],
        ),
      });
    }
    if (pair === null) return ok<DuplicatesView>({ items, comparison: null });

    const [a, b] = pair;
    const readA = await access.read(tx, { ...asking, personId: a });
    if (!readA.ok) return readA;
    const readB = await access.read(tx, { ...asking, personId: b });
    if (!readB.ok) return readB;
    // Each side as the survivor: which way a merge may go, and what it could take.
    const intoA = await access.mergeOptions(tx, { ...asking, personId: a, absorbedPersonId: b });
    if (!intoA.ok) return intoA;
    const intoB = await access.mergeOptions(tx, { ...asking, personId: b, absorbedPersonId: a });
    if (!intoB.ok) return intoB;

    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    const sections = recordSections(version, everyone, () => true, new Set());
    const sealedSame = new Set(intoA.value.sameSealed);
    const rows: ComparedRow[] = sections.flatMap((s) =>
      s.fields.flatMap((f) => {
        const values = [
          shown(readA.value.attributes[f.key], f.options),
          shown(readB.value.attributes[f.key], f.options),
        ] as const;
        if (values[0] === null && values[1] === null) return [];
        const same = sealedSame.has(f.key) || (values[0] !== null && values[0] === values[1]);
        return [
          {
            key: f.key,
            label: f.label,
            values,
            same,
            takeable: [
              !same &&
                values[0] !== null &&
                intoB.value.refusal === null &&
                intoB.value.takeable.includes(f.key),
              !same &&
                values[1] !== null &&
                intoA.value.refusal === null &&
                intoA.value.takeable.includes(f.key),
            ] as const,
          },
        ];
      }),
    );
    const person = (view: PersonView, refusal: DomainFailure | null): ComparedPerson => ({
      id: view.id,
      name: nameOf(view.attributes) ?? 'Unnamed',
      // The queue is HR's alone (`duplicates`), and HR reads every status.
      status: view.status ?? '',
      refusal: refusal?.message ?? null,
    });
    return ok({
      items,
      comparison: {
        people: [
          person(readA.value, intoA.value.refusal),
          person(readB.value, intoB.value.refusal),
        ],
        rows,
      },
    });
  });
}

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
  /** Which of the screen's actions this viewer gets (§13.1, §8.4). */
  readonly can: { readonly import: boolean; readonly export: boolean; readonly bulkEdit: boolean };
  /** The saved segment applied (PEO-068), and those this viewer could apply here. */
  readonly segment: { readonly id: string; readonly name: string } | null;
  readonly segments: readonly { readonly id: string; readonly name: string }[];
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
    /** A saved segment's filter, under any typed alongside it (PEO-068). */
    readonly segmentId?: string;
  },
): Promise<Result<DirectoryView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const definitions = version.document.attributes.filter((d) => d.deprecatedAt === null);
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);

    // The segment's filter is authorized below exactly as a typed one is:
    // `list` refuses a key this viewer cannot filter by, over their people.
    const segment =
      query.segmentId === undefined ? null : await segmentFor(deps, tx, asking, query.segmentId);
    if (segment !== null && !segment.ok) return segment;
    const narrowed = {
      ...asking,
      where: { ...segment?.value.filter, ...query.filters },
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
      can: { import: everyone.isHr, export: true, bulkEdit: everyone.isHr },
      segment: segment === null ? null : { id: segment.value.id, name: segment.value.name },
      segments: (await segmentsFor(deps, tx, asking))
        .filter((s) => s.usableIn.directory)
        .map((s) => ({ id: s.id, name: s.name })),
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
    /** A change to it waits for HR's approval (PEO-077). */
    readonly sensitive: boolean;
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
            sensitive: requiresApproval(d),
          },
        ];
      }),
      rows,
      next: listed.value.next,
    });
  });
}

/** The grid's bulk save: one write, and so one event, per person. */
/** A grid cell's warning: which person, and what the checks found there (PEO-125). */
export type GridFinding = IdentifierFindingView & { readonly personId: string };

type GridChanges = readonly {
  readonly personId: string;
  readonly values: Readonly<Record<string, string>>;
}[];

/**
 * The grid's bulk save: one section save per person, so every value goes
 * through the same write path as a form — a doubted national identifier is
 * saved, queued for HR and answered with its findings per cell (PEO-125).
 */
export async function saveGrid(
  deps: ScreenDeps,
  asking: Asking,
  changes: GridChanges,
): Promise<
  Result<{ readonly ok: true; readonly findings: readonly GridFinding[]; readonly held?: number }>
> {
  const findings: GridFinding[] = [];
  let held = 0;
  for (const change of changes) {
    const saved = await saveSection(deps, asking, change.personId, change.values);
    if (!saved.ok) return saved;
    findings.push(...saved.value.findings.map((f) => ({ ...f, personId: change.personId })));
    held += saved.value.held?.length ?? 0;
  }
  // Only when something was held, so a retry answers as the first did otherwise.
  return ok({ ok: true as const, findings, ...(held === 0 ? {} : { held }) });
}

/**
 * What saving these cells would be warned about, saving nothing: the grid
 * asks before it saves, as a form does, and a retried save is answered from
 * it — the one function either way.
 */
export async function checkGrid(
  deps: ScreenDeps,
  asking: Asking,
  changes: GridChanges,
): Promise<Result<{ readonly findings: readonly GridFinding[] }>> {
  const findings: GridFinding[] = [];
  for (const change of changes) {
    const found = await checkSection(deps, asking, change.personId, change.values);
    if (!found.ok) return found;
    findings.push(...found.value.findings.map((f) => ({ ...f, personId: change.personId })));
  }
  return ok({ findings });
}
