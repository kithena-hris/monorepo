import { localDate, ok, type Result } from '@kithena/domain-kit';

import { personZone } from '../../domain/org/calendar.js';
import { approvalsInbox } from '../person/pending-changes.js';
import { REPORTS_TO, type Asking, type PersonView } from '../person/person-access.js';
import { run } from '../person/service.js';
import { avatarsOf } from './photo.js';
import { actors, ownRecord } from './people.js';
import { nameOf, NOBODY, type ScreenDeps, type Tx } from './record.js';

/**
 * Where People starts: the signed-in person, where they sit, and what is
 * waiting for them (People overview).
 *
 * One read for the whole page, and every part of it through the same
 * authorization as the screen it summarises: the hero is their own record as
 * they may read it, the reporting line is people read one at a time as this
 * viewer may read them, the approvals are the inbox's, and the missing fields
 * are the completeness verdict's, which already leaves out whatever this
 * viewer may not see. A part the viewer has no use for is null, not empty,
 * so the page can leave it out rather than draw an empty card.
 */

/** Someone in the reporting line, as the viewer may name them. */
export interface OverviewPerson {
  readonly id: string;
  readonly name: string;
  /** Their job title, when the viewer may read it. */
  readonly title: string | null;
  readonly avatarUrl: string | null;
}

export interface OverviewView {
  /** The viewer's tenant-wide roles: which of People's places the page offers. */
  readonly roles: { readonly hr: boolean; readonly admin: boolean; readonly finance: boolean };
  /** When the page was drawn: what a local time and an age are read against. */
  readonly now: string;
  /** The viewer's own record; null for an account nobody's record is linked to. */
  readonly me: {
    readonly id: string;
    readonly name: string;
    readonly avatarUrl: string | null;
    readonly title: string | null;
    readonly department: string | null;
    readonly email: string | null;
    readonly phone: string | null;
    /** Where they work, and their zone, for their local time. */
    readonly location: string | null;
    readonly timeZone: string;
    /** Their start date, when their record says it and they may read it. */
    readonly startedOn: string | null;
    /** Today on their calendar: what tenure is counted to. */
    readonly today: string;
    /** Their status, when they are shown it. */
    readonly status: string | null;
    /** Required details still missing, of how many required. */
    readonly missing: number | null;
    readonly required: number;
  } | null;
  readonly reportingLine: {
    /** Nearest first: their manager, then that manager's, up to `CHAIN`. */
    readonly managers: readonly OverviewPerson[];
    /** The line goes on above the last one shown. */
    readonly moreAbove: boolean;
    /** Others with the same manager; null when there is no manager, or it may not be counted. */
    readonly peers: number | null;
    /** The first of their direct reports. */
    readonly reports: readonly OverviewPerson[];
    readonly reportsTotal: number;
    /** The directory's filter for all of them; null where the viewer may not filter by manager. */
    readonly reportsFilter: string | null;
  } | null;
  /** Changes waiting: HR's to decide, or the viewer's own. Null when there is no inbox. */
  readonly approvals: {
    readonly isHr: boolean;
    readonly total: number;
    readonly items: readonly {
      readonly id: string;
      readonly personId: string;
      readonly name: string;
      readonly avatarUrl: string | null;
      readonly label: string;
      readonly requestedAt: string;
      readonly requestedBy: string;
    }[];
  } | null;
  /** Their own missing details, each with its section and who fills it in. */
  readonly missing: readonly {
    readonly key: string;
    readonly label: string;
    readonly sectionKey: string;
    readonly section: string;
    /** Null: the viewer fills it in. Otherwise who does ("HR"). */
    readonly ownedBy: string | null;
  }[];
  /** HR's summary of everybody's gaps; null for anybody else. */
  readonly team: { readonly waiting: number; readonly toFill: number } | null;
}

/** How far up the line the overview reads before "and above". */
export const CHAIN = 4;
/** How many reports, and approvals, the overview names before "Show all". */
export const FIRST = 6;
export const FIRST_APPROVALS = 5;

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export async function overviewView(
  deps: ScreenDeps,
  asking: Asking,
): Promise<Result<OverviewView>> {
  return run(deps.service, asking.tenantId, async (tx): Promise<Result<OverviewView>> => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    const roles = { hr: everyone.isHr, admin: everyone.isAdmin, finance: everyone.isFinance };
    const approvals = await approvalsPart(deps, tx, asking);
    const team = everyone.isHr ? await teamPart(deps, tx, asking.tenantId) : null;

    const personId = await deps.personOf(tx, asking.tenantId, asking.viewer.accountId);
    const record =
      personId === null ? null : await ownRecord(deps, tx, asking, personId, () => true);
    if (personId === null || record === null || !record.ok) {
      return ok({
        roles,
        now: deps.clock.instant(),
        me: null,
        reportingLine: null,
        approvals,
        missing: [],
        team,
      });
    }
    const { view, sections } = record.value;
    const fields = sections.flatMap((s) => s.fields.map((f) => ({ ...f, section: s })));

    const org = await deps.calendars.load(tx, asking.tenantId);
    const now = deps.clock.instant();
    const at = (key: string) => text(view.attributes[key]);
    const zone = personZone(
      org,
      { locationId: at('location_id'), legalEntityId: at('legal_entity_id'), ownZone: null },
      now,
    );
    const locationId = at('location_id');
    const line = await reportingLine(deps, tx, asking, view);
    const avatars = await avatarsOf(deps, tx, asking.tenantId, [personId]);

    return ok({
      roles,
      now,
      me: {
        id: personId,
        name: nameOf(view.attributes) ?? at('work_email') ?? 'You',
        avatarUrl: avatars.get(personId) ?? null,
        title: at('job_title'),
        department: departmentOf(view, fields),
        email: at('work_email'),
        phone: at('work_phone'),
        location: locationId === null ? null : (org.locations.get(locationId)?.name ?? null),
        timeZone: zone,
        startedOn: at('hire_date'),
        today: localDate(now, zone),
        status: view.status ?? null,
        missing: record.value.missing,
        required: fields.filter((f) => f.required).length,
      },
      reportingLine: line,
      approvals,
      missing: fields
        .filter((f) => f.missing)
        .map((f) => ({
          key: f.key,
          label: f.label,
          sectionKey: f.section.key,
          section: f.section.label,
          ownedBy: f.readOnly ? (f.ownedBy ?? 'HR') : null,
        })),
      team,
    });
  });
}

/** A select's label rather than its stored value, when the department is one. */
function departmentOf(
  view: PersonView,
  fields: readonly { readonly key: string; readonly options: readonly { value: string; label: string }[] }[],
): string | null {
  const value = text(view.attributes['department']);
  if (value === null) return null;
  return fields.find((f) => f.key === 'department')?.options.find((o) => o.value === value)?.label ?? value;
}

async function reportingLine(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
  me: PersonView,
): Promise<OverviewView['reportingLine']> {
  // Up the line, each manager read as this viewer may read them: the walk
  // stops at the first one they may not, or at a loop somebody typed.
  const chain: PersonView[] = [];
  const seen = new Set([me.id]);
  let next = text(me.attributes[REPORTS_TO]);
  while (next !== null && !seen.has(next) && chain.length < CHAIN) {
    seen.add(next);
    const read = await deps.service.access.read(tx, { ...asking, personId: next });
    if (!read.ok) {
      next = null;
      break;
    }
    chain.push(read.value);
    next = text(read.value.attributes[REPORTS_TO]);
  }
  const moreAbove = next !== null && !seen.has(next);

  // Down, and across: lists narrowed by manager, authorized as every list is.
  // A viewer who may not filter by manager gets neither, rather than a guess.
  const manager = text(me.attributes[REPORTS_TO]);
  const reports = await deps.service.access.list(tx, {
    ...asking,
    where: { [REPORTS_TO]: me.id },
    limit: FIRST,
  });
  const reportsCount = reports.ok
    ? await deps.service.access.count(tx, { ...asking, where: { [REPORTS_TO]: me.id } })
    : null;
  const peers =
    manager === null
      ? null
      : await deps.service.access.count(tx, { ...asking, where: { [REPORTS_TO]: manager } });

  const shown = [...chain, ...(reports.ok ? reports.value.items : [])];
  const avatars = await avatarsOf(
    deps,
    tx,
    asking.tenantId,
    shown.map((p) => p.id),
  );
  const person = (p: PersonView): OverviewPerson => ({
    id: p.id,
    name: nameOf(p.attributes) ?? text(p.attributes['work_email']) ?? 'Unnamed',
    title: text(p.attributes['job_title']),
    avatarUrl: avatars.get(p.id) ?? null,
  });

  if (chain.length === 0 && (!reports.ok || reports.value.items.length === 0)) return null;
  return {
    managers: chain.map(person),
    moreAbove,
    // Everybody with that manager but them.
    peers: peers?.ok === true ? Math.max(peers.value.all - 1, 0) : null,
    reports: reports.ok ? reports.value.items.map(person) : [],
    reportsTotal: reportsCount?.ok === true ? reportsCount.value.all : 0,
    reportsFilter: reports.ok ? `${REPORTS_TO}:${me.id}` : null,
  };
}

async function approvalsPart(
  deps: ScreenDeps,
  tx: Tx,
  asking: Asking,
): Promise<OverviewView['approvals']> {
  const pending = deps.service.pending;
  if (!pending) return null;
  const inbox = await approvalsInbox(tx, pending, asking);
  if (!inbox.ok) return null;
  // HR decides the ones they can first; anybody else sees their own.
  const all = inbox.value.isHr ? inbox.value.items.filter((c) => c.canDecide) : inbox.value.items;
  if (!inbox.value.isHr && all.length === 0) return null;
  const first = all.slice(0, FIRST_APPROVALS);
  const version = await deps.service.schemas.current(tx, asking.tenantId);
  const labels = new Map(
    (version?.document.attributes ?? []).map((d) => [d.key as string, d.label.default]),
  );
  const by = await actors(
    deps,
    tx,
    asking,
    first.map((c) => ({ kind: 'user' as const, userId: c.requestedBy })),
  );
  const avatars = await avatarsOf(
    deps,
    tx,
    asking.tenantId,
    first.map((c) => c.personId),
  );
  const items: NonNullable<OverviewView['approvals']>['items'][number][] = [];
  for (const c of first) {
    const person = await deps.service.access.read(tx, { ...asking, personId: c.personId });
    items.push({
      id: c.id,
      personId: c.personId,
      name: (person.ok ? nameOf(person.value.attributes) : null) ?? 'Unnamed',
      avatarUrl: person.ok ? (avatars.get(c.personId) ?? null) : null,
      label: labels.get(c.attributeKey) ?? c.attributeKey,
      requestedAt: c.requestedAt,
      requestedBy: by({ kind: 'user', userId: c.requestedBy }),
    });
  }
  return { isHr: inbox.value.isHr, total: all.length, items };
}

async function teamPart(
  deps: ScreenDeps,
  tx: Tx,
  tenantId: string,
): Promise<OverviewView['team']> {
  const totals = await deps.gapTotals(tx, tenantId);
  return {
    waiting: totals.waiting,
    toFill: totals.staff.reduce((n, s) => n + s.people, 0),
  };
}
