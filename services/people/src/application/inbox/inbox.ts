import { localDate, ok, type Result } from '@kithena/domain-kit';
import type {
  InboxField,
  InboxItem,
  PeopleAskedDetail,
  PeopleChangeDetail,
  PeopleChecklistDetail,
  PeopleDocumentDetail,
  PeopleIntegrationDetail,
  PeopleCorrectDetail,
  PeopleDetailsDetail,
  PeopleReviewDetail,
} from '@kithena/contracts';

import { visibleTo } from '../../domain/access/field-access.js';
import { REPORTS_TO, type Asking } from '../person/person-access.js';
import { readerLocale, t } from '../reader-words.js';
import { run } from '../person/service.js';
import { actors, ownDecidedView, ownRecord } from '../screens/people.js';
import { formValues, nameOf, toForm, type ScreenDeps, type Tx } from '../screens/record.js';
import type { RecordField } from '../screens/model.js';
import type { WaitingView } from '../screens/waiting.js';
import type { TransferHistory } from '../screens/transfers.js';
import type { SentDocument } from './documents.js';
import { FAILURES_FOR_A_TASK } from './team.js';
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
/** "3 Nov", in the reader's language. */
const dayLabel = (day: string): string =>
  new Intl.DateTimeFormat(readerLocale(), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
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
    icon: 'person',
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
    openIn: t('inbox.inbox.people', 'People'),
    message: null,
    detail: null,
    ...fields,
  } as InboxItem;
}

const ASK_OUTCOME = (): Record<Exclude<AskState, 'open'>, InboxItem['outcome']> => ({
  done: { label: t('inbox.inbox.done', 'Done'), tone: 'success' },
  sent_back: { label: t('inbox.inbox.sent_back', 'Sent back'), tone: 'neutral' },
  cancelled: { label: t('inbox.inbox.cancelled', 'Cancelled'), tone: 'neutral' },
});

const CHANGE_OUTCOME = () =>
  ({
    approved: { label: t('inbox.inbox.approved', 'Approved'), tone: 'success' },
    rejected: { label: t('inbox.inbox.declined', 'Declined'), tone: 'danger' },
    lapsed: { label: t('inbox.inbox.lapsed', 'Lapsed'), tone: 'neutral' },
    withdrawn: { label: t('inbox.inbox.withdrawn', 'Withdrawn'), tone: 'neutral' },
  }) as const;

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
const QUEUES = () =>
  [
    {
      key: 'changes',
      label: t('inbox.inbox.changes_to_decide', 'Changes to decide'),
      link: '/people/review/waiting',
    },
    {
      key: 'identifiers',
      label: t('inbox.inbox.identifiers_to_check', 'Identifiers to check'),
      link: '/people/review/waiting',
    },
    {
      key: 'duplicates',
      label: t('inbox.inbox.possible_duplicates', 'Possible duplicates'),
      link: '/people/review/waiting',
    },
    {
      key: 'accessRequests',
      label: t('inbox.inbox.requests_for_full_values', 'Requests for full values'),
      link: '/people/review/waiting',
    },
    {
      key: 'exports',
      label: t('inbox.inbox.exports_to_approve', 'Exports to approve'),
      link: '/people/review/waiting',
    },
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
  { key: 'buddy', label: t('inbox.inbox.pick_a_buddy', 'Pick a buddy'), note: null },
  {
    key: 'one-to-one',
    label: t('inbox.inbox.book_your_first_1_1_with', 'Book your first 1:1 with {{name}}', {
      name: first(name),
    }),
    note: null,
  },
  {
    key: 'channels',
    label: t('inbox.inbox.add_to_the_team_channels', 'Add {{name}} to the team channels', {
      name: first(name),
    }),
    note: null,
  },
];

export async function peopleInbox(
  deps: ScreenDeps & { readonly transfers?: TransferHistory },
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
          { icon: 'add', text: `${first(from)} asked`, at: ask.requestedAt },
          ...(ask.closedAt === null
            ? []
            : [
                {
                  icon: state === 'done' ? 'confirm' : state === 'sent_back' ? 'undo' : 'close',
                  text:
                    state === 'done'
                      ? t('inbox.inbox.you_added_them', 'You added them')
                      : state === 'sent_back'
                        ? t('inbox.inbox.you_sent_it_back', 'You sent it back')
                        : t('inbox.inbox.cancelled_it', '{{closedBy}} cancelled it', {
                            closedBy: first(user(ask.closedBy ?? ask.requestedBy)),
                          }),
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
          area: t('inbox.inbox.details', 'Details'),
          icon: 'edit',
          title:
            labels.length === 1
              ? t('inbox.inbox.add_your', 'Add your {{labels}}', { labels: lower(labels[0] ?? '') })
              : t('inbox.inbox.add_details_for', 'Add {{count}} details for {{from}}', {
                  count: String(labels.length),
                  from: first(from),
                }),
          summary: labels.join(', '),
          from: { name: from, personId: null },
          at: ask.closedAt !== null && !open ? ask.closedAt : ask.requestedAt,
          due: open && state === 'open' ? ask.dueOn : null,
          status: cancelledToday
            ? {
                label: t('inbox.inbox.cancelled_by', 'Cancelled by {{from}}', {
                  from: first(from),
                }),
                tone: 'neutral',
              }
            : null,
          outcome: state === 'open' ? null : ASK_OUTCOME()[state],
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
            area: t('inbox.inbox.identity', 'Identity'),
            icon: 'identifier',
            tone: 'warning',
            title: t('inbox.inbox.correct_your', 'Correct your {{label}}', { label: review.label }),
            summary:
              review.note ??
              review.findings[0]?.message ??
              t('inbox.inbox.hr_sent_it_back', 'HR sent it back'),
            from: { name: t('inbox.inbox.hr', 'HR'), personId: null },
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
            area: t('inbox.inbox.identity', 'Identity'),
            icon: 'identifier',
            title: t('inbox.inbox.check_your', 'Check your {{label}}', { label: review.label }),
            summary: t(
              'inbox.inbox.hr_checks_it_against_your_document',
              'HR checks it against your document',
            ),
            at: now,
            status: { label: t('inbox.inbox.with_hr', 'With HR'), tone: 'warning' },
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
      const name =
        (person.ok ? nameOf(person.value.attributes) : null) ?? t('inbox.inbox.unnamed', 'Unnamed');
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
          { label: t('inbox.inbox.sent', 'Sent'), state: 'done', note: null },
          {
            label: t('inbox.inbox.hr_decides', 'HR decides'),
            state: 'current',
            note:
              days === 0
                ? t('inbox.inbox.today', 'Today')
                : t(
                    'inbox.inbox.days_so_far',
                    { one: '{{count}} day so far', other: '{{count}} days so far' },
                    { count: days },
                  ),
          },
          {
            label: mine
              ? t('inbox.inbox.on_your_record', 'On your record')
              : t('inbox.inbox.on_the_record', 'On the record'),
            state: 'todo',
            note: t('inbox.inbox.from_the_day_it_is_approved', 'From the day it is approved'),
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
          area: definition?.sectionKey === undefined ? null : t('inbox.inbox.profile', 'Profile'),
          icon: 'edit',
          title: mine
            ? t('inbox.inbox.change_your', 'Change your {{fieldLabel}}', {
                fieldLabel: lower(fieldLabel),
              })
            : t('inbox.inbox.change_s', "Change {{name}}'s {{fieldLabel}}", {
                name,
                fieldLabel: lower(fieldLabel),
              }),
          summary: c.approval.reason === '' ? null : c.approval.reason,
          at,
          status: { label: t('inbox.inbox.with_hr', 'With HR'), tone: 'warning' },
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
          { label: t('inbox.inbox.sent', 'Sent'), state: 'done', note: null },
          {
            label:
              state === 'approved'
                ? t('inbox.inbox.someone_approved', '{{by}} approved', {
                    by: first(c.decidedBy ?? t('inbox.inbox.hr', 'HR')),
                  })
                : state === 'rejected'
                  ? t('inbox.inbox.someone_declined', '{{by}} declined', {
                      by: first(c.decidedBy ?? t('inbox.inbox.hr', 'HR')),
                    })
                  : CHANGE_OUTCOME()[state].label,
            state: 'done',
            note: null,
          },
          ...(state === 'approved'
            ? [
                {
                  label: t('inbox.inbox.on_the_record_from', 'On the record from'),
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
      const field = lower(c.label);
      const base = {
        kind: 'people.change',
        area: t('inbox.inbox.profile', 'Profile'),
        icon: 'edit',
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
            title:
              state === 'approved'
                ? mine
                  ? t(
                      'inbox.inbox.approved_your_change_to_your',
                      '{{by}} approved your change to your {{field}}',
                      { by: first(c.decidedBy ?? t('inbox.inbox.hr', 'HR')), field },
                    )
                  : t(
                      'inbox.inbox.approved_your_change_to_theirs',
                      '{{by}} approved your change to {{name}}’s {{field}}',
                      { by: first(c.decidedBy ?? t('inbox.inbox.hr', 'HR')), name: c.name, field },
                    )
                : mine
                  ? t(
                      'inbox.inbox.declined_your_change_to_your',
                      '{{by}} declined your change to your {{field}}',
                      { by: first(c.decidedBy ?? t('inbox.inbox.hr', 'HR')), field },
                    )
                  : t(
                      'inbox.inbox.declined_your_change_to_theirs',
                      '{{by}} declined your change to {{name}}’s {{field}}',
                      { by: first(c.decidedBy ?? t('inbox.inbox.hr', 'HR')), name: c.name, field },
                    ),
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
          title: mine
            ? t('inbox.inbox.change_your', 'Change your {{fieldLabel}}', { fieldLabel: field })
            : t('inbox.inbox.change_s', "Change {{name}}'s {{fieldLabel}}", {
                name: c.name,
                fieldLabel: field,
              }),
          summary:
            state === 'withdrawn'
              ? t('inbox.inbox.you_withdrew_it', 'You withdrew it')
              : state === 'lapsed'
                ? t('inbox.inbox.nobody_decided_it_in_7_days', 'Nobody decided it in 7 days')
                : t('inbox.inbox.outcome_by', '{{outcome}} by {{by}}', {
                    outcome: CHANGE_OUTCOME()[state].label,
                    by: first(c.decidedBy ?? t('inbox.inbox.hr', 'HR')),
                  }),
          outcome: CHANGE_OUTCOME()[state],
        }),
      );
    }

    for (const r of decided.ok ? decided.value.identifiers : []) {
      if (r.outcome !== 'accepted') continue;
      const base = {
        kind: 'people.identifier',
        area: t('inbox.inbox.identity', 'Identity'),
        icon: 'identifier',
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
            title: t('inbox.inbox.hr_accepted_your', 'HR accepted your {{label}}', {
              label: r.label,
            }),
            from: { name: r.decidedBy, personId: null },
          }),
        );
      }
      items.push(
        item({
          ...base,
          id: `people:identifier:${r.label}`,
          lane: 'done',
          title: t('inbox.inbox.check_your', 'Check your {{label}}', { label: r.label }),
          summary: t('inbox.inbox.accepted_by', 'Accepted by {{decidedBy}}', {
            decidedBy: first(r.decidedBy),
          }),
          outcome: { label: t('inbox.inbox.accepted', 'Accepted'), tone: 'success' },
        }),
      );
    }

    /* ------------------------------------------------------ documents -- */
    const docs = deps.documents;
    const mineDocs =
      docs === undefined || self === null
        ? []
        : await docs.store.forPerson(tx, asking.tenantId, self);
    const outDocs =
      docs === undefined ? [] : await docs.store.involving(tx, asking.tenantId, me, since);
    const docPeople = new Map<string, string>();
    for (const d of outDocs) {
      if (docPeople.has(d.personId)) continue;
      const read = await deps.service.access.read(tx, { ...asking, personId: d.personId });
      docPeople.set(
        d.personId,
        (read.ok ? nameOf(read.value.attributes) : null) ??
          t('inbox.inbox.a_colleague', 'A colleague'),
      );
    }
    const docWho = await actors(
      deps,
      tx,
      asking,
      [...mineDocs, ...outDocs].flatMap((d) => [
        { kind: 'user' as const, userId: d.sentBy },
        ...(d.countersigner === null ? [] : [{ kind: 'user' as const, userId: d.countersigner }]),
      ]),
    );
    const docUser = (id: string) => docWho({ kind: 'user', userId: id });
    const docDetail = (
      d: SentDocument,
      personName: string,
      action: Plain<PeopleDocumentDetail>['action'],
    ): Plain<PeopleDocumentDetail> => ({
      documentId: d.id,
      name: d.name,
      mediaType: d.mediaType,
      size: d.size,
      mode: d.mode,
      state: d.state,
      personName,
      sentBy: docUser(d.sentBy),
      countersigner: d.countersigner === null ? null : docUser(d.countersigner),
      signature: d.signature,
      countersigned:
        d.countersignedName === null || d.countersignedAt === null
          ? null
          : { name: d.countersignedName, at: d.countersignedAt },
      note: d.note,
      action,
    });
    const DOC_OUTCOME = {
      kept: { label: t('inbox.inbox.kept', 'Kept'), tone: 'neutral' },
      acknowledged: { label: t('inbox.inbox.acknowledged', 'Acknowledged'), tone: 'success' },
      signed: { label: t('inbox.inbox.signed', 'Signed'), tone: 'success' },
      countersigned: { label: t('inbox.inbox.signed', 'Signed'), tone: 'success' },
      declined: { label: t('inbox.inbox.sent_back', 'Sent back'), tone: 'neutral' },
      cancelled: { label: t('inbox.inbox.cancelled', 'Cancelled'), tone: 'neutral' },
    } as const;
    const myName =
      own === null
        ? t('inbox.inbox.you', 'You')
        : (nameOf(own.view.attributes) ?? t('inbox.inbox.you', 'You'));
    for (const d of mineDocs) {
      const from = docUser(d.sentBy);
      const base = {
        id: `people:document:${d.id}`,
        kind: 'people.document',
        area: t('inbox.inbox.documents', 'Documents'),
        icon: d.mode === 'sign' ? 'document' : 'file',
        from: { name: from, personId: null },
        link: '/people/me',
        message: d.message,
      } as const;
      if (d.mode === 'keep') {
        items.push(
          item({
            ...base,
            lane: recent(d.sentAt) ? 'update' : 'done',
            title: `${first(from)} shared ${d.name}`,
            summary: t(
              'inbox.inbox.also_kept_in_your_profile_under',
              'Also kept in your profile under Documents',
            ),
            at: d.sentAt,
            outcome: recent(d.sentAt) ? null : DOC_OUTCOME.kept,
            detail: docDetail(d, myName, null),
          }),
        );
      } else if (d.state === 'open') {
        items.push(
          item({
            ...base,
            lane: 'task',
            title:
              d.mode === 'sign'
                ? t('inbox.inbox.sign_document', 'Sign {{name}}', { name: d.name })
                : t('inbox.inbox.read_and_acknowledge_document', 'Read and acknowledge {{name}}', {
                    name: d.name,
                  }),
            summary: t('inbox.inbox.sent_it', '{{from}} sent it', { from: first(from) }),
            at: d.sentAt,
            due: d.dueOn,
            detail: docDetail(d, myName, d.mode),
          }),
        );
      } else if (d.state !== 'cancelled') {
        items.push(
          item({
            ...base,
            lane: 'done',
            title:
              d.mode === 'sign'
                ? t('inbox.inbox.sign_document', 'Sign {{name}}', { name: d.name })
                : t('inbox.inbox.read_and_acknowledge_document', 'Read and acknowledge {{name}}', {
                    name: d.name,
                  }),
            summary:
              d.state === 'declined'
                ? t('inbox.inbox.you_sent_it_back', 'You sent it back')
                : d.state === 'acknowledged'
                  ? t('inbox.inbox.you_acknowledged_it', 'You acknowledged it')
                  : t('inbox.inbox.you_signed_it', 'You signed it'),
            at: d.closedAt ?? d.sentAt,
            outcome: DOC_OUTCOME[d.state],
            detail: docDetail(d, myName, null),
          }),
        );
      }
    }
    for (const d of outDocs) {
      const personName = docPeople.get(d.personId) ?? t('inbox.inbox.a_colleague', 'A colleague');
      const link = `/people/${d.personId}`;
      if (d.countersigner === me && d.state === 'signed') {
        items.push(
          item({
            id: `people:countersign:${d.id}`,
            lane: 'task',
            kind: 'people.document',
            area: t('inbox.inbox.documents', 'Documents'),
            icon: 'document',
            title: t('inbox.inbox.countersign', 'Countersign {{name}}', { name: d.name }),
            summary: t('inbox.inbox.signed_it', '{{personName}} signed it', { personName }),
            from: { name: personName, personId: d.personId },
            at: d.signature?.at ?? d.sentAt,
            link,
            detail: docDetail(d, personName, 'countersign'),
          }),
        );
      } else if (d.countersigner === me && d.state === 'countersigned') {
        items.push(
          item({
            id: `people:countersign:${d.id}`,
            lane: 'done',
            kind: 'people.document',
            area: t('inbox.inbox.documents', 'Documents'),
            icon: 'document',
            title: t('inbox.inbox.countersign', 'Countersign {{name}}', { name: d.name }),
            summary: t('inbox.inbox.for', 'For {{personName}}', { personName }),
            at: d.countersignedAt ?? d.sentAt,
            outcome: DOC_OUTCOME.countersigned,
            link,
            detail: docDetail(d, personName, null),
          }),
        );
      }
      if (d.sentBy !== me || d.mode === 'keep') continue;
      const verb = d.mode === 'sign' ? 'sign' : 'acknowledge';
      const open = d.state === 'open';
      items.push(
        item({
          id: `people:sent:${d.id}`,
          lane: open ? 'request' : 'done',
          kind: 'people.document',
          area: t('inbox.inbox.documents', 'Documents'),
          icon: 'send',
          title: `${personName} to ${verb} ${d.name}`,
          summary: open ? t('inbox.inbox.you_sent_it', 'You sent it') : null,
          at: open ? d.sentAt : (d.closedAt ?? d.sentAt),
          due: open ? d.dueOn : null,
          status: open
            ? {
                label: t('inbox.inbox.with', 'With {{personName}}', {
                  personName: first(personName),
                }),
                tone: 'warning',
              }
            : null,
          outcome: d.state === 'open' ? null : DOC_OUTCOME[d.state],
          link,
          detail: docDetail(d, personName, null),
        }),
      );
      if (!open && d.state !== 'cancelled' && recent(d.closedAt)) {
        items.push(
          item({
            id: `people:returned:${d.id}`,
            lane: 'update',
            kind: 'people.document',
            area: t('inbox.inbox.documents', 'Documents'),
            icon: d.state === 'declined' ? 'undo' : 'success',
            tone: d.state === 'declined' ? null : 'success',
            title:
              d.state === 'declined'
                ? `${personName} sent ${d.name} back`
                : `${personName} ${d.state === 'acknowledged' ? 'acknowledged' : 'signed'} ${d.name}`,
            summary: d.note,
            from: { name: personName, personId: d.personId },
            at: d.closedAt ?? d.sentAt,
            message: d.note,
            link,
            detail: docDetail(d, personName, null),
          }),
        );
      }
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
        const personName = nameOf(attributes) ?? t('inbox.inbox.a_colleague', 'A colleague');
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
              area: t('inbox.inbox.details', 'Details'),
              icon: state === 'done' ? 'success' : 'undo',
              tone: state === 'done' ? 'success' : null,
              title:
                state === 'done'
                  ? t(
                      'inbox.inbox.added_what_you_asked_for',
                      '{{personName}} added what you asked for',
                      { personName },
                    )
                  : t(
                      'inbox.inbox.sent_your_request_back',
                      '{{personName}} sent your request back',
                      { personName },
                    ),
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
              area: t('inbox.inbox.details', 'Details'),
              icon: 'message',
              title: t(
                'inbox.inbox.asked_about_your_request',
                '{{author}} asked about your request',
                { author: user(last.author) },
              ),
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
          ? (people[0]?.name ?? t('inbox.inbox.a_colleague', 'A colleague'))
          : `${String(people.length)} people`;
      items.push(
        item({
          id: `people:asked:${batchId}`,
          lane: live > 0 ? 'request' : 'done',
          kind: 'people.asked',
          area: t('inbox.inbox.details', 'Details'),
          icon: 'send',
          title:
            labels.length === 1
              ? t('inbox.inbox.add', 'Add {{labels}}', { labels: lower(labels[0] ?? '') })
              : t('inbox.inbox.add_details', 'Add {{count}} details', {
                  count: String(labels.length),
                }),
          summary: t('inbox.inbox.you_asked', 'You asked {{whom}}', { whom }),
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
                ? ASK_OUTCOME().cancelled
                : ASK_OUTCOME().done,
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
            label: t('inbox.inbox.fill_in', 'Fill in {{label}}', { label: lower(s.label) }),
            note: null,
            done,
            section: s.key,
            link: null,
          };
        });
      if (steps.some((s) => !s.done)) {
        const detail: Plain<PeopleChecklistDetail> = {
          personId: self,
          personName: nameOf(own.view.attributes) ?? t('inbox.inbox.you', 'You'),
          steps,
          others: [],
        };
        items.push(
          item({
            id: `people:onboarding:${self}`,
            lane: 'task',
            kind: 'people.checklist',
            area: t('inbox.inbox.onboarding', 'Onboarding'),
            icon: 'list',
            title: starting
              ? t('inbox.inbox.before_your_first_day', 'Before your first day')
              : t('inbox.inbox.finish_your_profile', 'Finish your profile'),
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
      const direct = reports.ok ? reports.value.items : [];
      // P2: a report's task overdue past the company's threshold is news for their manager.
      const rules =
        deps.inboxRules === undefined ? null : await deps.inboxRules(tx, asking.tenantId);
      const overdue = rules?.overdueDays ?? 7;
      if (overdue > 0 && direct.length > 0) {
        const by = addDays(today, -overdue);
        const ids = direct.map((p) => p.id);
        const lateAsks =
          asks === undefined ? [] : await asks.store.openDueBy(tx, asking.tenantId, ids, by);
        const lateDocs =
          deps.documents === undefined
            ? []
            : await deps.documents.store.openDueBy(tx, asking.tenantId, ids, by);
        const nameOfReport = new Map(
          direct.map((p) => [p.id, nameOf(p.attributes) ?? t('inbox.inbox.someone', 'Someone')]),
        );
        for (const late of [
          ...lateAsks.map((a) => ({
            id: a.id,
            personId: a.personId,
            due: a.dueOn ?? today,
            what: t('inbox.inbox.details_hr_asked_for', 'details HR asked for'),
          })),
          ...lateDocs.map((d) => ({
            id: d.id,
            personId: d.personId,
            due: d.dueOn ?? today,
            what: d.name,
          })),
        ]) {
          const who = nameOfReport.get(late.personId) ?? t('inbox.inbox.someone', 'Someone');
          const daysLate = Math.round(
            (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${late.due}T00:00:00Z`)) / DAY_MS,
          );
          items.push(
            item({
              id: `people:overdue:${late.id}`,
              lane: 'update',
              kind: 'people.overdue',
              area: t('inbox.inbox.your_team', 'Your team'),
              icon: 'warning',
              tone: 'warning',
              title: t(
                'inbox.inbox.s_task_is_days_overdue',
                "{{who}}'s task is {{daysLate}} days overdue",
                { who, daysLate: String(daysLate) },
              ),
              summary: late.what,
              from: { name: who, personId: late.personId },
              at: `${addDays(late.due, overdue)}T00:00:00.000Z`,
              link: `/people/${late.personId}`,
            }),
          );
        }
      }
      for (const p of direct) {
        const name = nameOf(p.attributes) ?? t('inbox.inbox.someone', 'Someone');
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
              area: t('inbox.inbox.your_team', 'Your team'),
              icon: 'hire',
              title:
                hired > today
                  ? t('inbox.inbox.joins_your_team_on', '{{name}} joins your team on {{hired}}', {
                      name,
                      hired: dayLabel(hired),
                    })
                  : t('inbox.inbox.joined_your_team', '{{name}} joined your team', { name }),
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
                area: t('inbox.inbox.onboarding', 'Onboarding'),
                icon: 'list',
                title: t('inbox.inbox.get_ready_for', 'Get ready for {{name}}', {
                  name: first(name),
                }),
                summary: t('inbox.inbox.starts', 'Starts {{hired}}', { hired: dayLabel(hired) }),
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
              area: t('inbox.inbox.your_team', 'Your team'),
              icon: 'offboard',
              title:
                leaving >= today
                  ? t('inbox.inbox.s_last_day_is', "{{name}}'s last day is {{leaving}}", {
                      name,
                      leaving: dayLabel(leaving),
                    })
                  : t('inbox.inbox.left_your_team', '{{name}} left your team', { name }),
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
      const rows = QUEUES().flatMap((d) => {
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
            area: t('inbox.inbox.review', 'Review'),
            icon: 'review',
            title: t(
              'inbox.inbox.waiting_for_you_in_review',
              '{{total}} waiting for you in Review',
              { total: String(total) },
            ),
            summary: rows.map((r) => `${String(r.count)} ${lower(r.label)}`).join(' · '),
            at: now,
            count: total,
            link: '/people/review/waiting',
            openIn: t('inbox.inbox.review', 'Review'),
            detail,
          }),
        );
      }
    }

    /* ----------------------------------------------- hires to set up -- */
    // A hire made from a signed contract is a pre-hire, filled in from it: HR's task
    // until their invitation to sign up is sent or scheduled. The record opens to it.
    const { invitations, preHires } = deps;
    if (invitations !== undefined && preHires !== undefined && asking.viewer.roles.has('hr')) {
      const ids = await preHires(tx, asking.tenantId, TEAM_PAGE);
      const hires = await deps.service.access.readMany(tx, { ...asking, personIds: ids });
      for (const p of hires.ok ? hires.value.values() : []) {
        if ((await invitations.get(tx, asking.tenantId, p.id)) !== null) continue;
        const name = nameOf(p.attributes) ?? t('inbox.inbox.someone', 'Someone');
        const hired = text(p.attributes['hire_date'])?.slice(0, 10) ?? null;
        items.push(
          item({
            id: `people:setup:${p.id}`,
            lane: 'task',
            kind: 'people.setup',
            area: t('inbox.inbox.new_hires', 'New hires'),
            icon: 'user-plus',
            tone: 'accent',
            title: t('inbox.inbox.set_up', 'Set up {{name}}', { name }),
            summary:
              hired === null
                ? t(
                    'inbox.inbox.set_up_hint',
                    'Check the record filled in from their contract, add anything missing, and invite them to sign up.',
                  )
                : t(
                    'inbox.inbox.set_up_hint_dated',
                    'Starts {{date}}. Check the record filled in from their contract, add anything missing, and invite them to sign up.',
                    { date: dayLabel(hired) },
                  ),
            from: { name, personId: p.id },
            at: now,
            due: hired,
            link: `/people/${p.id}`,
          }),
        );
      }
    }

    /* ------------------------------------------------- starts on hold -- */
    // Recruiting PRD §21.3: an open pre-start condition on the start date blocks
    // the start and tells HR. Their task until the condition is met in Recruiting,
    // where the contract page decides it, or the hire is cancelled.
    const { startHolds } = deps;
    if (startHolds !== undefined && asking.viewer.roles.has('hr')) {
      const held = await startHolds.due(tx, asking.tenantId, now.slice(0, 10), TEAM_PAGE);
      const people = await deps.service.access.readMany(tx, {
        ...asking,
        personIds: held.map((h) => h.personId),
      });
      for (const h of held) {
        const p = people.ok ? people.value.get(h.personId) : undefined;
        const name =
          (p === undefined ? null : nameOf(p.attributes)) ?? t('inbox.inbox.someone', 'Someone');
        const open = h.conditions.map((c) => c.replaceAll('_', ' ')).join(', ');
        items.push(
          item({
            id: `people:start-held:${h.applicationId}`,
            lane: 'task',
            kind: 'people.start-held',
            area: t('inbox.inbox.new_hires', 'New hires'),
            icon: 'user-plus',
            tone: 'danger',
            title: t('inbox.inbox.start_held', '{{name}} can’t start yet: {{open}} still open', {
              name,
              open,
            }),
            summary: t(
              'inbox.inbox.start_held_hint',
              'Their start date was {{date}}. Decide the open conditions on their contract in Recruiting; they start the hour after the last one is met.',
              { date: dayLabel(h.startsOn) },
            ),
            from: { name, personId: h.personId },
            at: now,
            due: h.startsOn,
            link:
              h.offerId === null
                ? `/people/${h.personId}`
                : `/recruiting/offers/${h.offerId}/contract`,
          }),
        );
      }
    }

    // H1, Z3: an integration failing is a task for every People administrator; one takes it.
    const team = deps.teamTasks;
    if (team !== undefined && asking.viewer.roles.has('people_admin')) {
      const rules =
        deps.inboxRules === undefined ? null : await deps.inboxRules(tx, asking.tenantId);
      const failing = await team.failing(
        tx,
        asking.tenantId,
        rules?.failuresForATask ?? FAILURES_FOR_A_TASK,
      );
      const ids = failing.map((f) => `people:integration:${f.endpointId}`);
      const claims = await team.claims(tx, asking.tenantId, ids);
      const takers = await actors(
        deps,
        tx,
        asking,
        [...claims.values()].map((c) => ({ kind: 'user' as const, userId: c.by })),
      );
      for (const f of failing) {
        const id = `people:integration:${f.endpointId}`;
        const claim = claims.get(id);
        const host = f.url.replace(/^https:\/\//u, '').split('/')[0] ?? f.url;
        const detail: Plain<PeopleIntegrationDetail> = { ...f, note: claim?.note ?? null };
        items.push(
          item({
            id,
            lane: 'task',
            kind: 'people.integration',
            area: t('inbox.inbox.integrations', 'Integrations'),
            icon: 'system',
            tone: 'danger',
            title: f.disabled
              ? t(
                  'inbox.inbox.webhooks_to_are_switched_off',
                  'Webhooks to {{host}} are switched off',
                  { host },
                )
              : t('inbox.inbox.webhooks_to_keep_failing', 'Webhooks to {{host}} keep failing', {
                  host,
                }),
            summary: t('inbox.inbox.waiting_to_send', '{{waiting}} waiting to send', {
              waiting: String(f.waiting),
            }),
            at: f.since,
            team: {
              role: t('inbox.inbox.all_admins', 'All admins'),
              takenBy:
                claim === undefined
                  ? null
                  : { name: takers({ kind: 'user', userId: claim.by }), personId: null },
              takenAt: claim?.at ?? null,
              mine: claim?.by === me,
            },
            link: `/settings/people/integrations/webhooks/${f.endpointId}`,
            openIn: t('inbox.inbox.integrations', 'Integrations'),
            detail,
          }),
        );
      }
    }

    // An administrator viewed Kithena as them: told once it was over, and kept (decided 2026-09-29).
    const viewed =
      deps.viewedAs === undefined ? [] : await deps.viewedAs(tx, asking.tenantId, me, now);
    for (const v of viewed) {
      const minutes = Math.max(1, Math.round((Date.parse(v.endedAt) - Date.parse(v.at)) / 60_000));
      items.push(
        item({
          id: `people:viewed:${v.id}`,
          lane: recent(v.endedAt) ? 'update' : 'done',
          kind: 'people.viewed',
          area: t('inbox.inbox.privacy', 'Privacy'),
          icon: 'visible',
          title: t('inbox.inbox.viewed_kithena_as_you', '{{by}} viewed Kithena as you', {
            by: v.by ?? t('inbox.inbox.a_people_administrator', 'A People administrator'),
          }),
          summary: v.specialCategory
            ? t(
                'inbox.inbox.viewed_for_sensitive',
                'For {{minutes}} min, read-only: nothing was changed. Your sensitive personal details were visible.',
                { minutes },
              )
            : t('inbox.inbox.viewed_for', 'For {{minutes}} min, read-only: nothing was changed.', {
                minutes,
              }),
          from: { name: v.by, personId: null },
          at: v.endedAt,
          link: '/people/me',
        }),
      );
    }

    // Exports they asked for, ready to download while their links last (INB-024).
    const ledger = deps.transfers;
    if (
      ledger !== undefined &&
      (asking.viewer.roles.has('hr') || asking.viewer.roles.has('people_admin'))
    ) {
      const rows = await ledger.page(tx, asking.tenantId, { before: null, limit: 20 });
      for (const r of rows) {
        if (r.kind !== 'export' || r.actor !== me || r.rowCount === null || r.expiresAt === null)
          continue;
        if (r.expiresAt <= now || !recent(r.at)) continue;
        items.push(
          item({
            id: `people:export:${r.id}`,
            lane: 'update',
            kind: 'people.export',
            area: t('inbox.inbox.export', 'Export'),
            icon: 'download',
            tone: 'success',
            title: t('inbox.inbox.your_export_is_ready', 'Your export is ready'),
            summary: `${String(r.rowCount)} rows · ${r.reason ?? r.fileNames?.[0] ?? r.format ?? 'file'}`,
            at: r.at,
            link: '/people/import-export',
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
          area: t('inbox.inbox.import', 'Import'),
          icon: failed ? 'warning' : 'upload',
          tone: failed ? 'danger' : 'success',
          title: failed
            ? t('inbox.inbox.your_import_stopped', 'Your import {{fileName}} stopped', {
                fileName: n.fileName ?? '',
              }).replace('  ', ' ')
            : t(
                'inbox.inbox.your_import_finished_people',
                'Your import finished: {{people}} people',
                { people: String(n.people) },
              ),
          summary: n.fileName,
          at: n.finishedAt,
          outcome:
            lane !== 'done'
              ? null
              : failed
                ? { label: t('inbox.inbox.stopped', 'Stopped'), tone: 'danger' }
                : { label: t('inbox.inbox.imported', 'Imported'), tone: 'success' },
          link: '/people/import',
        }),
      );
    }

    return ok({ items });
  });
}
