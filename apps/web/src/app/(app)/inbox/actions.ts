'use server';

import { refresh } from 'next/cache';

import { documents, people, recruiting, timeOff } from '../../../lib/people';
import { changed, type InboxState, type Mute } from '../../../lib/inbox/model';
import { changeState, inboxNow } from '../../../lib/inbox/server';
import { answerInbox, type InboxReply } from '../../../lib/inbox/ask';
import { taskScreen, type TaskScreen } from '../../../lib/inbox/task-screen';
import { serverWords } from '../../../lib/server-words';
import { type T } from '@reach/ui';
import type { InboxField } from '@kithena/contracts';

/**
 * What the Inbox's buttons do (INB-004). Two kinds of thing:
 *
 * - The person's own state (read, snoozed, moved to Done, muted, a step
 *   ticked) is written to their account preference, here.
 * - Acting on an item runs the owning module's own operation as the person:
 *   fill in, send back, sign, approve, nudge, take it. The browser chooses
 *   the arguments, never the operation; the module validates them again and
 *   decides whether this person may. Nothing here authorizes anything.
 *
 * Every write answers with the page drawn again (`lib/people.ts` refreshes
 * after a module write; the state writes refresh here), so the lists and the
 * counts are the modules' answer, never a guess.
 */

export type Outcome =
  { readonly ok: true; readonly data?: unknown } | { readonly ok: false; readonly message: string };

const done = (a: { ok: boolean; message?: string; data?: unknown }, t: T): Outcome =>
  a.ok
    ? { ok: true, data: a.data }
    : {
        ok: false,
        message: a.message ?? t('app.app.inbox.actions.that_did_not_work', 'That did not work'),
      };

async function state(change: (s: InboxState) => InboxState, redraw = true): Promise<Outcome> {
  const t = await serverWords();
  const saved = await changeState(change);
  if (saved === 'saved') {
    // Reading is drawn by the page already (it marks what it opened); the
    // rest moves an item between lanes, which only a new answer shows.
    if (redraw) refresh();
    return { ok: true };
  }
  return {
    ok: false,
    message:
      saved === 'view_only'
        ? t(
            'app.app.inbox.actions.viewing_as_somebody_is_read_only',
            'Viewing as somebody is read-only',
          )
        : t('app.app.inbox.actions.that_did_not_save_try_again', 'That did not save; try again'),
  };
}

/* ------------------------------------------------------- your state -- */

/** Opening an update reads it (D1); marked unread again, it is not (D5). */
export async function markRead(ids: readonly string[], read = true): Promise<Outcome> {
  return state((s) => changed(s, { kind: 'read', ids, read }), !read);
}

/** The tick at the top of Updates and the bell (B2): every update so far is read. */
export async function markAllRead(): Promise<Outcome> {
  return state((s) => changed(s, { kind: 'readAll', at: new Date().toISOString() }), false);
}

/** Remind me later (C6): never past the due date; null wakes it now. */
export async function snooze(id: string, until: string | null): Promise<Outcome> {
  const t = await serverWords();
  const read = await inboxNow();
  const item = read.items.find((i) => i.id === id);
  if (item === undefined || item.lane !== 'task')
    return { ok: false, message: t('app.app.inbox.actions.no_such_task', 'No such task') };
  return state((s) => changed(s, { kind: 'snooze', id, until, due: item.due }));
}

/** Move to Done now (D5, Z2): updates, or a task cancelled by its sender. */
export async function moveToDone(ids: readonly string[]): Promise<Outcome> {
  return state((s) => changed(s, { kind: 'done', ids, at: new Date().toISOString() }));
}

/** Mute updates like this (D6), or unmute (P1). Tasks are never muted. */
export async function mute(
  m: Mute | { readonly what: string; readonly off: true },
): Promise<Outcome> {
  return state((s) =>
    changed(s, 'off' in m ? { kind: 'unmute', what: m.what } : { kind: 'mute', mute: m }),
  );
}

/** A checklist's own step (G5), ticked or not. */
export async function tick(id: string, step: string, on: boolean): Promise<Outcome> {
  return state((s) => changed(s, { kind: 'tick', id, step, on }));
}

/* --------------------------------------------------------- People -- */

/** C1, M:B1: fill in what was asked, on the record now (or with HR, for a sensitive one). */
export async function completeAsk(
  askId: string,
  values: Record<string, unknown>,
): Promise<Outcome> {
  const t = await serverWords();
  const a = await people<string>('CompleteAsk', { id: askId, values: JSON.stringify(values) });
  return a.ok ? { ok: true, data: JSON.parse(a.data) as unknown } : done(a, t);
}

/** C5: Undo, within a minute: what was there goes back and the task opens again. */
export async function undoAsk(askId: string, previous: Record<string, unknown>): Promise<Outcome> {
  const t = await serverWords();
  return done(await people('UndoAsk', { id: askId, values: JSON.stringify(previous) }), t);
}

/** C7: a question or an answer on the task. */
export async function replyToAsk(askId: string, body: string): Promise<Outcome> {
  const t = await serverWords();
  return done(await people('ReplyToAsk', { id: askId, body }), t);
}

/** C8: I can't do this, always with a reason. */
export async function sendBackAsk(
  askId: string,
  reason: 'no_information' | 'not_applicable' | 'other',
  note: string | null,
): Promise<Outcome> {
  const t = await serverWords();
  return done(await people('SendBackAsk', { id: askId, reason, note }), t);
}

/** Z2: whoever asked cancels it. */
export async function cancelAsk(askId: string, note: string | null): Promise<Outcome> {
  const t = await serverWords();
  return done(await people('CancelAsk', { id: askId, note }), t);
}

/** H2: ask one person or many for details, as one task each. */
export async function askForDetails(input: {
  readonly personIds: readonly string[];
  readonly keys: readonly string[];
  readonly message: string | null;
  readonly dueOn: string | null;
}): Promise<Outcome> {
  const t = await serverWords();
  const a = await people<string>('AskForDetails', { ...input });
  return a.ok ? { ok: true, data: JSON.parse(a.data) as unknown } : done(a, t);
}

/** H4: for what you asked of many: remind those left, change the due date, cancel for everyone. */
export async function changeAskBatch(
  batchId: string,
  action: 'remind' | 'due' | 'cancel',
  options: { readonly dueOn?: string | null; readonly personIds?: readonly string[] | null } = {},
): Promise<Outcome> {
  const t = await serverWords();
  return done(
    await people('ChangeAskBatch', {
      batchId,
      action,
      dueOn: options.dueOn ?? null,
      personIds: options.personIds ?? null,
    }),
    t,
  );
}

/** E2: withdraw a change you asked for. */
export async function withdrawChange(changeId: string): Promise<Outcome> {
  const t = await serverWords();
  return done(await people('WithdrawPendingChange', { id: changeId }), t);
}

/** E1: nudge HR about it, once, after 48 hours. */
export async function nudgeChange(changeId: string): Promise<Outcome> {
  const t = await serverWords();
  return done(await people('NudgePendingChange', { id: changeId }), t);
}

/** H1, Z3: take a team task, or take it over with a note. */
export async function takeTask(itemId: string, note: string | null): Promise<Outcome> {
  const t = await serverWords();
  return done(await people('TakeInboxTask', { itemId, note }), t);
}

/** C3, C4: acknowledge, sign, countersign, send back or cancel a document. */
export async function actOnDocument(
  documentId: string,
  action: 'acknowledge' | 'sign' | 'countersign' | 'send-back' | 'cancel',
  input: {
    readonly name?: string;
    readonly how?: 'typed' | 'drawn';
    readonly mark?: string;
    readonly note?: string;
  } = {},
): Promise<Outcome> {
  const t = await serverWords();
  return done(
    await people('ActOnDocument', {
      id: documentId,
      action,
      name: input.name ?? null,
      how: input.how ?? null,
      mark: input.mark ?? null,
      note: input.note ?? null,
    }),
    t,
  );
}

/** C3's preview and F1's download: the file, for whoever may read it. */
export async function documentFile(
  documentId: string,
): Promise<{ readonly name: string; readonly mediaType: string; readonly data: string } | null> {
  const a = await people<string>('PeopleDocumentFile', { id: documentId });
  if (!a.ok) return null;
  return JSON.parse(a.data) as { name: string; mediaType: string; data: string };
}

/** H3: where to put the file, then send it: to keep, acknowledge or sign. */
export async function startDocumentUpload(
  personId: string,
  name: string,
  size: number,
): Promise<
  | {
      readonly ok: true;
      readonly uploadId: string;
      readonly url: string;
      readonly headers: Record<string, string>;
    }
  | { readonly ok: false; readonly message: string }
> {
  const a = await people<string>('StartDocumentUpload', { personId, name, size });
  if (!a.ok) return { ok: false, message: a.message };
  const t = JSON.parse(a.data) as {
    uploadId: string;
    url: string;
    headers: Record<string, string>;
  };
  return { ok: true, ...t };
}

/** The document is uploaded: send it, with whoever sends it countersigning where asked. */
export async function sendDocument(input: {
  readonly personId: string;
  readonly uploadId: string;
  readonly mode: 'keep' | 'acknowledge' | 'sign';
  readonly message: string | null;
  readonly dueOn: string | null;
  readonly countersign: boolean;
}): Promise<Outcome> {
  const t = await serverWords();
  return done(await people('SendDocument', { ...input }), t);
}

/**
 * A person's Documents (D2, F1); none for their own record but their own.
 * With the Document center, its file for the person joins them (Documents
 * G6), each row's id marked so opening it goes to the center's viewer.
 */
export async function documentsOf(personId: string | null): Promise<readonly unknown[]> {
  const [sent, filed] = await Promise.all([
    people<string>('PeopleDocuments', { personId }),
    documentCenterOf(personId),
  ]);
  const list: unknown = sent.ok ? JSON.parse(sent.data) : [];
  return [...(Array.isArray(list) ? (list as readonly unknown[]) : []), ...filed];
}

interface CenterRow {
  readonly id: string;
  readonly title: string;
  readonly typeName: string | null;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly status: { readonly label: string } | null;
}

/** Documents' own answer, or nothing: a company without it, or a viewer it refuses. */
async function documentCenterOf(personId: string | null): Promise<readonly unknown[]> {
  let id = personId;
  if (id === null) {
    const library = await documents<{ viewer: { personId: string | null } }>('DocumentsLibrary');
    if (!library.ok || library.data.viewer.personId === null) return [];
    id = library.data.viewer.personId;
  }
  const file = await documents<{ rows: readonly CenterRow[] }>('DocumentsPersonFile', {
    personId: id,
  });
  if (!file.ok) return [];
  return file.data.rows
    .filter((r) => r.deletedAt === null)
    .map((r) => ({
      id: `documents:${r.id}`,
      name: r.title,
      mode: 'keep',
      state: r.status?.label ?? r.typeName ?? 'Filed',
      sentAt: r.updatedAt,
      signature: null,
      countersignedName: null,
      href: `/documents/d/${r.id}`,
    }));
}

/* ------------------------------------------------------- Time Off -- */

/** G1, M:F2: approve or decline in place, with a note. */
/** R16 from the Inbox: book one of the times a candidate gave, with the where and agenda saved on the link. */
export async function bookCandidateTime(
  applicationId: string,
  askId: string,
  startsAt: string,
): Promise<Outcome> {
  const t = await serverWords();
  return done(await recruiting('BookFromAsk', { applicationId, askId, input: { startsAt } }), t);
}

/** A scorecard filled in and submitted from the Inbox (R15). */
export async function submitScorecard(
  interviewId: string,
  ratings: Readonly<Record<string, number>>,
  recommendation: 'strong_no' | 'no' | 'yes' | 'strong_yes',
  notes: string | null,
): Promise<Outcome> {
  const t = await serverWords();
  return done(
    await recruiting('SaveScorecard', {
      interviewId,
      input: { ratings, recommendation, notes, submit: true },
    }),
    t,
  );
}

/** A requisition or an offer, approved or rejected from the Inbox; a rejection says why. */
export async function decideRecruitingApproval(
  kind: 'requisition' | 'offer',
  id: string,
  decision: 'approved' | 'rejected',
  comment: string | null,
): Promise<Outcome> {
  const t = await serverWords();
  const input = { decision, comment };
  return done(
    kind === 'requisition'
      ? await recruiting('DecideRequisition', { requisitionId: id, input })
      : await recruiting('DecideOffer', { offerId: id, input }),
    t,
  );
}

/** R16 from the Inbox: none of the candidate's times works; they are asked for others. */
export async function askCandidateForMoreTimes(
  applicationId: string,
  askId: string,
): Promise<Outcome> {
  const t = await serverWords();
  return done(
    await recruiting('RequestMoreTimes', { applicationId, askId, input: { note: null } }),
    t,
  );
}

export async function decideTimeOff(
  requestId: string,
  decision: 'approve' | 'decline',
  note: string | null,
): Promise<Outcome> {
  const t = await serverWords();
  return done(
    await timeOff('DecideTimeOffRequest', { requestId, input: { decision, reason: note } }),
    t,
  );
}

/**
 * G3: approve or decline several of the same kind at once, with one note to
 * all. Each is its own decision: one refused does not stop the others.
 */
export async function decideTimeOffMany(
  requestIds: readonly string[],
  decision: 'approve' | 'decline',
  note: string | null,
): Promise<{ readonly decided: number; readonly refused: readonly string[] }> {
  const answers = await Promise.all(
    requestIds.map((requestId) =>
      timeOff('DecideTimeOffRequest', { requestId, input: { decision, reason: note } }),
    ),
  );
  return {
    decided: answers.filter((a) => a.ok).length,
    refused: answers.flatMap((a) => (a.ok ? [] : [a.message])),
  };
}

/** E3: nudge the approver once, after 48 hours. */
export async function nudgeTimeOff(requestId: string): Promise<Outcome> {
  const t = await serverWords();
  return done(await timeOff('NudgeTimeOffRequest', { requestId }), t);
}

/** E2 for time off: withdraw the request while it waits. */
export async function withdrawTimeOff(requestId: string): Promise<Outcome> {
  const t = await serverWords();
  return done(await timeOff('CancelTimeOffRequest', { requestId }), t);
}

/** G4: whom the caller may hand their approvals to, and to whom they are handed now. */
export async function delegation(): Promise<{
  readonly approverId: string;
  readonly candidates: readonly { readonly personId: string; readonly displayName: string }[];
  readonly current: { delegateName: string; from: string; to: string } | null;
} | null> {
  const a = await timeOff<{
    approverId: string;
    candidates: { personId: string; displayName: string }[];
    delegation: { delegateName: string; range: { from: string; to: string } | null } | null;
  }>('TimeOffDelegation');
  if (!a.ok) return null;
  const d = a.data.delegation;
  return {
    approverId: a.data.approverId,
    candidates: a.data.candidates,
    current:
      d === null || d.range === null
        ? null
        : { delegateName: d.delegateName, from: d.range.from, to: d.range.to },
  };
}

/** G4: hand approvals over while away (Time Off's cover), or take them back. */
export async function handOver(
  approverId: string,
  input: { readonly delegateId: string; readonly from: string; readonly to: string } | null,
): Promise<Outcome> {
  const t = await serverWords();
  return done(
    input === null
      ? await timeOff('RemoveTimeOffDelegation', { approverId })
      : await timeOff('SetTimeOffDelegation', {
          approverId,
          input: { delegateId: input.delegateId, range: { from: input.from, to: input.to } },
        }),
    t,
  );
}

/* ------------------------------------------------ asking about it -- */

/** Z4: a question about the Inbox, answered from it; nothing is finished for anybody. */
export async function askInbox(question: string): Promise<InboxReply> {
  const read = await inboxNow();
  return answerInbox(question.slice(0, 500), read.items, read.now, read.zone);
}

/** The nudge an answer offers: the module's own, for the item it names. */
export async function nudgeItem(itemId: string): Promise<Outcome> {
  const t = await serverWords();
  const [module, kind, id] = itemId.split(':');
  if (id === undefined)
    return { ok: false, message: t('app.app.inbox.actions.no_such_request', 'No such request') };
  if (module === 'people' && kind === 'change') return nudgeChange(id);
  if (module === 'timeoff' && kind === 'request') return nudgeTimeOff(id);
  return {
    ok: false,
    message: t(
      'app.app.inbox.actions.that_request_cannot_be_nudged',
      'That request cannot be nudged',
    ),
  };
}

/** A task's own screen, for the pane to draw it where the task sits (`task-screen.tsx`). */
export async function openTaskScreen(link: string): Promise<TaskScreen | null> {
  return taskScreen(link);
}

/** A record field as People's profile read answers it: what a gap is made of. */
interface RecordFieldRead {
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
  readonly options: readonly { value: string; label: string }[];
  readonly required: boolean;
  readonly missing: boolean;
  readonly readOnly: boolean;
  readonly sensitive: boolean;
  readonly currency: string | null;
}

/**
 * What a person's record still needs, by section: its required fields left
 * empty that the viewer may fill, and nothing else. Read when a task about
 * the record opens (a hire to set up), not with every Inbox read.
 */
export async function recordGaps(personId: string): Promise<
  | {
      readonly ok: true;
      readonly sections: readonly {
        readonly key: string;
        readonly label: string;
        readonly fields: readonly InboxField[];
      }[];
    }
  | { readonly ok: false; readonly message: string }
> {
  const found = await people<{
    sections: readonly { key: string; label: string; fields: readonly RecordFieldRead[] }[];
  }>('Profile', { personId });
  if (!found.ok) return { ok: false, message: found.message };
  return {
    ok: true,
    sections: found.data.sections.flatMap((s) => {
      const fields = s.fields
        .filter((f) => f.required && f.missing && !f.readOnly)
        .map((f): InboxField => ({
          key: f.key,
          label: f.label,
          description: f.description,
          dataType: f.dataType,
          options: f.options.map((o) => ({ value: o.value, label: o.label })),
          required: true,
          value: null,
          sensitive: f.sensitive,
          currency: f.currency,
        }));
      return fields.length === 0 ? [] : [{ key: s.key, label: s.label, fields }];
    }),
  };
}
