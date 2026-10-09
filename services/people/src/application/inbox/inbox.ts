import { localDate, ok, type Result } from '@kithena/domain-kit';
import type {
  InboxField,
  InboxItem,
  PeopleAskedDetail,
  PeopleChangeDetail,
  PeopleChecklistDetail,
  PeopleCorrectDetail,
  PeopleDetailsDetail,
  PeopleReviewDetail,
} from '@kithena/contracts';

import { visibleTo } from '../../domain/access/field-access.js';
import { REPORTS_TO, type Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { actors, ownDecidedView, ownRecord } from '../screens/people.js';
import { formValues, nameOf, toForm, type ScreenDeps, type Tx } from '../screens/record.js';
import type { RecordField } from '../screens/model.js';
import type { WaitingView } from '../screens/waiting.js';
import { CHANGE_NUDGE_AFTER_MS, type AskMessage, type AskState, type DetailAsk } from './asks.js';

/**
 * People's answer to the Inbox (INB-020 to INB-027): what People keeps that
 * reaches the person asking, in the shell's one shape. Nothing is copied: an
 * item's state is the ask's, the change's or the record's own row, so the
 * Inbox can never disagree with People.
 *
 * - Details somebody asked them for are tasks with the fields inline (C1);
 *   finished, sent back or cancelled, receipts in Done (Z2's cancelled one
 *   stays in To do, dimmed, for the day it was cancelled).
 * - A national identifier HR sent back is a task to correct it (C2).
 * - Their own changes waiting for HR are requests (E1); decided ones are an
 *   update for 30 days and a receipt in Done (D3).
 * - What they asked of others is one request per batch, with progress (H4);
 *   each answer is an update for them.
 * - HR's queues are one bundled task with a count (G2).
 * - A record still missing what the person fills in is a checklist (S1); a
 *   manager with somebody starting soon gets their part of it (G5), and
 *   somebody joining or leaving their team is an update.
 */

const DAY_MS = 86_400_000;
/** How far back asks, changes and team news are read. */
const READ_DAYS = 90;
/** An update stays in Updates this long, then only its receipt is in Done. */
const UPDATE_DAYS = 30;
/** A manager hears about a starter this far ahead, and about news this far back. */
const TEAM_AHEAD_DAYS = 30;
const TEAM_BACK_DAYS = 14;
const TEAM_PAGE = 200;

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const first = (name: string): string => name.split(' ')[0] ?? name;
const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (day: string): string =>
  `${String(Number(day.slice(8, 10)))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ''}`;
const lower = (label: string): string =>
  /^[A-Z][a-z]/u.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
const filled = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

/** The contract's shapes with plain strings where it brands them: read from rows, checked on the wire. */
type Plain<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? Plain<U>[]
    : T extends object
      ? { [K in keyof T]: Plain<T[K]> }
      : T;

/** An item with People's defaults; each kind sets what it says. */
function item(
  fields: Plain<Pick<InboxItem, 'id' | 'lane' | 'kind' | 'title' | 'at' | 'link'>> &
    Partial<Plain<InboxItem>>,
): InboxItem {
  return {
    module: 'people',
    area: null,
    icon: 'user-round',
    tone: null,
    summary: null,
    from: null,
    due: null,
    dueVerb: 'due',
    status: null,
    outcome: null,
    count: null,
    team: null,
    replies: 0,
    openIn: 'People',
    message: null,
    detail: null,
    ...fields,
  } as InboxItem;
}

const ASK_OUTCOME: Record<Exclude<AskState, 'open'>, InboxItem['outcome']> = {
  done: { label: 'Done', tone: 'success' },
  sent_back: { label: 'Sent back', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const CHANGE_OUTCOME = {
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Declined', tone: 'danger' },
  lapsed: { label: 'Lapsed', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
} as const;

const field = (f: RecordField, value: unknown): Plain<InboxField> => ({
  key: f.key,
  label: f.label,
  description: f.description,
  dataType: f.dataType,
  options: f.options.map((o) => ({ value: o.value, label: o.label })),
  required: f.required,
  value: value ?? null,
  sensitive: f.sensitive,
});

/** The queues the Review bundle counts, as HR's Review names and opens them. */
const QUEUES = [
  { key: 'changes', label: 'Changes to decide', link: '/people/review/waiting' },
  { key: 'identifiers', label: 'Identifiers to check', link: '/people/review/waiting' },
  { key: 'duplicates', label: 'Possible duplicates', link: '/people/review/waiting' },
  { key: 'accessRequests', label: 'Requests for full values', link: '/people/review/waiting' },
  { key: 'exports', label: 'Exports to approve', link: '/people/review/waiting' },
] as const;
const QUEUE_BY = {
  changes: null,
  identifiers: 'identifiersBy',
  duplicates: 'duplicatesBy',
  accessRequests: 'accessRequestsBy',
  exports: 'exportsBy',
} as const;

/** The checklist steps a manager has for somebody starting (G5); ticked in the Inbox. */
const WELCOME_STEPS = (name: string) => [
  { key: 'buddy', label: 'Pick a buddy', note: null },
  { key: 'one-to-one', label: `Book your first 1:1 with ${first(name)}`, note: null },
  { key: 'channels', label: `Add ${first(name)} to the team channels`, note: null },
];

export async function peopleInbox(
  deps: ScreenDeps,
  asking: Asking,
  /** HR's queues, counted as the shell's badges count them; absent, no Review row. */
  waiting?: (tx: Tx) => Promise<Result<WaitingView>>,
): Promise<Result<{ readonly items: readonly InboxItem[] }>> {
  // What became of their own changes, read as Review's Decided reads it.
  const decided = await ownDecidedView(deps, asking);
  return run(deps.service, asking.tenantId, async (tx) => {
    const items: InboxItem[] = [];
    const me = asking.viewer.accountId;
    const now = deps.clock.instant();
    const nowMs = Date.parse(now);
    const zone = (await deps.calendars.load(tx, asking.tenantId)).defaultZone;
    const today = localDate(now, zone);
    const since = new Date(nowMs - READ_DAYS * DAY_MS).toISOString();
    const recent = (at: string | null) =>
      at !== null && nowMs - Date.parse(at) < UPDATE_DAYS * DAY_MS;
    const self = await deps.personOf(tx, asking.tenantId, me);

    const asks = deps.asks;
    const forMe =
      asks === undefined || self === null
        ? []
        : await asks.store.forPerson(tx, asking.tenantId, self, since);
    const sent = asks === undefined ? [] : await asks.store.sentBy(tx, asking.tenantId, me, since);
    const thread =
      asks === undefined
        ? []
        : await asks.store.messages(tx, asking.tenantId, [
            ...new Set([...forMe, ...sent].map((a) => a.id)),
          ]);
    const who = await actors(deps, tx, asking, [
      ...[...forMe, ...sent].flatMap((a) => [
        { kind: 'user' as const, userId: a.requestedBy },
        ...(a.closedBy === null ? [] : [{ kind: 'user' as const, userId: a.closedBy }]),
      ]),
      ...thread.map((m) => ({ kind: 'user' as const, userId: m.author })),
    ]);
    const user = (userId: string) => who({ kind: 'user', userId });
    const messagesOf = (askId: string): AskMessage[] => thread.filter((m) => m.askId === askId);

    /* ------------------------------------------------ their own record -- */
    const askedKeys = new Set(forMe.flatMap((a) => a.keys));
    const record =
      self === null
        ? null
        : await ownRecord(
            deps,
            tx,
            asking,
            self,
            (d) => d.collectAt !== 'hr_only' || askedKeys.has(d.key),
          );
    const own = record?.ok === true ? record.value : null;
    const values = own === null ? {} : formValues(own.view, own.sections);
    const fields = new Map(
      (own?.sections ?? []).flatMap((s) => s.fields.map((f) => [f.key, f] as const)),
    );
    const labelOf = new Map(
      (own?.version.document.attributes ?? []).map((d) => [d.key as string, d.label.default]),
    );
    const label = (key: string) => labelOf.get(key) ?? fields.get(key)?.label ?? key;

    for (const ask of forMe) {
      // Every field it asked for holds a value, however it got there: done.
      const state: AskState =
        ask.state === 'open' && ask.keys.every((k) => filled(own?.view.attributes[k]))
          ? 'done'
          : ask.state;
      const labels = ask.keys.map(label);
      const from = user(ask.requestedBy);
      const cancelledToday =
        state === 'cancelled' && ask.closedAt !== null && localDate(ask.closedAt, zone) === today;
      const messages = messagesOf(ask.id);
      const detail: Plain<PeopleDetailsDetail> = {
        askId: ask.id,
        personId: ask.personId,
        fields: ask.keys.flatMap((k) => {
          const f = fields.get(k);
          return f === undefined ? [] : [field(f, values[k])];
        }),
        state,
        reason: ask.reason,
        note: ask.note,
        closedBy: ask.closedBy === null ? null : user(ask.closedBy),
        closedAt: ask.closedAt,
        thread: messages.map((m) => ({
          author: user(m.author),
          mine: m.author === me,
          body: m.body,
          at: m.at,
        })),
        events: [
          { icon: 'plus', text: `${first(from)} asked`, at: ask.requestedAt },
          ...(ask.closedAt === null
            ? []
            : [
                {
                  icon: state === 'done' ? 'check' : state === 'sent_back' ? 'undo-2' : 'x',
                  text:
                    state === 'done'
                      ? 'You added them'
                      : state === 'sent_back'
                        ? 'You sent it back'
                        : `${first(user(ask.closedBy ?? ask.requestedBy))} cancelled it`,
                  at: ask.closedAt,
                },
              ]),
        ],
      };
      const open = state === 'open' || cancelledToday;
      items.push(
        item({
          id: `people:details:${ask.id}`,
          lane: open ? 'task' : 'done',
          kind: 'people.details',
          area: 'Details',
          icon: 'user-round-pen',
          title:
            labels.length === 1
              ? `Add your ${lower(labels[0] ?? '')}`
              : `Add ${String(labels.length)} details for ${first(from)}`,
          summary: labels.join(', '),
          from: { name: from, personId: null },
          at: ask.closedAt !== null && !open ? ask.closedAt : ask.requestedAt,
          due: open && state === 'open' ? ask.dueOn : null,
          status: cancelledToday ? { label: `Cancelled by ${first(from)}`, tone: 'neutral' } : null,
          outcome: state === 'open' ? null : ASK_OUTCOME[state],
          replies: messages.filter((m) => m.author !== me).length,
          link: '/people/me',
          message: ask.message,
          detail,
        }),
      );
    }

    // C2: a national identifier HR sent back, to correct; one with HR is a request.
    for (const review of own?.reviews ?? []) {
      const f = fields.get(review.key);
      if (review.state === 'sent_back' && f !== undefined) {
        const detail: Plain<PeopleCorrectDetail> = {
          personId: self ?? '',
          field: field(f, null),
          findings: review.findings.map((x) => ({
            level: x.level,
            code: x.code,
            message: x.message,
          })),
          note: review.note,
        };
        items.push(
          item({
            id: `people:correct:${review.key}`,
            lane: 'task',
            kind: 'people.correct',
            area: 'Identity',
            icon: 'id-card',
            tone: 'warning',
            title: `Correct your ${review.label}`,
            summary: review.note ?? review.findings[0]?.message ?? 'HR sent it back',
            from: { name: 'HR', personId: null },
            at: now,
            link: '/people/me',
            message: review.note,
            detail,
          }),
        );
      } else if (review.state === 'pending') {
        items.push(
          item({
            id: `people:identifier:${review.key}`,
            lane: 'request',
            kind: 'people.identifier',
            area: 'Identity',
            icon: 'id-card',
            title: `Check your ${review.label}`,
            summary: 'HR checks it against your document',
            at: now,
            status: { label: 'With HR', tone: 'warning' },
            link: '/people/me',
          }),
        );
      }
    }

    /* --------------------------------------------- their own changes -- */
    const pending = deps.service.pending;
    const waitingChanges =
      pending === undefined
        ? []
        : await pending.store.open(tx, asking.tenantId, { requestedBy: me, limit: 50 });
    const nudged =
      asks === undefined
        ? new Map<string, string>()
        : await asks.store.nudges(
            tx,
            asking.tenantId,
            waitingChanges.map((c) => c.approval.id),
          );
    const definitions = own?.version.document.attributes ?? [];
    for (const c of waitingChanges) {
      const person = await deps.service.access.read(tx, { ...asking, personId: c.personId });
      const definition = definitions.find((d) => d.key === c.attributeKey);
      const readable =
        person.ok &&
        definition !== undefined &&
        visibleTo(
          definition,
          await deps.relations.relations(tx, asking.tenantId, asking.viewer, c.personId),
        );
      const name = (person.ok ? nameOf(person.value.attributes) : null) ?? 'Unnamed';
      const mine = c.personId === self;
      const fieldLabel = label(c.attributeKey);
      const at = c.approval.requestedAt;
      const days = Math.max(0, Math.floor((nowMs - Date.parse(at)) / DAY_MS));
      const detail: Plain<PeopleChangeDetail> = {
        changeId: c.approval.id,
        personId: c.personId,
        personName: name,
        label: fieldLabel,
        before: person.ok && readable ? toForm(person.value.attributes[c.attributeKey]) : null,
        after: readable ? toForm(c.sealed ? { last4: c.last4 } : c.value) : null,
        effectiveFrom: c.effectiveFrom,
        state: 'pending',
        steps: [
          { label: 'Sent', state: 'done', note: null },
          {
            label: 'HR decides',
            state: 'current',
            note: days === 0 ? 'Today' : `${String(days)} day${days === 1 ? '' : 's'} so far`,
          },
          {
            label: mine ? 'On your record' : 'On the record',
            state: 'todo',
            note: 'From the day it is approved',
          },
        ],
        by: null,
        note: null,
        nudge: {
          from: new Date(Date.parse(at) + CHANGE_NUDGE_AFTER_MS).toISOString(),
          used: nudged.has(c.approval.id),
        },
      };
      items.push(
        item({
          id: `people:change:${c.approval.id}`,
          lane: 'request',
          kind: 'people.change',
          area: definition?.sectionKey === undefined ? null : 'Profile',
          icon: 'pencil-line',
          title: mine
            ? `Change your ${lower(fieldLabel)}`
            : `Change ${name}'s ${lower(fieldLabel)}`,
          summary: c.approval.reason === '' ? null : c.approval.reason,
          at,
          status: { label: 'With HR', tone: 'warning' },
          link: mine ? '/people/me' : `/people/${c.personId}`,
          detail,
        }),
      );
    }

    for (const c of decided.ok ? decided.value.changes : []) {
      const state = c.state === 'pending' ? null : c.state;
      if (state === null || c.decidedAt === null) continue;
      const mine = c.personId === self;
      const detail: Plain<PeopleChangeDetail> = {
        changeId: c.id,
        personId: c.personId,
        personName: c.name,
        label: c.label,
        before: c.before ?? null,
        after: c.value,
        effectiveFrom: c.effectiveFrom,
        state,
        steps: [
          { label: 'Sent', state: 'done', note: null },
          {
            label:
              state === 'approved'
                ? `${first(c.decidedBy ?? 'HR')} approved`
                : state === 'rejected'
                  ? `${first(c.decidedBy ?? 'HR')} declined`
                  : CHANGE_OUTCOME[state].label,
            state: 'done',
            note: null,
          },
          ...(state === 'approved'
            ? [
                {
                  label: 'On the record from',
                  state: 'done' as const,
                  note: dayLabel(c.effectiveFrom),
                },
              ]
            : []),
        ],
        by: c.decidedBy,
        note: c.note,
        nudge: null,
      };
      const what = mine ? `your ${lower(c.label)}` : `${c.name}'s ${lower(c.label)}`;
      const base = {
        kind: 'people.change',
        area: 'Profile',
        icon: 'pencil-line',
        at: c.decidedAt,
        link: mine ? '/people/me' : `/people/${c.personId}`,
        detail,
      } as const;
      if ((state === 'approved' || state === 'rejected') && recent(c.decidedAt)) {
        items.push(
          item({
            ...base,
            id: `people:decided:${c.id}`,
            lane: 'update',
            tone: state === 'approved' ? 'success' : 'danger',
            title: `${first(c.decidedBy ?? 'HR')} ${state === 'approved' ? 'approved' : 'declined'} your change to ${what}`,
            summary: c.note === null ? null : `“${c.note}”`,
            from: c.decidedBy === null ? null : { name: c.decidedBy, personId: null },
            message: c.note,
          }),
        );
      }
      items.push(
        item({
          ...base,
          id: `people:change:${c.id}`,
          lane: 'done',
          title: `Change ${what}`,
          summary:
            state === 'withdrawn'
              ? 'You withdrew it'
              : state === 'lapsed'
                ? 'Nobody decided it in 7 days'
                : `${CHANGE_OUTCOME[state].label} by ${first(c.decidedBy ?? 'HR')}`,
          outcome: CHANGE_OUTCOME[state],
        }),
      );
    }

    for (const r of decided.ok ? decided.value.identifiers : []) {
      if (r.outcome !== 'accepted') continue;
      const base = {
        kind: 'people.identifier',
        area: 'Identity',
        icon: 'id-card',
        at: r.decidedAt,
        link: '/people/me',
      } as const;
      if (recent(r.decidedAt)) {
        items.push(
          item({
            ...base,
            id: `people:accepted:${r.label}`,
            lane: 'update',
            tone: 'success',
            title: `HR accepted your ${r.label}`,
            from: { name: r.decidedBy, personId: null },
          }),
        );
      }
      items.push(
        item({
          ...base,
          id: `people:identifier:${r.label}`,
          lane: 'done',
          title: `Check your ${r.label}`,
          summary: `Accepted by ${first(r.decidedBy)}`,
          outcome: { label: 'Accepted', tone: 'success' },
        }),
      );
    }

    /* ------------------------------------------- what they asked for -- */
    const batches = new Map<string, DetailAsk[]>();
    for (const a of sent) batches.set(a.batchId, [...(batches.get(a.batchId) ?? []), a]);
    for (const [batchId, batch] of batches) {
      const head = batch[0];
      if (head === undefined) continue;
      const people = [];
      for (const a of batch) {
        const read = await deps.service.access.read(tx, { ...asking, personId: a.personId });
        const attributes = read.ok ? read.value.attributes : {};
        const state: AskState =
          a.state === 'open' && a.keys.every((k) => filled(attributes[k])) ? 'done' : a.state;
        const personName = nameOf(attributes) ?? 'A colleague';
        people.push({
          askId: a.id,
          personId: a.personId,
          name: personName,
          state,
          note: a.note,
          replies: messagesOf(a.id).filter((m) => m.author !== me).length,
        });
        // Each answer is news for whoever asked (C8's "Ada gets an update").
        if (state !== 'open' && state !== 'cancelled' && recent(a.closedAt ?? null)) {
          items.push(
            item({
              id: `people:answered:${a.id}`,
              lane: 'update',
              kind: 'people.answered',
              area: 'Details',
              icon: state === 'done' ? 'user-round-check' : 'undo-2',
              tone: state === 'done' ? 'success' : null,
              title:
                state === 'done'
                  ? `${personName} added what you asked for`
                  : `${personName} sent your request back`,
              summary: state === 'done' ? a.keys.map(label).join(', ') : a.note,
              from: { name: personName, personId: a.personId },
              at: a.closedAt ?? a.requestedAt,
              link: `/people/${a.personId}`,
              message: state === 'sent_back' ? a.note : null,
            }),
          );
        }
      }
      // Questions on what they asked: news too, one per thread, the newest.
      for (const a of batch) {
        const last = messagesOf(a.id).at(-1);
        if (last !== undefined && last.author !== me && a.state === 'open') {
          items.push(
            item({
              id: `people:question:${a.id}`,
              lane: 'update',
              kind: 'people.question',
              area: 'Details',
              icon: 'message-circle',
              title: `${user(last.author)} asked about your request`,
              summary: last.body,
              from: { name: user(last.author), personId: a.personId },
              at: last.at,
              link: `/people/${a.personId}`,
            }),
          );
        }
      }
      const labels = [...new Set(batch.flatMap((a) => a.keys))].map(label);
      const done = people.filter((p) => p.state === 'done' || p.state === 'sent_back').length;
      const live = people.filter((p) => p.state === 'open').length;
      const detail: Plain<PeopleAskedDetail> = {
        batchId,
        labels,
        total: people.length,
        done,
        people,
      };
      const whom =
        people.length === 1
          ? (people[0]?.name ?? 'A colleague')
          : `${String(people.length)} people`;
      items.push(
        item({
          id: `people:asked:${batchId}`,
          lane: live > 0 ? 'request' : 'done',
          kind: 'people.asked',
          area: 'Details',
          icon: 'send',
          title:
            labels.length === 1
              ? `Add ${lower(labels[0] ?? '')}`
              : `Add ${String(labels.length)} details`,
          summary: `You asked ${whom}`,
          at: head.requestedAt,
          due: live > 0 ? head.dueOn : null,
          status:
            live > 0
              ? { label: `${String(done)} of ${String(people.length)} done`, tone: 'warning' }
              : null,
          outcome:
            live > 0
              ? null
              : people.every((p) => p.state === 'cancelled')
                ? ASK_OUTCOME.cancelled
                : ASK_OUTCOME.done,
          link:
            people.length === 1 ? `/people/${people[0]?.personId ?? ''}` : '/people/directory/list',
          message: head.message,
          detail,
        }),
      );
    }

    /* ----------------------------------------------------- checklists -- */
    if (own !== null && self !== null) {
      const hired = text(own.view.attributes['hire_date'])?.slice(0, 10) ?? null;
      const starting = hired !== null && hired > today;
      const steps = own.sections
        .filter((s) => s.fields.some((f) => !f.readOnly && f.required))
        .map((s) => {
          const done = s.fields.every((f) => f.readOnly || !f.required || values[f.key] != null);
          return {
            key: s.key,
            label: `Fill in ${lower(s.label)}`,
            note: null,
            done,
            section: s.key,
            link: null,
          };
        });
      if (steps.some((s) => !s.done)) {
        const detail: Plain<PeopleChecklistDetail> = {
          personId: self,
          personName: nameOf(own.view.attributes) ?? 'You',
          steps,
          others: [],
        };
        items.push(
          item({
            id: `people:onboarding:${self}`,
            lane: 'task',
            kind: 'people.checklist',
            area: 'Onboarding',
            icon: 'list-checks',
            title: starting ? 'Before your first day' : 'Finish your profile',
            summary: `${String(steps.filter((s) => s.done).length)} of ${String(steps.length)} done`,
            at: now,
            due: starting ? hired : null,
            link: '/people/onboarding',
            detail,
          }),
        );
      }
    }

    // A manager's team: somebody starting soon is their part of the checklist (G5); joining or leaving is news.
    if (self !== null) {
      const reports = await deps.service.access.list(tx, {
        ...asking,
        where: { [REPORTS_TO]: self },
        limit: TEAM_PAGE,
      });
      for (const p of reports.ok ? reports.value.items : []) {
        const name = nameOf(p.attributes) ?? 'Someone';
        const hired = text(p.attributes['hire_date'])?.slice(0, 10) ?? null;
        const leaving = text(p.attributes['last_working_day'])?.slice(0, 10) ?? null;
        const near = (day: string | null) =>
          day !== null &&
          day >= addDays(today, -TEAM_BACK_DAYS) &&
          day <= addDays(today, TEAM_AHEAD_DAYS);
        if (hired !== null && near(hired)) {
          items.push(
            item({
              id: `people:joins:${p.id}`,
              lane: 'update',
              kind: 'people.team',
              area: 'Your team',
              icon: 'user-round-plus',
              title:
                hired > today
                  ? `${name} joins your team on ${dayLabel(hired)}`
                  : `${name} joined your team`,
              from: { name, personId: p.id },
              at: `${addDays(hired, -TEAM_AHEAD_DAYS) < today ? today : hired}T00:00:00.000Z`,
              link: `/people/${p.id}`,
            }),
          );
          if (hired > today) {
            const detail: Plain<PeopleChecklistDetail> = {
              personId: p.id,
              personName: name,
              steps: WELCOME_STEPS(name).map((s) => ({
                ...s,
                done: false,
                section: null,
                link: null,
              })),
              others: [],
            };
            items.push(
              item({
                id: `people:welcome:${p.id}`,
                lane: 'task',
                kind: 'people.checklist',
                area: 'Onboarding',
                icon: 'list-checks',
                title: `Get ready for ${first(name)}`,
                summary: `Starts ${dayLabel(hired)}`,
                at: `${today}T00:00:00.000Z`,
                due: addDays(hired, -1),
                link: `/people/${p.id}`,
                detail,
              }),
            );
          }
        }
        if (leaving !== null && near(leaving)) {
          items.push(
            item({
              id: `people:leaves:${p.id}`,
              lane: 'update',
              kind: 'people.team',
              area: 'Your team',
              icon: 'user-round-minus',
              title:
                leaving >= today
                  ? `${name}'s last day is ${dayLabel(leaving)}`
                  : `${name} left your team`,
              from: { name, personId: p.id },
              at: `${leaving < today ? leaving : today}T00:00:00.000Z`,
              link: `/people/${p.id}`,
            }),
          );
        }
      }
    }

    /* --------------------------------------------------- HR's queues -- */
    const queues = waiting === undefined ? null : await waiting(tx);
    if (queues?.ok === true) {
      const q = queues.value;
      const rows = QUEUES.flatMap((d) => {
        const count = q[d.key];
        const byKey = QUEUE_BY[d.key];
        return count === null || count === 0
          ? []
          : [{ ...d, count, by: byKey === null ? [] : [...(q[byKey] ?? [])].slice(0, 3) }];
      });
      const total = rows.reduce((n, r) => n + r.count, 0);
      if (total > 0) {
        const detail: Plain<PeopleReviewDetail> = {
          queues: rows.map((r) => ({
            key: r.key,
            label: r.label,
            count: r.count,
            by: r.by,
            link: r.link,
          })),
        };
        items.push(
          item({
            id: 'people:review:queue',
            lane: 'task',
            kind: 'people.review',
            area: 'Review',
            icon: 'inbox',
            title: `${String(total)} waiting for you in Review`,
            summary: rows.map((r) => `${String(r.count)} ${lower(r.label)}`).join(' · '),
            at: now,
            count: total,
            link: '/people/review/waiting',
            openIn: 'Review',
            detail,
          }),
        );
      }
    }

    // Imports they approved: one that stopped is theirs to look at, one that finished is news.
    const imports =
      deps.importNotices === undefined
        ? []
        : await deps.importNotices(tx, asking.tenantId, me, now);
    for (const n of imports) {
      const failed = n.status === 'failed';
      const lane = recent(n.finishedAt) ? (failed ? 'task' : 'update') : 'done';
      items.push(
        item({
          id: `people:import:${n.id}`,
          lane,
          kind: 'people.import',
          area: 'Import',
          icon: failed ? 'triangle-alert' : 'file-up',
          tone: failed ? 'danger' : 'success',
          title: failed
            ? `Your import ${n.fileName ?? ''} stopped`.replace('  ', ' ')
            : `Your import finished: ${String(n.people)} people`,
          summary: n.fileName,
          at: n.finishedAt,
          outcome:
            lane !== 'done'
              ? null
              : failed
                ? { label: 'Stopped', tone: 'danger' }
                : { label: 'Imported', tone: 'success' },
          link: '/people/import',
        }),
      );
    }

    return ok({ items });
  });
}
