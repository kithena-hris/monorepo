import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';
import { requiresApproval, type Actor, type AttributeDefinition } from '@kithena/contracts';

import type { EmploymentPeriodRow } from '../../domain/person/person.js';

import { visibleTo, type ViewerRelations } from '../../domain/access/field-access.js';
import {
  filterable,
  REPORTS_TO,
  usableMetrics,
  type Asking,
  type PersonView,
} from '../person/person-access.js';
import { mayChangePhoto } from '../../domain/person/photo.js';
import { matchBand, type MatchBand } from '../../domain/person/merge.js';
import { askable } from '../../domain/person/detail-request.js';
import { blocksPayroll, gapsByOwner } from '../../domain/person/completeness.js';
import type { FileInfoView } from './files.js';
import { avatarsOf } from './photo.js';
import { run } from '../person/service.js';
import { LEAVERS, type Condition } from '../person/ports.js';
import { isCoreKey } from '../person/core.js';
import { segmentFor, segmentsFor } from './segments.js';
import { suggestions as suggestionsFor } from '../../domain/assistant/clarify.js';
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
  CHECKS,
  rowSummary,
  type CheckCode,
  type Comparison,
  type Reason,
} from '../../domain/approval/unusual.js';
import { outcomeAt, ownOutcomeAt } from '../../domain/approval/approval.js';
import { recordedBefore } from '../../domain/person/history.js';
import { reviewOutcome } from '../../domain/person/identifier-review.js';
import { placedZone, placementOf } from '../../domain/org/calendar.js';
import { unitPaths } from '../../domain/org/org-unit.js';
import {
  checksOf,
  flagChange,
  looking,
  type CheckView,
  type FlagStats,
} from '../person/approval-flags.js';
import { offersViewAs } from '../person/view-as.js';
import {
  choicesOf,
  formValues,
  hrFills,
  isOrgRef,
  hrToFill,
  listOptions,
  nameOf,
  orgChoices,
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
  const wanted = [...new Set(ids)];
  const read = await deps.service.access.readMany(tx, { ...asking, personIds: wanted });
  // In the order the record names them.
  return read.ok ? pickable(wanted.flatMap((id) => read.value.get(id) ?? [])) : [];
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

/**
 * How many people this viewer could find by searching (MV1's "Search 412
 * people"): the directory's own count, so HR's includes leavers and nobody
 * else's does. A count, and nothing about anybody.
 */
export async function peopleHeadcount(
  deps: ScreenDeps,
  asking: Asking,
): Promise<Result<{ readonly count: number }>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const counted = await deps.service.access.count(tx, asking);
    return counted.ok ? ok({ count: counted.value.all }) : counted;
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

/** A record as its screens draw it: the read, its sections, and what is missing of it. */
export interface OwnRecord {
  readonly view: PersonView;
  readonly sections: RecordSection[];
  readonly version: NonNullable<Awaited<ReturnType<ScreenDeps['service']['schemas']['current']>>>;
  /** How many required values are missing; null when this viewer is not shown it. */
  readonly missing: number | null;
  readonly reviews: IdentifierReviewEntry[];
}

export async function ownRecord(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  personId: string,
  include: (d: AttributeDefinition) => boolean,
): Promise<Result<OwnRecord>> {
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
  const org = await orgChoices(deps, tx, asking.tenantId);
  const sections = recordSections(version, relations, include, missing, people, org);
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
    /** The viewer may choose their photo: it is theirs, or they are HR. */
    readonly canChangePhoto: boolean;
    /** The viewer, a People administrator, may view the app as them (`offersViewAs`). */
    readonly canViewAs: boolean;
  };
  readonly sections: readonly (RecordSection & { readonly readsLogged: boolean })[];
  readonly values: FormValues;
  /**
   * Whose day it is for them, and what day: HR's alone, absent for anybody
   * else (PEO-119). `now` is when People answered, the one instant their
   * local time is read from, on the server and in the browser alike.
   */
  readonly calendar: {
    readonly today: string;
    readonly timeZone: string;
    readonly now: string;
  } | null;
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
  /**
   * Fields somebody asked this person to fill in that are still empty, and
   * who asked: shown to the person as what they were asked for, and to
   * whoever may ask as already asked.
   */
  readonly requests: readonly {
    readonly key: string;
    readonly label: string;
    readonly requestedAt: string;
    readonly by: string;
  }[];
  /** What each image or document value is: its name and type, to draw it. */
  readonly files: readonly FileInfoView[];
  /** Who they report to, up to the top, and who else shares their manager. */
  readonly reportingLine: ReportingLineView;
}

/** One person on a reporting line, as the viewer may read them. */
export interface LinePerson {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  readonly avatarUrl: string | null;
}

export interface ReportingLineView {
  /** From the top of the chain down to their manager; empty for somebody at the top. */
  readonly chain: readonly LinePerson[];
  /** Everybody else reporting to their manager, as far as the viewer may list them. */
  readonly peers: readonly LinePerson[];
  /** More peers than are listed. */
  readonly morePeers: boolean;
}

/** The furthest a chain is walked: deeper than any organisation, short of a loop. */
const MOST_LEVELS = 15;
const MOST_PEERS = 24;

/**
 * Their reporting line: each manager above them, read as the viewer reads a
 * profile, stopping at the first the viewer may not read (a chain says no
 * more than its readers may know) and at a loop, however the data came to
 * hold one; then their peers, listed as the directory lists them.
 */
async function reportingLineOf(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  person: PersonView,
): Promise<ReportingLineView> {
  const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const line = (p: PersonView): Omit<LinePerson, 'avatarUrl'> => ({
    id: p.id,
    name: nameOf(p.attributes) ?? 'Unnamed',
    title: text(p.attributes['job_title']),
  });
  const up: Omit<LinePerson, 'avatarUrl'>[] = [];
  const seen = new Set<string>([person.id]);
  let next = text(person.attributes[REPORTS_TO]);
  const manager = next;
  while (next !== null && !seen.has(next) && up.length < MOST_LEVELS) {
    seen.add(next);
    const read = await deps.service.access.read(tx, { ...asking, personId: next });
    if (!read.ok) break;
    up.push(line(read.value));
    next = text(read.value.attributes[REPORTS_TO]);
  }
  let peers: Omit<LinePerson, 'avatarUrl'>[] = [];
  let morePeers = false;
  if (manager !== null) {
    const listed = await deps.service.access.list(tx, {
      ...asking,
      where: { [REPORTS_TO]: manager },
      limit: MOST_PEERS + 1,
    });
    if (listed.ok) {
      const others = listed.value.items.filter((p) => p.id !== person.id);
      morePeers = others.length > MOST_PEERS || listed.value.next !== null;
      peers = others.slice(0, MOST_PEERS).map(line);
    }
  }
  const avatars = await avatarsOf(
    deps,
    tx,
    asking.tenantId,
    [...up, ...peers].map((p) => p.id),
  );
  const withAvatar = (p: Omit<LinePerson, 'avatarUrl'>): LinePerson => ({
    ...p,
    avatarUrl: avatars.get(p.id) ?? null,
  });
  return { chain: up.toReversed().map(withAvatar), peers: peers.map(withAvatar), morePeers };
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
    const avatars = await avatarsOf(deps, tx, asking.tenantId, [id.value]);

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
    const definitions = new Map(
      record.value.version.document.attributes.map((d) => [d.key as string, d]),
    );
    const named = sections.map((s) => ({
      ...s,
      fields: s.fields.map((f) => {
        const options =
          f.key === 'legal_entity_id'
            ? entities
            : f.key === 'location_id'
              ? locations.map(({ value, label }) => ({ value, label }))
              : f.options;
        const definition = definitions.get(f.key);
        const asked = definition !== undefined && askable(definition, relations);
        // Moved through the placement control, where the date and the transfer are.
        return PLACED.has(f.key) && placeable
          ? { ...f, options, readOnly: true, askable: asked }
          : { ...f, options, askable: asked };
      }),
    }));

    return ok({
      person: {
        name: nameOf(view.attributes) ?? 'Unnamed',
        summary: typeof title === 'string' ? title : null,
        avatarUrl: avatars.get(id.value) ?? null,
        missing: record.value.missing,
        canChangePhoto: deps.photos !== undefined && mayChangePhoto(relations),
        canViewAs:
          deps.viewAs !== undefined && (await offersViewAs(deps.viewAs, tx, asking, id.value)),
      },
      // Reading a sealed value in full is audited; this screen only ever shows the last four.
      calendar: calendar.ok ? { ...calendar.value, now: deps.clock.instant() } : null,
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
      requests: await openRequests(deps, tx, asking, id.value, named, formValues(view, named)),
      files: await filesOn(deps, tx, asking.tenantId, id.value, named, formValues(view, named)),
      reportingLine: await reportingLineOf(deps, tx, asking, view),
    });
  });
}

/**
 * The files a record's image and document values name, as a form draws them.
 * Only this person's: a value naming somebody else's file draws nothing.
 */
export async function filesOn(
  deps: ScreenDeps,
  tx: Tx,
  tenantId: string,
  personId: string,
  sections: readonly RecordSection[],
  values: FormValues,
): Promise<FileInfoView[]> {
  if (deps.files === undefined) return [];
  const ids = sections
    .flatMap((s) => s.fields)
    .filter((f) => f.dataType === 'image' || f.dataType === 'document_ref')
    .map((f) => values[f.key])
    .filter((v): v is string => typeof v === 'string' && v !== '');
  const found = await deps.files.describe(tx, tenantId, ids);
  return [...found.values()]
    .filter((f) => f.personId === personId)
    .map(({ id, name, mediaType, size }) => ({ id, name, mediaType, size }));
}

/** What somebody asked this person for that is still empty, on fields this viewer reads. */
async function openRequests(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  personId: string,
  sections: readonly RecordSection[],
  values: FormValues,
): Promise<ProfileView['requests']> {
  if (deps.requests === undefined) return [];
  const labels = new Map(sections.flatMap((s) => s.fields.map((f) => [f.key, f.label] as const)));
  const open = (await deps.requests.store.of(tx, asking.tenantId, personId)).filter(
    (r) => labels.has(r.key) && empty(values[r.key]),
  );
  const by = await actors(
    deps,
    tx,
    asking,
    open.map((r) => ({ kind: 'user' as const, userId: r.requestedBy })),
  );
  return open.map((r) => ({
    key: r.key,
    label: labels.get(r.key) ?? r.key,
    requestedAt: r.requestedAt,
    by: by({ kind: 'user', userId: r.requestedBy }),
  }));
}

const empty = (value: FormValue | undefined): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

/** A person's changes waiting for HR, as this viewer may see them (PEO-077). */
export async function pendingOnRecord(
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
    canSelfApprove: c.canSelfApprove,
    awaitingReview: c.awaitingReview,
    findings: c.findings,
  }));
}

/* ------------------------------------------------------------ approvals -- */

/** A question about a change and its answer (AI7: "Ask Nora"), as the viewer may name who asked. */
export interface ApprovalQuestion {
  readonly id: string;
  readonly question: string;
  readonly askedBy: string;
  readonly askedAt: string;
  readonly answer: string | null;
  readonly answeredAt: string | null;
  /** The viewer asked for the change and nobody answered yet. */
  readonly canAnswer: boolean;
}

/** One change in the approvals inbox (PEO-077), waiting or decided. */
export interface ApprovalItem extends PendingFieldView {
  readonly personId: string;
  /** The person, as the viewer may name them. */
  readonly name: string;
  /** Their photo, when they have one and the viewer may read them. */
  readonly avatarUrl: string | null;
  /** Null where the viewer may not read the field: they decide on who, when and why. */
  readonly value: FormValue;
  readonly readable: boolean;
  /** What is in force now, masked the same way; null when unreadable or empty. */
  readonly current: FormValue;
  /**
   * Why People's checks flag it (`domain/approval/unusual.ts`), with the
   * numbers compared and an honest note: only for whoever decides it.
   */
  readonly flags: readonly Pick<Reason, 'code' | 'title' | 'detail'>[];
  readonly comparisons: readonly Comparison[];
  readonly flagNote: string | null;
  /** The reasons in one line, for a row: "A 38% raise, above the band". */
  readonly flagSummary: string | null;
  /** Whoever may decide it may ask the requester first. */
  readonly canAsk: boolean;
  /** And may mark its flags not unusual. */
  readonly canMark: boolean;
  readonly questions: readonly ApprovalQuestion[];
  /**
   * Lapsed: nobody decided it within its seven days. Withdrawn: its requester
   * took it back, which only their own Decided says.
   */
  readonly state: 'pending' | 'approved' | 'rejected' | 'lapsed' | 'withdrawn';
  /** Who decided (nobody, for a lapsed one), when and with what note: a decided change only. */
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly note: string | null;
  /**
   * What the field held when it was asked for, masked as the field is: on the
   * requester's own Decided only, where it is read back from history.
   */
  readonly before?: FormValue;
}

export interface ApprovalsView {
  /** HR sees every change waiting in the tenant; anybody else, their own. */
  readonly isHr: boolean;
  readonly items: readonly ApprovalItem[];
  /** HR's: decided in the last 90 days, newest first, a page at a time. Empty for anybody else. */
  readonly decided: readonly ApprovalItem[];
  /** The place of the next page of `decided`, null on the last. */
  readonly decidedNext: string | null;
  /** What Kithena checks (AI8), for HR; null for anybody else. */
  readonly checks: readonly CheckView[] | null;
  /** A People administrator switches the checks. */
  readonly canTune: boolean;
  /** The last 90 days, for HR; null for anybody else or where nothing is kept. */
  readonly last90: FlagStats | null;
}

const NINETY_DAYS_MS = 90 * 86_400_000;
/** Decided, a keyset page at a time as the list scrolls. */
export const DECIDED_PAGE = 50;
/** A page's place: when the last one was decided (or lapsed), and its id. */
const DECIDED_CURSOR = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)~([0-9a-f-]{36})$/u;

const unflagged = {
  flags: [],
  comparisons: [],
  flagNote: null,
  flagSummary: null,
} as const;

/**
 * The approvals inbox (PEO-077): oldest first, each with who it is about, the
 * field, the value asked for and the value in force, who asked and when it
 * lapses. HR decides here, after reading what the checks flag (AI7); a
 * requester withdraws, or answers a question, here. HR also sees what was
 * decided lately and what Kithena checks (AI8).
 */
export async function approvalsView(
  deps: ScreenDeps,
  asking: Asking,
  /**
   * Decided's next page from this place (the last page's `decidedNext`): the
   * page alone, without the queue, which is the first page's.
   */
  decidedAfter: string | null = null,
): Promise<Result<ApprovalsView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const pending = deps.service.pending;
    if (!pending) {
      return ok({
        isHr: false,
        items: [],
        decided: [],
        decidedNext: null,
        checks: null,
        canTune: false,
        last90: null,
      });
    }
    const inbox = await approvalsInbox(tx, pending, asking);
    if (!inbox.ok) return inbox;
    const isHr = inbox.value.isHr;
    const queue = decidedAfter === null ? inbox.value.items : [];
    const now = deps.clock.instant();
    const since = new Date(Date.parse(now) - NINETY_DAYS_MS).toISOString();
    const place = decidedAfter === null ? null : DECIDED_CURSOR.exec(decidedAfter);
    const read = isHr
      ? await pending.store.decided(tx, asking.tenantId, {
          since,
          until: now,
          limit: DECIDED_PAGE + 1,
          ...(place === null ? {} : { before: { at: place[1] ?? '', id: place[2] ?? '' } }),
        })
      : [];
    const decided = read.slice(0, DECIDED_PAGE);
    const lastDecided = decided.at(-1);
    const decidedNext =
      read.length > DECIDED_PAGE && lastDecided !== undefined
        ? `${new Date(lastDecided.approval.decidedAt ?? lastDecided.approval.expiresAt).toISOString()}~${lastDecided.approval.id}`
        : null;
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    const definitions = version?.document.attributes ?? [];
    const labels = new Map(definitions.map((d) => [d.key as string, d.label.default]));
    const questions =
      pending.flags === undefined
        ? []
        : await pending.flags.store.questions(tx, asking.tenantId, [
            ...queue.map((c) => c.id),
            ...decided.map((c) => c.approval.id),
          ]);
    const by = await actors(deps, tx, asking, [
      ...queue.map((c) => ({ kind: 'user' as const, userId: c.requestedBy })),
      ...decided.flatMap((c) => [
        { kind: 'user' as const, userId: c.approval.requestedBy },
        ...(c.approval.decidedBy === null
          ? []
          : [{ kind: 'user' as const, userId: c.approval.decidedBy }]),
      ]),
      ...questions.map((q) => ({ kind: 'user' as const, userId: q.askedBy })),
    ]);
    const user = (userId: string) => by({ kind: 'user', userId });
    const asked = (changeId: string, mine: boolean): ApprovalQuestion[] =>
      questions
        .filter((q) => q.changeId === changeId)
        .map((q) => ({
          id: q.id,
          question: q.question,
          askedBy: user(q.askedBy),
          askedAt: q.askedAt,
          answer: q.answer,
          answeredAt: q.answeredAt,
          canAnswer: mine && q.answer === null,
        }));
    const look = await looking(tx, pending, asking);
    const avatars = await avatarsOf(deps, tx, asking.tenantId, [
      ...queue.map((c) => c.personId),
      ...decided.map((c) => c.personId),
    ]);

    const items: ApprovalItem[] = [];
    for (const c of queue) {
      const person = await deps.service.access.read(tx, { ...asking, personId: c.personId });
      const attributes = person.ok ? person.value.attributes : {};
      const change =
        c.canDecide || c.canSelfApprove
          ? await pending.store.find(tx, asking.tenantId, c.id)
          : null;
      // Only to those who decide: a requester is never told which rule they tripped.
      const found =
        change === null
          ? null
          : await flagChange(tx, pending, look, {
              change,
              readable: c.readable,
              requesterName: user(c.requestedBy),
            });
      items.push({
        id: c.id,
        personId: c.personId,
        name: nameOf(attributes) ?? 'Unnamed',
        avatarUrl: person.ok ? (avatars.get(c.personId) ?? null) : null,
        key: c.attributeKey,
        label: labels.get(c.attributeKey) ?? c.attributeKey,
        kind: c.kind,
        value: c.readable ? toForm(c.value) : null,
        readable: c.readable,
        current: c.readable ? toForm(attributes[c.attributeKey]) : null,
        effectiveFrom: c.effectiveFrom,
        requestedAt: c.requestedAt,
        expiresAt: c.expiresAt,
        requestedBy: user(c.requestedBy),
        reason: c.reason,
        mine: c.mine,
        canDecide: c.canDecide,
        canSelfApprove: c.canSelfApprove,
        awaitingReview: c.awaitingReview,
        findings: c.findings,
        ...(found === null
          ? unflagged
          : {
              flags: found.reasons.map(({ code, title, detail }) => ({ code, title, detail })),
              comparisons: found.comparisons,
              flagNote: found.note,
              flagSummary: rowSummary(found.reasons),
            }),
        canAsk: c.canDecide && pending.flags !== undefined,
        canMark: c.canDecide && pending.flags !== undefined && (found?.reasons.length ?? 0) > 0,
        questions: asked(c.id, c.mine),
        state: 'pending',
        decidedBy: null,
        decidedAt: null,
        note: null,
      });
    }

    const titleOf = new Map<string, string>(CHECKS.map((k) => [k.code, k.title]));
    const decidedItems: ApprovalItem[] = [];
    for (const c of decided) {
      const outcome = outcomeAt(c.approval, now);
      if (outcome === null) continue;
      const person = await deps.service.access.read(tx, { ...asking, personId: c.personId });
      const attributes = person.ok ? person.value.attributes : {};
      const definition = definitions.find((d) => d.key === c.attributeKey);
      const readable =
        definition !== undefined &&
        visibleTo(
          definition,
          await deps.relations.relations(tx, asking.tenantId, asking.viewer, c.personId),
        );
      const shown = c.sealed ? { last4: c.last4 } : c.value;
      const codes = c.flags ?? [];
      decidedItems.push({
        id: c.approval.id,
        personId: c.personId,
        name: nameOf(attributes) ?? 'Unnamed',
        avatarUrl: person.ok ? (avatars.get(c.personId) ?? null) : null,
        key: c.attributeKey,
        label: labels.get(c.attributeKey) ?? c.attributeKey,
        kind: c.kind,
        value: readable ? toForm(shown) : null,
        readable,
        current: readable ? toForm(attributes[c.attributeKey]) : null,
        effectiveFrom: c.effectiveFrom,
        requestedAt: c.approval.requestedAt,
        expiresAt: c.approval.expiresAt,
        requestedBy: user(c.approval.requestedBy),
        reason: c.approval.reason === '' ? null : c.approval.reason,
        mine: c.approval.requestedBy === asking.viewer.accountId,
        canDecide: false,
        canSelfApprove: false,
        awaitingReview: false,
        findings: [],
        // What flagged it when it was decided, by name: the comparison itself is not kept.
        flags: codes.map((code) => ({
          code: code as CheckCode,
          title: titleOf.get(code) ?? code,
          detail: '',
        })),
        comparisons: [],
        flagNote: null,
        flagSummary: rowSummary(codes.map((code) => ({ title: titleOf.get(code) ?? code }))),
        canAsk: false,
        canMark: false,
        questions: asked(c.approval.id, false),
        state: outcome.state,
        decidedBy: c.approval.decidedBy === null ? null : user(c.approval.decidedBy),
        decidedAt: outcome.at,
        note: c.approval.note,
      });
    }

    const everyone = isHr
      ? await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY)
      : null;
    return ok({
      isHr,
      items,
      decided: decidedItems,
      decidedNext,
      checks: isHr ? checksOf(look.enabled) : null,
      canTune: everyone?.isAdmin === true && pending.flags !== undefined,
      last90:
        isHr && pending.flags !== undefined
          ? await pending.flags.store.stats(tx, asking.tenantId, since)
          : null,
    });
  });
}

/** The viewer's own requests, decided (Review's Decided, E10): theirs alone, whoever they are. */
export interface OwnDecidedView {
  /** Their requested changes decided, lapsed or withdrawn in the last 90 days, newest first. */
  readonly changes: readonly ApprovalItem[];
  /** Their own identifiers HR accepted or sent back in the last 90 days. Never the value. */
  readonly identifiers: readonly DecidedIdentifierReview[];
}

/**
 * What became of the viewer's own requests (E10), read for them alone: the
 * changes they asked for that were approved (applied from their date),
 * rejected (with HR's note), lapsed or withdrawn by them, each with the value
 * before beside the value asked for as they may read both; and their own
 * identifiers HR accepted or sent back, by label and never by value. The store
 * is asked for this requester's rows, and `ownOutcomeAt` answers nothing for a
 * row anybody else asked for.
 */
export async function ownDecidedView(
  deps: ScreenDeps,
  asking: Asking,
): Promise<Result<OwnDecidedView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const me = asking.viewer.accountId;
    const now = deps.clock.instant();
    const since = new Date(Date.parse(now) - NINETY_DAYS_MS).toISOString();
    const pending = deps.service.pending;
    const rows =
      pending === undefined
        ? []
        : await pending.store.decided(tx, asking.tenantId, {
            since,
            until: now,
            limit: DECIDED_PAGE,
            requestedBy: me,
          });
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    const definitions = version?.document.attributes ?? [];
    const labels = new Map(definitions.map((d) => [d.key as string, d.label.default]));
    const own = await deps.personOf(tx, asking.tenantId, me);
    const reviewed =
      own === null
        ? null
        : await deps.service.access.personReviews(tx, {
            ...asking,
            personId: own,
            decidedSince: since,
            limit: DECIDED_PAGE,
          });
    const reviews = reviewed?.ok === true ? reviewed.value : [];
    const by = await actors(deps, tx, asking, [
      ...rows.flatMap((c) =>
        c.approval.decidedBy === null
          ? []
          : [{ kind: 'user' as const, userId: c.approval.decidedBy }],
      ),
      ...reviews.flatMap((r) =>
        r.decidedBy === null ? [] : [{ kind: 'user' as const, userId: r.decidedBy }],
      ),
    ]);
    const user = (userId: string) => by({ kind: 'user', userId });
    const avatars = await avatarsOf(
      deps,
      tx,
      asking.tenantId,
      rows.map((c) => c.personId),
    );

    const changes: ApprovalItem[] = [];
    for (const c of rows) {
      const outcome = ownOutcomeAt(c.approval, now, me);
      if (outcome === null) continue;
      const person = await deps.service.access.read(tx, { ...asking, personId: c.personId });
      const definition = definitions.find((d) => d.key === c.attributeKey);
      const readable =
        person.ok &&
        definition !== undefined &&
        visibleTo(
          definition,
          await deps.relations.relations(tx, asking.tenantId, asking.viewer, c.personId),
        );
      // What was there when they asked: the entry recorded before the request.
      const kept = readable
        ? await deps.service.access.history(tx, {
            ...asking,
            personId: c.personId,
            attributeKey: c.attributeKey,
          })
        : null;
      const entries = kept?.ok === true ? kept.value : [];
      const then = recordedBefore(entries, c.attributeKey, c.approval.requestedAt);
      const current = readable ? toForm(person.value.attributes[c.attributeKey]) : null;
      changes.push({
        id: c.approval.id,
        personId: c.personId,
        name: (person.ok ? nameOf(person.value.attributes) : null) ?? 'Unnamed',
        avatarUrl: person.ok ? (avatars.get(c.personId) ?? null) : null,
        key: c.attributeKey,
        label: labels.get(c.attributeKey) ?? c.attributeKey,
        kind: c.kind,
        value: readable ? toForm(c.sealed ? { last4: c.last4 } : c.value) : null,
        readable,
        current,
        // Nothing recorded for it at all: what it holds now is what it always held.
        before:
          then !== undefined
            ? toForm(then.value)
            : entries.some((e) => e.attributeKey === c.attributeKey)
              ? null
              : current,
        effectiveFrom: c.effectiveFrom,
        requestedAt: c.approval.requestedAt,
        expiresAt: c.approval.expiresAt,
        requestedBy: user(me),
        reason: c.approval.reason === '' ? null : c.approval.reason,
        mine: true,
        canDecide: false,
        canSelfApprove: false,
        awaitingReview: false,
        findings: [],
        // A requester is never told which rule they tripped.
        ...unflagged,
        canAsk: false,
        canMark: false,
        questions: [],
        state: outcome.state,
        decidedBy:
          outcome.state === 'lapsed' || c.approval.decidedBy === null
            ? null
            : user(c.approval.decidedBy),
        decidedAt: outcome.at,
        note: outcome.state === 'withdrawn' ? null : c.approval.note,
      });
    }

    const identifiers: DecidedIdentifierReview[] = [];
    const name =
      own === null ? null : await deps.service.access.read(tx, { ...asking, personId: own });
    for (const r of reviews) {
      const outcome = reviewOutcome(r);
      if (outcome === null || r.decidedBy === null || r.decidedAt === null) continue;
      identifiers.push({
        personId: r.personId,
        name: (name?.ok === true ? nameOf(name.value.attributes) : null) ?? 'You',
        label: labels.get(r.attributeKey) ?? r.attributeKey,
        outcome,
        decidedBy: user(r.decidedBy),
        decidedAt: r.decidedAt,
        note: r.note,
      });
    }
    return ok({ changes, identifiers });
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
  /** Who, to draw: a person with their photo if the viewer may read them, or not a person. */
  readonly actor: {
    readonly kind: 'person' | 'integration' | 'system' | 'support';
    readonly avatarUrl: string | null;
  };
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
    const faces = await actorFaces(
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
        actor: {
          kind:
            e.actor.kind === 'user'
              ? e.actor.onBehalfOf === undefined
                ? ('person' as const)
                : ('support' as const)
              : e.actor.kind === 'integration'
                ? ('integration' as const)
                : ('system' as const),
          avatarUrl: e.actor.kind === 'user' ? (faces.get(e.actor.userId) ?? null) : null,
        },
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

/** The photo of each person among these actors whom the viewer may read, by account. */
async function actorFaces(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  all: readonly Actor[],
): Promise<ReadonlyMap<string, string>> {
  const people = new Map<string, string>();
  for (const actor of all) {
    if (actor.kind !== 'user' || people.has(actor.userId)) continue;
    const personId = await deps.personOf(tx, asking.tenantId, actor.userId);
    if (personId === null) continue;
    const read = await deps.service.access.read(tx, { ...asking, personId });
    if (read.ok) people.set(actor.userId, personId);
  }
  const avatars = await avatarsOf(deps, tx, asking.tenantId, [...people.values()]);
  return new Map(
    [...people].flatMap(([account, personId]) => {
      const url = avatars.get(personId);
      return url === undefined ? [] : [[account, url] as const];
    }),
  );
}

/** What a person's history and the settings log call an action Kithena support took. */
export const SUPPORT = 'Kithena support';

/**
 * Who made each change, in words the viewer may read. A person is named only
 * if this viewer can read their name; otherwise "A colleague". Kithena
 * support is named as itself, to everybody, the support agent included.
 */
export async function actors(
  deps: Pick<ScreenDeps, 'personOf'> & {
    readonly service: Pick<ScreenDeps['service'], 'access'>;
  },
  tx: Tx,
  asking: Asking,
  all: readonly Actor[],
): Promise<(actor: Actor) => string> {
  const names = new Map<string, string>();
  for (const actor of all) {
    if (actor.kind !== 'user' || actor.onBehalfOf !== undefined || names.has(actor.userId))
      continue;
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
      ? actor.onBehalfOf === undefined
        ? (names.get(actor.userId) ?? 'A colleague')
        : SUPPORT
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
  /** Their photo, when they have one and the viewer may read them. */
  readonly avatarUrl: string | null;
  /** Held for approval, not yet written: reviewed first, and sending it back declines it. */
  readonly held: boolean;
  /** Who entered the value, as the viewer may name them; null where nobody is recorded. */
  readonly enteredBy: string | null;
}

/** An identifier HR decided (Review's Decided, E9): who, which, what and by whom. Never the value. */
export interface DecidedIdentifierReview {
  readonly personId: string;
  readonly name: string;
  readonly label: string;
  readonly outcome: 'accepted' | 'sent_back';
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly note: string | null;
}

export interface IdentifierReviewsView {
  readonly items: readonly IdentifierReviewItem[];
  /** Decided in the last 90 days, newest first. */
  readonly decided: readonly DecidedIdentifierReview[];
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
    const avatars = await avatarsOf(
      deps,
      tx,
      asking.tenantId,
      queue.value.map((r) => r.personId),
    );
    const enteredBy = await actors(
      deps,
      tx,
      asking,
      queue.value.flatMap((r) => (r.enteredBy == null ? [] : [r.enteredBy])),
    );
    for (const r of queue.value) {
      const person = await deps.service.access.read(tx, { ...asking, personId: r.personId });
      items.push({
        avatarUrl: person.ok ? (avatars.get(r.personId) ?? null) : null,
        personId: r.personId,
        name: (person.ok ? nameOf(person.value.attributes) : null) ?? 'Unnamed',
        attributeKey: r.attributeKey,
        label: r.label,
        last4: r.last4,
        findings: r.findings.filter((f) => f.level !== 'ok'),
        enteredAt: r.createdAt,
        held: r.pendingChangeId !== null,
        enteredBy: r.enteredBy == null ? null : enteredBy(r.enteredBy),
      });
    }
    const since = new Date(Date.parse(deps.clock.instant()) - NINETY_DAYS_MS).toISOString();
    const closed = await deps.service.access.identifierReviews(tx, {
      ...asking,
      decidedSince: since,
      limit: DECIDED_PAGE,
    });
    const reviews = closed.ok ? closed.value : [];
    const by = await actors(
      deps,
      tx,
      asking,
      reviews.flatMap((r) =>
        r.decidedBy === null ? [] : [{ kind: 'user' as const, userId: r.decidedBy }],
      ),
    );
    const decided: DecidedIdentifierReview[] = [];
    for (const r of reviews) {
      const outcome = reviewOutcome(r);
      if (outcome === null || r.decidedBy === null || r.decidedAt === null) continue;
      const person = await deps.service.access.read(tx, { ...asking, personId: r.personId });
      decided.push({
        personId: r.personId,
        name: (person.ok ? nameOf(person.value.attributes) : null) ?? 'Unnamed',
        label: r.label,
        outcome,
        decidedBy: by({ kind: 'user', userId: r.decidedBy }),
        decidedAt: r.decidedAt,
        note: r.note,
      });
    }
    return ok({ items, decided });
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

/** A merge HR may undo, and what the undo would reverse and keep, by label. */
export interface MergedPair {
  readonly absorbedId: string;
  readonly survivorId: string;
  readonly absorbedName: string;
  readonly survivorName: string;
  readonly mergedAt: string;
  readonly reversed: readonly string[];
  readonly kept: readonly string[];
  /** The sign-in the merge moved: given back, kept, or none moved. */
  readonly account: 'returned' | 'kept' | null;
  /** Why it cannot be undone; null when it can. */
  readonly refusal: string | null;
}

export interface DuplicatesView {
  readonly items: readonly {
    readonly personIds: readonly [string, string];
    readonly names: readonly [string, string];
    readonly reasons: readonly string[];
    /** How strong the match is, as a band from the signals' weights (`matchBand`). */
    readonly match: MatchBand;
    /** What flagged the pair, as nobody asked: SCIM provisioning, or Kithena's duplicate check. */
    readonly flaggedBy: string;
    /** Each one's photo, where they have one and the viewer may read them. */
    readonly avatarUrls: readonly [string | null, string | null];
  }[];
  /**
   * Merges still standing, newest first, each with what undoing it would
   * do; empty beside a comparison.
   */
  readonly merges: readonly MergedPair[];
  /** The next page of `merges`, as `mergesAfter`; null on the last. */
  readonly mergesNext: string | null;
  /** The pair asked about, side by side; null when none was. */
  readonly comparison: {
    readonly people: readonly [ComparedPerson, ComparedPerson];
    readonly rows: readonly ComparedRow[];
  } | null;
}

/** What flagged a suspected pair: SCIM provisioning when it found it, else Kithena's own check. */
export const duplicateSource = (signals: readonly { readonly signal: string }[]): string =>
  signals.some((s) => s.signal === 'scim_work_email')
    ? 'SCIM provisioning'
    : 'Kithena’s duplicate check';

const SIGNAL_WORDS = {
  work_email: 'Same work email',
  scim_work_email: 'SCIM provisioned, same work email',
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
/** Merged records, a keyset page at a time as the list scrolls. */
export const MERGES_PAGE = 20;
const MERGES_CURSOR = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)~([0-9a-f-]{36})$/u;

export async function duplicatesView(
  deps: ScreenDeps,
  asking: Asking,
  pair: readonly [string, string] | null,
  /** Merged records' next page from this place: the page alone, without the queue. */
  mergesAfter: string | null = null,
): Promise<Result<DuplicatesView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const access = deps.service.access;
    const queued = await access.duplicates(tx, asking);
    if (!queued.ok) return queued;
    const queue = mergesAfter === null ? queued : { ...queued, value: [] };
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const labelOf = (key: string) =>
      version.document.attributes.find((d) => d.key === key)?.label.default ?? key;
    const nameFor = async (personId: string) => {
      const read = await access.read(tx, { ...asking, personId });
      return (read.ok ? nameOf(read.value.attributes) : null) ?? 'Unnamed';
    };

    const items: DuplicatesView['items'][number][] = [];
    // Only somebody the viewer may read has a face here, as on every other list.
    const readable = new Set<string>();
    for (const id of new Set(queue.value.flatMap((c) => c.personIds))) {
      // eslint-disable-next-line no-await-in-loop -- one transaction, read in turn
      if ((await access.read(tx, { ...asking, personId: id })).ok) readable.add(id);
    }
    const avatars = await avatarsOf(deps, tx, asking.tenantId, [...readable]);
    const faceOf = (id: string) => (readable.has(id) ? (avatars.get(id) ?? null) : null);
    for (const c of queue.value) {
      items.push({
        personIds: c.personIds,
        avatarUrls: [faceOf(c.personIds[0]), faceOf(c.personIds[1])],
        names: [await nameFor(c.personIds[0]), await nameFor(c.personIds[1])],
        reasons: c.signals.map((s) =>
          s.signal === 'unique_value'
            ? `Same ${labelOf(s.attributeKey ?? '')}`
            : SIGNAL_WORDS[s.signal],
        ),
        match: matchBand(c.signals),
        flaggedBy: duplicateSource(c.signals),
      });
    }
    if (pair === null) {
      const place = mergesAfter === null ? null : MERGES_CURSOR.exec(mergesAfter);
      const standing = await access.merges(tx, {
        ...asking,
        limit: MERGES_PAGE + 1,
        ...(place === null ? {} : { before: { at: place[1] ?? '', id: place[2] ?? '' } }),
      });
      if (!standing.ok) return standing;
      const shown = standing.value.slice(0, MERGES_PAGE);
      const last = shown.at(-1);
      const mergesNext =
        standing.value.length > MERGES_PAGE && last !== undefined
          ? `${last.decidedAt}~${last.id}`
          : null;
      const merges: MergedPair[] = [];
      for (const m of shown) {
        const undo = await access.unmergeOptions(tx, { ...asking, personId: m.absorbedId });
        if (!undo.ok) return undo;
        merges.push({
          absorbedId: m.absorbedId,
          survivorId: m.survivorId,
          absorbedName: await nameFor(m.absorbedId),
          survivorName: await nameFor(m.survivorId),
          mergedAt: m.decidedAt,
          reversed: undo.value.reversed.map(labelOf),
          kept: undo.value.kept.map(labelOf),
          account: undo.value.account,
          refusal: undo.value.refusal?.message ?? null,
        });
      }
      return ok<DuplicatesView>({ items, merges, mergesNext, comparison: null });
    }

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
      merges: [],
      mergesNext: null,
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
  /** Everybody the search and filters match, not only this page. */
  readonly total: number;
  /** Active people among them. */
  readonly active: number;
  /** Provisional or pre-hire among them; null when this viewer is not shown statuses. */
  readonly notStarted: number | null;
  /**
   * On notice, of everybody: the Leaving view's count (C1). Only beside the
   * bare directory, and only for a viewer shown statuses; null otherwise.
   */
  readonly leaving: number | null;
  readonly incomplete: number | null;
  /**
   * Every column this viewer may show, in order; `shown` is the default set
   * (the fields marked for the directory). The screen lets the viewer choose.
   */
  readonly columns: readonly {
    readonly key: string;
    readonly label: string;
    readonly shown: boolean;
    readonly sortable: boolean;
  }[];
  /**
   * Every field this viewer may build a condition on, with what kind of value
   * it holds (which operators fit) and, for a choice, its options.
   */
  readonly fields: readonly {
    readonly key: string;
    readonly label: string;
    readonly kind: 'text' | 'select' | 'date' | 'number' | 'person' | 'status';
    readonly options: readonly { readonly value: string; readonly label: string }[];
  }[];
  /** The conditions, match and order this page answers, as asked. */
  readonly query: {
    readonly conditions: readonly Condition[];
    readonly match: 'all' | 'any';
    readonly sort: { readonly key: string; readonly direction: 'asc' | 'desc' } | null;
    /** At most this many people ("top 5"); null for everybody found. */
    readonly top: number | null;
  };
  /**
   * What People works out about each person that this viewer may order by
   * (`domain/person/metrics.ts`), with the order in words; those that are
   * `filter` are in `fields` too, as numbers or dates a condition may name.
   */
  readonly metrics: readonly {
    readonly key: string;
    readonly label: string;
    readonly kind: 'number' | 'date';
    readonly filter: boolean;
    readonly most: string;
    readonly least: string;
  }[];
  readonly filterable: readonly {
    readonly key: string;
    readonly label: string;
    readonly options: readonly { readonly value: string; readonly label: string }[];
  }[];
  /** When People answered: what each person's local time is read from. */
  readonly now: string;
  readonly people: readonly {
    readonly id: string;
    readonly name: string;
    readonly email: string | null;
    readonly avatarUrl: string | null;
    /**
     * Their zone, from what the viewer may read of where they work; null
     * when that places them nowhere (`placedZone`).
     */
    readonly timeZone: string | null;
    readonly values: Readonly<Record<string, string>>;
    /** Each person column (a manager): who, with their photo, to draw as a person. */
    readonly people: readonly {
      readonly key: string;
      readonly id: string;
      readonly name: string;
      readonly avatarUrl: string | null;
    }[];
    readonly missing: number | null;
  }[];
  /** The cursor for the page after this one; null on the last page. */
  readonly next: string | null;
  /** Which of the screen's actions this viewer gets (§13.1, §8.4). */
  readonly can: { readonly import: boolean; readonly export: boolean; readonly bulkEdit: boolean };
  /** The saved segment applied (PEO-068), and those this viewer could apply here. */
  readonly segment: { readonly id: string; readonly name: string } | null;
  readonly segments: readonly { readonly id: string; readonly name: string }[];
  /**
   * Smart search's "Try asking": questions built from this company's own
   * fields, each one People's rules read in full (`domain/assistant/clarify.ts`).
   */
  readonly suggestions: readonly string[];
  /**
   * The details the conditions find empty that this viewer may ask everybody
   * found for ("Remind all"); null when there are none, or they may not.
   */
  readonly remind: readonly string[] | null;
}

/** Shown as columns: in the directory, and readable on everybody. */
const COLUMN_SKIP = new Set(['given_name', 'family_name', 'preferred_name', 'work_email']);

/** Core fields the directory offers as columns and conditions, besides tenant fields. */
const COLUMN_CHOICES = new Set([
  'manager_id',
  'location_id',
  'legal_entity_id',
  'hire_date',
  'employee_number',
]);

/** Core columns a directory shows until the viewer chooses: where, since when, and to whom. */
const COLUMN_DEFAULTS = new Set(['manager_id', 'location_id', 'hire_date']);

/**
 * Shown until the viewer chooses: the directory's own set, the core defaults,
 * and a tenant's short fields everybody may read (a job title, a department),
 * never contact details. At most `SHOWN_MAX`, in schema order.
 */
const SHOWN_MAX = 7;
function shownByDefault(d: AttributeDefinition): boolean {
  if (d.includeInDirectory || COLUMN_DEFAULTS.has(d.key)) return true;
  return (
    !isCoreKey(d.key) &&
    d.visibility.includes('directory') &&
    d.classification.piiKind === 'none' &&
    (d.typeConfig.kind === 'select' || d.dataType === 'text')
  );
}

export const STATUS_OPTIONS = [
  { value: 'provisional', label: 'Not started' },
  { value: 'pre_hire', label: 'Starting soon' },
  { value: 'active', label: 'Active' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'notice', label: 'On notice' },
  { value: 'terminated', label: 'Left' },
];

/** Which kind of condition a field takes; null for one the directory does not filter by. */
export function fieldKind(kind: string): 'text' | 'select' | 'date' | 'number' | 'person' | null {
  switch (kind) {
    case 'select':
    case 'location_ref':
    case 'legal_entity_ref':
    case 'org_unit_ref':
      return 'select';
    case 'date':
      return 'date';
    case 'number':
    case 'decimal':
    case 'percentage':
      return 'number';
    case 'person_ref':
      return 'person';
    case 'text':
    case 'long_text':
    case 'email':
    case 'phone':
    case 'url':
      return 'text';
    default:
      return null;
  }
}

/** A choice's label, for a cell. */
function optionLabel(definition: AttributeDefinition, value: string): string | undefined {
  return definition.typeConfig.kind === 'select'
    ? definition.typeConfig.options.find((o) => o.value === value)?.label.default
    : undefined;
}

/**
 * Every column this viewer may read on everybody; the directory's own set
 * shown by default, the rest a choice away. Location and legal entity are
 * named, the manager too, the start date and (HR's) status read as is.
 */
function directoryColumns(
  definitions: readonly AttributeDefinition[],
  everyone: ViewerRelations,
): AttributeDefinition[] {
  return definitions.filter(
    (d) =>
      !COLUMN_SKIP.has(d.key) &&
      !d.encrypted &&
      visibleTo(d, everyone) &&
      (d.includeInDirectory || COLUMN_CHOICES.has(d.key) || !isCoreKey(d.key)),
  );
}

/** Legal entities, locations and org units (by path) by id, to name what a record points at. */
function placeNames(
  org: Awaited<ReturnType<ScreenDeps['calendars']['load']>>,
): Map<string, string> {
  return new Map<string, string>([
    ...[...org.entities.values()].map((e) => [e.id, e.name] as const),
    ...[...org.locations.values()].map((l) => [l.id, l.name] as const),
    ...unitPaths([...(org.orgUnits?.values() ?? [])]),
  ]);
}

/** One cell as the directory shows it: a person or a place by name, a choice by its label. */
function cellOf(
  column: AttributeDefinition,
  value: unknown,
  names: ReadonlyMap<string, string>,
  places: ReadonlyMap<string, string>,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const kind = column.typeConfig.kind;
  const shown =
    kind === 'person_ref'
      ? typeof value === 'string'
        ? names.get(value)
        : undefined
      : isOrgRef(kind)
        ? typeof value === 'string'
          ? places.get(value)
          : undefined
        : kind === 'select' && typeof value === 'string'
          ? (optionLabel(column, value) ?? value)
          : toForm(value);
  return typeof shown === 'string' ? shown : undefined;
}

/**
 * A person column (a manager) names somebody who may not be on the page:
 * each one is read as this viewer may read them, and named where they may.
 */
async function nameEach(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  ids: Iterable<string>,
  names: Map<string, string>,
): Promise<void> {
  const unnamed = [...new Set(ids)].filter((id) => !names.has(id));
  if (unnamed.length === 0) return;
  const read = await deps.service.access.readMany(tx, { ...asking, personIds: unnamed });
  if (!read.ok) return;
  for (const [personId, view] of read.value) {
    const name = nameOf(view.attributes);
    if (name !== null) names.set(personId, name);
  }
}

/** A directory page. Keyset, so the last page of 50,000 costs what the first does. */
export const DIRECTORY_PAGE = 100;

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
    /** Only people with a required detail missing: HR's alone. */
    readonly incomplete?: boolean;
    /** Conditions, all or any, and an order (`refinable` authorizes them). */
    readonly conditions?: readonly Condition[];
    readonly match?: 'all' | 'any';
    readonly sort?: { readonly key: string; readonly direction: 'asc' | 'desc' };
    /** At most this many people, in the order asked. */
    readonly top?: number;
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
    // Missing anything the viewer may see on everybody: HR's, as the grid is.
    const gaps =
      query.incomplete === true
        ? {
            gaps: definitions.filter((d) => visibleTo(d, everyone)).map((d) => d.key as string),
            gapsIn: 'any' as const,
          }
        : {};
    // The cursor is the last person's place, sorted or not; with a "top",
    // how many were shown before it too (`<id>~150`), for where to stop.
    const [afterId = null, shownBefore] = query.after?.split('~') ?? [];
    const offset = Number.parseInt(shownBefore ?? '0', 10) || 0;
    // A view saved from a search holds conditions too: all of them, and
    // all of any typed beside it. "Any of" either side cannot be one query.
    const own = query.conditions ?? [];
    const ownMatch = query.match ?? ('all' as const);
    const saved = segment?.value.conditions ?? [];
    const savedMatch = segment?.value.match ?? 'all';
    if (saved.length > 0 && own.length > 0 && (savedMatch === 'any' || ownMatch === 'any')) {
      return err(
        failure(
          'BAD_REQUEST',
          'A view that matches any of its conditions can’t be narrowed further; clear the view first',
          ['conditions'],
        ),
      );
    }
    const refine = {
      conditions: [...saved, ...own],
      match: own.length === 0 ? savedMatch : saved.length === 0 ? ownMatch : ('all' as const),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
    };
    const narrowed = {
      ...asking,
      where: { ...segment?.value.filter, ...query.filters },
      ...(query.search.trim() === '' ? {} : { search: query.search }),
      ...gaps,
      refine,
    };
    // "Top 5": the page stops at the fifth, and so does the count.
    const top = query.top ?? null;
    const listed = await deps.service.access.list(tx, {
      ...narrowed,
      after: afterId,
      limit: top === null ? DIRECTORY_PAGE : Math.max(1, Math.min(DIRECTORY_PAGE, top - offset)),
    });
    if (!listed.ok) return listed;
    const found = await deps.service.access.count(tx, narrowed);
    if (!found.ok) return found;
    const capped = (n: number): number => (top === null ? n : Math.min(n, top));
    const counted = {
      value: {
        all: capped(found.value.all),
        active: capped(found.value.active),
        notStarted: capped(found.value.notStarted),
      },
    };
    // Leaving, counted as Starting soon is: beside everybody, for a viewer shown statuses.
    const bare =
      own.length === 0 &&
      segment === null &&
      query.incomplete !== true &&
      query.search.trim() === '' &&
      Object.keys(query.filters).length === 0;
    const leaving =
      everyone.isHr && bare
        ? await deps.service.access.count(tx, {
            ...asking,
            refine: {
              conditions: [{ key: 'status', op: 'in', values: ['notice'] }],
              match: 'all',
            },
          })
        : null;
    const page = listed.value.items;
    const next =
      top !== null && offset + page.length >= top
        ? null
        : top === null || listed.value.next === null
          ? listed.value.next
          : `${listed.value.next}~${String(offset + page.length)}`;

    const columns = directoryColumns(definitions, everyone);
    const shownDefault = new Set(
      columns
        .filter(shownByDefault)
        .slice(0, SHOWN_MAX)
        .map((c) => c.key as string),
    );
    const org = await deps.calendars.load(tx, asking.tenantId);
    const placeName = placeNames(org);
    const choices = choicesOf(org);
    const now = deps.clock.instant();
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
    await nameEach(deps, tx, asking, refs, names);
    // Who reports to whom, when the directory is narrowed by it: named, so
    // the filter shows as one the viewer can clear.
    const reportsTo = query.filters[REPORTS_TO];
    if (reportsTo !== undefined && !names.has(reportsTo)) {
      const read = await deps.service.access.read(tx, { ...asking, personId: reportsTo });
      const name = read.ok ? nameOf(read.value.attributes) : null;
      if (name !== null) names.set(reportsTo, name);
    }
    // A manager a condition names ("reports of Marco"), by name, so its chip says who.
    const managers = own.filter(
      (c) =>
        c.key === REPORTS_TO && (c.op === 'is' || c.op === 'under') && c.values[0] !== undefined,
    );
    for (const c of managers) {
      const id = c.values[0] ?? '';
      if (names.has(id)) continue;
      // eslint-disable-next-line no-await-in-loop -- one or two managers a question names
      const read = await deps.service.access.read(tx, { ...asking, personId: id });
      const name = read.ok ? nameOf(read.value.attributes) : null;
      if (name !== null) names.set(id, name);
    }
    const personColumns = columns.filter((c) => c.typeConfig.kind === 'person_ref');
    const avatars = await avatarsOf(deps, tx, asking.tenantId, [
      ...page.map((p) => p.id),
      ...names.keys(),
    ]);
    // HR's per-row count of what is missing, as the verdict counts it: only
    // fields HR may see on that person. The page's verdicts in one call, as the grid.
    const missing = new Map<string, number>();
    if (everyone.isHr) {
      const verdicts = await deps.service.access.completenessOf(tx, {
        ...asking,
        personIds: page.map((p) => p.id),
      });
      if (verdicts.ok) {
        for (const [id, verdict] of verdicts.value) missing.set(id, verdict.missing.length);
      }
    }
    const incomplete = everyone.isHr
      ? await deps.service.access.count(tx, {
          ...narrowed,
          gaps: definitions.filter((d) => visibleTo(d, everyone)).map((d) => d.key as string),
          gapsIn: 'any',
        })
      : null;

    // HR's: the status in words, beside the columns.
    const withStatus = (status: string | undefined, values: Record<string, string>) =>
      everyone.isHr && status !== undefined
        ? { ...values, status: STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status }
        : values;

    // Everything a condition may name, for the Filters sheet, smart search's
    // suggestions, and the details a search may ask people for.
    const fields = [
      ...columns.flatMap((c) => {
        const kind = fieldKind(c.typeConfig.kind);
        if (kind === null) return [];
        const options =
          c.typeConfig.kind === 'select'
            ? c.typeConfig.options
                .filter((o) => o.retiredAt === null)
                .map((o) => ({ value: o.value, label: o.label.default }))
            : isOrgRef(c.typeConfig.kind)
              ? [...choices[c.typeConfig.kind]]
              : [];
        return [{ key: c.key, label: c.label.default, kind, options }];
      }),
      ...(everyone.isHr
        ? [
            {
              key: 'status',
              label: 'Status',
              kind: 'status' as const,
              options: STATUS_OPTIONS,
            },
          ]
        : []),
    ];
    // The metrics this viewer may order by, and narrow by where a metric is a filter.
    const metrics = usableMetrics(definitions, everyone).map((m) => ({
      key: m.key,
      label: m.label,
      kind: m.kind,
      filter: m.filter,
      most: m.most,
      least: m.least,
    }));
    const aiEligible = new Map(
      definitions.map((d) => [d.key as string, d.classification.aiEligible]),
    );
    const empties = [...new Set(own.filter((c) => c.op === 'empty').map((c) => c.key))];
    const askableKeys = new Set(
      definitions.filter((d) => askable(d, everyone)).map((d) => d.key as string),
    );

    return ok({
      total: counted.value.all,
      active: counted.value.active,
      notStarted: everyone.isHr ? counted.value.notStarted : null,
      leaving: leaving?.ok === true ? leaving.value.all : null,
      incomplete: incomplete?.ok === true ? incomplete.value.all : null,
      columns: [
        ...columns.map((c) => ({
          key: c.key,
          label: c.label.default,
          shown: shownDefault.has(c.key),
          sortable: true,
        })),
        ...(everyone.isHr ? [{ key: 'status', label: 'Status', shown: true, sortable: true }] : []),
      ],
      fields: [
        ...fields.map((f) =>
          f.key === REPORTS_TO && managers.length > 0
            ? {
                ...f,
                options: managers.flatMap((c) => {
                  const id = c.values[0] ?? '';
                  const name = names.get(id);
                  return name === undefined ? [] : [{ value: id, label: name }];
                }),
              }
            : f,
        ),
        ...metrics
          .filter((m) => m.filter)
          .map((m) => ({ key: m.key, label: m.label, kind: m.kind, options: [] })),
      ],
      metrics,
      query: {
        conditions: own,
        match: ownMatch,
        sort: query.sort ?? null,
        top,
      },
      filterable: [
        ...(reportsTo === undefined
          ? []
          : [
              {
                key: REPORTS_TO,
                label: 'Reports to',
                options: [{ value: reportsTo, label: names.get(reportsTo) ?? 'Somebody' }],
              },
            ]),
        ...selects.map((d) => ({
          key: d.key,
          label: d.label.default,
          options:
            d.typeConfig.kind === 'select'
              ? d.typeConfig.options
                  .filter((o) => o.retiredAt === null)
                  .map((o) => ({ value: o.value, label: o.label.default }))
              : [],
        })),
      ],
      now,
      people: page.map((p) => {
        const email = p.attributes['work_email'];
        return {
          id: p.id,
          name: nameOf(p.attributes) ?? (typeof email === 'string' ? email : 'Unnamed'),
          email: typeof email === 'string' ? email : null,
          avatarUrl: avatars.get(p.id) ?? null,
          timeZone: placedZone(org, placementOf(p.attributes), now),
          values: withStatus(
            p.status,
            Object.fromEntries(
              columns.flatMap((c) => {
                const shown = cellOf(c, p.attributes[c.key], names, placeName);
                return shown === undefined ? [] : [[c.key, shown]];
              }),
            ),
          ),
          people: personColumns.flatMap((c) => {
            const id = p.attributes[c.key];
            const name = typeof id === 'string' ? names.get(id) : undefined;
            return typeof id === 'string' && name !== undefined
              ? [{ key: c.key, id, name, avatarUrl: avatars.get(id) ?? null }]
              : [];
          }),
          missing: missing.get(p.id) ?? null,
        };
      }),
      next,
      // An export is a read, so everybody may build one of what they can see.
      can: { import: everyone.isHr, export: true, bulkEdit: everyone.isHr },
      segment: segment === null ? null : { id: segment.value.id, name: segment.value.name },
      segments: (await segmentsFor(deps, tx, asking))
        .filter((s) => s.usableIn.directory)
        .map((s) => ({ id: s.id, name: s.name })),
      suggestions: suggestionsFor(
        fields.map((f) => ({
          ...f,
          ai: f.key === 'status' || aiEligible.get(f.key) === true,
        })),
        deps.clock.instant().slice(0, 10),
      ),
      remind:
        everyone.isHr && empties.length > 0 && empties.every((k) => askableKeys.has(k))
          ? empties
          : null,
    });
  });
}

/* ----------------------------------------------------------- org chart -- */

/** The most people an org chart draws; past it the chart says it is cut short. */
export const ORG_CHART_MAX = 2000;

export interface OrgChartView {
  readonly people: readonly {
    readonly id: string;
    readonly name: string;
    readonly title: string | null;
    readonly managerId: string | null;
    readonly managerName: string | null;
    readonly avatarUrl: string | null;
    /** HR's: the status in words. */
    readonly status: string | null;
    readonly team: string | null;
    readonly location: string | null;
  }[];
  /** More people than `ORG_CHART_MAX`: the chart is not everybody. */
  readonly truncated: boolean;
}

/**
 * Everybody this viewer may list, with their manager, for the org chart: one
 * read, where the shell once paged the directory twenty times over — each
 * page a round trip, and for HR each row a completeness verdict the chart
 * never shows. The cells are the directory's (`directoryColumns`, `cellOf`),
 * so the chart shows what the list would: a column the viewer cannot read on
 * everybody is null for everybody, and a manager they cannot read is nobody,
 * which draws the person as a root.
 */
export async function orgChartView(
  deps: ScreenDeps,
  asking: Asking,
): Promise<Result<OrgChartView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const definitions = version.document.attributes.filter((d) => d.deprecatedAt === null);
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    const columns = new Map(
      directoryColumns(definitions, everyone).map((c) => [c.key as string, c]),
    );
    const listed = await deps.service.access.list(tx, {
      ...asking,
      after: null,
      limit: ORG_CHART_MAX + 1,
      refine: { conditions: [], match: 'all', sort: { key: 'name', direction: 'asc' } },
    });
    if (!listed.ok) return listed;
    const page = listed.value.items.slice(0, ORG_CHART_MAX);
    const manager = columns.get('manager_id');
    const names = new Map(pickable(page).map((p) => [p.value, p.label]));
    if (manager !== undefined) {
      const ids = page
        .map((p) => p.attributes['manager_id'])
        .filter((v): v is string => typeof v === 'string');
      await nameEach(deps, tx, asking, new Set(ids), names);
    }
    const places = placeNames(await deps.calendars.load(tx, asking.tenantId));
    const avatars = await avatarsOf(
      deps,
      tx,
      asking.tenantId,
      page.map((p) => p.id),
    );
    const cell = (p: PersonView, key: string): string | null => {
      const column = columns.get(key);
      const shown =
        column === undefined ? undefined : cellOf(column, p.attributes[key], names, places);
      return shown === undefined || shown === '' ? null : shown;
    };
    return ok({
      people: page.map((p) => {
        const managerId = manager === undefined ? undefined : p.attributes['manager_id'];
        const managerName = typeof managerId === 'string' ? names.get(managerId) : undefined;
        const email = p.attributes['work_email'];
        return {
          id: p.id,
          name: nameOf(p.attributes) ?? (typeof email === 'string' ? email : 'Unnamed'),
          title: cell(p, 'job_title'),
          // Named or nobody, as the directory's person cell is.
          managerId: typeof managerId === 'string' && managerName !== undefined ? managerId : null,
          managerName: managerName ?? null,
          avatarUrl: avatars.get(p.id) ?? null,
          status:
            everyone.isHr && p.status !== undefined
              ? (STATUS_OPTIONS.find((o) => o.value === p.status)?.label ?? p.status)
              : null,
          team: cell(p, 'department'),
          location: cell(p, 'location_id'),
        };
      }),
      truncated: listed.value.items.length > ORG_CHART_MAX,
    });
  });
}

/* -------------------------------------------------------- completeness -- */

export interface CompletenessView {
  readonly since: string;
  readonly waiting: {
    readonly people: number;
    /** The last weekly reminder anybody waiting was sent; null when none was, or unknown. */
    readonly lastReminded: string | null;
    /** How many the sweep would remind now; null where it cannot be run from here. */
    readonly due: number | null;
  };
  readonly completedThisWeek: number;
  /** HR's missing values over everybody, not only this page. */
  readonly toFill: number;
  /** People missing bank, tax or ID details (`blocksPayroll`); null where not known. */
  readonly blocking: number | null;
  readonly fields: readonly {
    readonly key: string;
    readonly label: string;
    /** What kind of value it takes, so each cell is that kind's own control. */
    readonly dataType: AttributeDefinition['dataType'];
    /** ISO 4217, for a money field fixed to one currency; null for any other. */
    readonly currency: string | null;
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
    /** Who fills these in: HR, in the grid, or the person, reminded. */
    readonly owner: 'hr' | 'employee';
    /** The person's last reminder, weekly or asked for; null for HR's rows and for never. */
    readonly remindedAt: string | null;
  }[];
  /** The cursor for the page after this one; null on the last page. */
  readonly next: string | null;
}

/** A grid page: the directory's size, so it costs what a directory page does. */
export const GRID_PAGE = DIRECTORY_PAGE;

/**
 * Who is missing what (§8.4, V4): a row for HR's gaps, which HR fills in the
 * grid, and a row for the person's own, which they are reminded of. A gap
 * Finance alone fills is neither: it is not HR's to chase.
 *
 * Paged by keyset over the people with such a gap (PEO-122, PEO-124),
 * through `PersonAccess.list`, so page 1,000 costs what page 1 does; the
 * totals and HR's field list are over everybody, from the gap rows.
 */
export async function completenessView(
  deps: ScreenDeps,
  asking: Asking,
  query: {
    readonly after?: string | null;
    /** One person's gaps alone, for the fill-in a link opens (`?fill=`); the totals stay everybody's. */
    readonly person?: string | null;
  } = {},
): Promise<Result<CompletenessView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    if (!everyone.isHr) return err(failure('FORBIDDEN', 'The completeness grid is HR’s'));
    const version = await deps.service.schemas.current(tx, asking.tenantId);
    if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
    const byKey = new Map(version.document.attributes.map((d) => [d.key as string, d]));
    const hrs = (key: string) => hrFills(byKey.get(key));
    // `gapsByOwner`'s rule: theirs alone, not also HR's or Finance's.
    const theirs = (key: string) => {
      const owners = byKey.get(key)?.ownership ?? [];
      return owners.includes('employee') && !owners.some((o) => o === 'hr' || o === 'finance');
    };
    // Selected by the keys the rows show, so a page is never short of people
    // whose only gap is Finance's. One person is read as a profile is.
    const listed =
      query.person == null
        ? await deps.service.access.list(tx, {
            ...asking,
            gaps: [...byKey.keys()].filter((k) => hrs(k) || theirs(k)),
            gapsIn: 'any',
            after: query.after ?? null,
            limit: GRID_PAGE,
          })
        : await one(deps, tx, asking, query.person);
    if (!listed.ok) return listed;
    const page = listed.value.items;
    const totals = await deps.gapTotals(tx, asking.tenantId);
    const figures =
      deps.gapFigures === undefined
        ? null
        : await deps.gapFigures(tx, asking.tenantId, {
            payroll: version.document.attributes.filter(blocksPayroll).map((d) => d.key),
            now: deps.clock.now(),
            people: page.map((p) => p.id),
          });
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
    const verdicts = await deps.service.access.completenessOf(tx, {
      ...asking,
      personIds: page.map((p) => p.id),
    });
    if (!verdicts.ok) return verdicts;
    for (const person of page) {
      const verdict = verdicts.value.get(person.id);
      if (verdict === undefined) continue;
      const manager = person.attributes['manager_id'];
      const row = {
        personId: person.id,
        name: names.get(person.id) ?? 'Unnamed',
        department:
          typeof person.attributes['department'] === 'string'
            ? person.attributes['department']
            : null,
        manager: typeof manager === 'string' ? (names.get(manager) ?? null) : null,
      };
      const hr = verdict.missing.filter((m) => m.owners.includes('hr'));
      if (hr.length > 0) {
        rows.push({ ...row, missing: hr.map((m) => m.key), owner: 'hr', remindedAt: null });
      }
      const own = gapsByOwner(verdict).employee;
      if (own.length > 0) {
        rows.push({
          ...row,
          missing: own.map((m) => m.key),
          owner: 'employee',
          remindedAt: figures?.remindedAt.get(person.id) ?? null,
        });
      }
    }
    const staff = totals.staff.filter((s) => hrs(s.key));
    const org = await orgChoices(deps, tx, asking.tenantId);
    // HR's fields over everybody, then the labels of the person's own on this page.
    const shown = new Set(staff.map((s) => s.key));
    const own = [
      ...new Set(rows.filter((r) => r.owner === 'employee').flatMap((r) => r.missing)),
    ].filter((k) => !shown.has(k));
    return ok({
      since: `Since version ${String(version.version)} was published on ${version.publishedAt.slice(0, 10)}`,
      waiting: {
        people: totals.waiting,
        lastReminded: figures?.lastReminded ?? null,
        due: figures === null || deps.remindNow === undefined ? null : figures.due,
      },
      completedThisWeek: 0,
      toFill: hrToFill(totals, version),
      blocking: figures?.blocking ?? null,
      fields: [...staff.map((s) => s.key), ...own].flatMap((key) => {
        const d = byKey.get(key);
        if (d === undefined) return [];
        return [
          {
            key,
            label: d.label.default,
            dataType: d.dataType,
            currency: d.typeConfig.kind === 'money' ? d.typeConfig.currency : null,
            options: listOptions(d, org),
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

/** One person as a page of one: none, for somebody this viewer cannot read or who is not there. */
async function one(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  personId: string,
): Promise<Result<{ readonly items: readonly PersonView[]; readonly next: null }>> {
  const read = await deps.service.access.read(tx, { ...asking, personId });
  if (read.ok) return ok({ items: [read.value], next: null });
  return read.error.code === 'NOT_FOUND' || read.error.code === 'FORBIDDEN'
    ? ok({ items: [], next: null })
    : read;
}

/**
 * "Remind N people" (V4): the weekly sweep, run for the tenant now, HR's
 * alone. The sweep's own claim is the rate limit — nobody reminded in the last
 * week is claimed, and nobody outside their working hours — so pressing it
 * twice sends nothing twice. Whoever waits and was not sent one is `skipped`:
 * not due yet, outside their hours, or with no work email to send to.
 */
export async function remindWaiting(
  deps: ScreenDeps,
  asking: Asking,
): Promise<Result<{ readonly sent: number; readonly failed: number; readonly skipped: number }>> {
  const sweep = deps.remindNow;
  if (sweep === undefined) {
    return err(failure('UNAVAILABLE', 'Reminders are not sent from here'));
  }
  const waiting = await run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    if (!everyone.isHr) return err(failure('FORBIDDEN', 'Reminding people is HR’s'));
    return ok((await deps.gapTotals(tx, asking.tenantId)).waiting);
  });
  if (!waiting.ok) return waiting;
  const swept = await sweep(asking.tenantId);
  if (swept.waiting) {
    return err(failure('UNAVAILABLE', 'The company’s details have not reached People yet'));
  }
  return ok({
    sent: swept.sent,
    failed: swept.failed,
    skipped: Math.max(0, waiting.value - swept.sent - swept.failed),
  });
}

/** A grid cell's warning: which person, and what the checks found there (PEO-125). */
export type GridFinding = IdentifierFindingView & { readonly personId: string };

type GridChanges = readonly {
  readonly personId: string;
  readonly values: Readonly<Record<string, unknown>>;
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
