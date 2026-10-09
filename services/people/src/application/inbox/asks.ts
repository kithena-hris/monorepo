import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { emailAll, recordOne, type Recorded } from '../screens/requests.js';
import { saveSection, type ScreenDeps, type Tx } from '../screens/record.js';

/**
 * Asking somebody for details, as one ask (Inbox C1, C7, C8, H2, H4, Z2):
 * the fields, the sender's words, when it is due, and how it ended. The
 * person sees it as a task in their Inbox and fills it in there; the sender
 * sees it in their requests, one row per batch, with progress.
 *
 * Each field is still recorded in `people.detail_request` (`recordOne`), so
 * the profile says it was asked for and the email keeps its daily cap. Who
 * may ask whom for what is `recordOne`'s, unchanged.
 */

export type AskState = 'open' | 'done' | 'sent_back' | 'cancelled';
export type SendBackReason = 'no_information' | 'not_applicable' | 'other';

export interface DetailAsk {
  readonly id: string;
  readonly personId: string;
  readonly keys: readonly string[];
  readonly message: string | null;
  readonly dueOn: string | null;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly batchId: string;
  readonly state: AskState;
  readonly reason: SendBackReason | null;
  readonly note: string | null;
  readonly closedBy: string | null;
  readonly closedAt: string | null;
}

export interface AskMessage {
  readonly id: string;
  readonly askId: string;
  /** The account that wrote it. */
  readonly author: string;
  readonly body: string;
  readonly at: string;
}

export interface DetailAskStore {
  insert(tx: Tx, tenantId: string, asks: readonly DetailAsk[]): Promise<void>;
  find(tx: Tx, tenantId: string, id: string): Promise<DetailAsk | null>;
  /** One person's asks, newest first, since an instant. */
  forPerson(
    tx: Tx,
    tenantId: string,
    personId: string,
    since: string,
  ): Promise<readonly DetailAsk[]>;
  /** The asks an account sent, newest first, since an instant. */
  sentBy(tx: Tx, tenantId: string, accountId: string, since: string): Promise<readonly DetailAsk[]>;
  inBatch(tx: Tx, tenantId: string, batchId: string): Promise<readonly DetailAsk[]>;
  /** Close an open ask; false when it was already closed. */
  close(
    tx: Tx,
    tenantId: string,
    id: string,
    to: {
      readonly state: Exclude<AskState, 'open'>;
      readonly reason: SendBackReason | null;
      readonly note: string | null;
      readonly by: string;
      readonly at: string;
    },
  ): Promise<boolean>;
  /** Open again what the person finished a moment ago (C5's Undo); false otherwise. */
  reopen(tx: Tx, tenantId: string, id: string): Promise<boolean>;
  setDue(tx: Tx, tenantId: string, batchId: string, dueOn: string | null): Promise<void>;
  addMessage(tx: Tx, tenantId: string, message: AskMessage): Promise<void>;
  messages(tx: Tx, tenantId: string, askIds: readonly string[]): Promise<readonly AskMessage[]>;
  /** Record the one nudge on a change waiting for HR; false when it was nudged already. */
  nudge(tx: Tx, tenantId: string, changeId: string, by: string, at: string): Promise<boolean>;
  /** When each of these changes was nudged, where it was. */
  nudges(
    tx: Tx,
    tenantId: string,
    changeIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

export interface AskDeps {
  readonly store: DetailAskStore;
  readonly newId: () => string;
}

type Deps = ScreenDeps;

const unavailable = () => err(failure('UNAVAILABLE', 'Asking for details is not available here'));
const words = (s: string | null | undefined, max: number): string | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : t.slice(0, max);
};

/**
 * Ask one person or many for these fields (H2): one ask each, one batch.
 * Somebody the viewer may not ask is skipped, as "Remind all" skips them.
 */
export async function askForDetails(
  deps: Deps,
  asking: Asking,
  input: {
    readonly personIds: readonly string[];
    readonly keys: readonly string[];
    readonly message?: string | null;
    readonly dueOn?: string | null;
  },
): Promise<Result<{ readonly batchId: string; readonly asked: number; readonly skipped: number }>> {
  if (deps.asks === undefined) return unavailable();
  const asks = deps.asks;
  const keys = [...new Set(input.keys)];
  if (keys.length === 0) return err(failure('NOTHING_ASKED', 'Choose what to ask for', ['keys']));
  const batchId = asks.newId();
  const now = deps.clock.now();
  const message = words(input.message, 2000);
  const dueOn = input.dueOn ?? null;
  const done = await run(deps.service, asking.tenantId, async (tx) => {
    const recorded: Recorded[] = [];
    const rows: DetailAsk[] = [];
    let skipped = 0;
    for (const personId of new Set(input.personIds)) {
      const one = await recordOne(deps, tx, asking, personId, keys, now);
      if (!one.ok) {
        if (input.personIds.length === 1) return one;
        skipped += 1;
        continue;
      }
      recorded.push(one.value);
      rows.push({
        id: asks.newId(),
        personId,
        keys,
        message,
        dueOn,
        requestedBy: asking.viewer.accountId,
        requestedAt: now.toISOString(),
        batchId,
        state: 'open',
        reason: null,
        note: null,
        closedBy: null,
        closedAt: null,
      });
    }
    await asks.store.insert(tx, asking.tenantId, rows);
    const company =
      recorded.length === 0 || deps.requests?.company === undefined
        ? null
        : await deps.requests.company(tx, asking.tenantId);
    return ok({ recorded, company, skipped });
  });
  if (!done.ok) return done;
  await emailAll(deps, asking.tenantId, done.value.company, done.value.recorded, now);
  return ok({ batchId, asked: done.value.recorded.length, skipped: done.value.skipped });
}

/** The ask, and whether the viewer is the person asked or whoever asked. */
async function involved(
  deps: Deps,
  tx: Tx,
  asking: Asking,
  id: string,
): Promise<Result<{ ask: DetailAsk; mine: boolean; sent: boolean }>> {
  const asks = deps.asks;
  if (asks === undefined) return unavailable();
  const ask = await asks.store.find(tx, asking.tenantId, id);
  if (ask === null) return err(failure('NOT_FOUND', 'No such request'));
  const me = await deps.personOf(tx, asking.tenantId, asking.viewer.accountId);
  const mine = me !== null && me === ask.personId;
  const sent = ask.requestedBy === asking.viewer.accountId;
  if (!mine && !sent) return err(failure('NOT_FOUND', 'No such request'));
  return ok({ ask, mine, sent });
}

/** A question or an answer on the ask's thread (C7): the person asked, or whoever asked. */
export async function replyToAsk(
  deps: Deps,
  asking: Asking,
  id: string,
  body: string,
): Promise<Result<{ readonly id: string }>> {
  const text = words(body, 4000);
  if (text === null) return err(failure('EMPTY', 'Write something to send', ['body']));
  return run(deps.service, asking.tenantId, async (tx) => {
    const found = await involved(deps, tx, asking, id);
    if (!found.ok) return found;
    if (found.value.ask.state !== 'open') {
      return err(failure('CLOSED', 'This request is closed'));
    }
    const message: AskMessage = {
      id: deps.asks?.newId() ?? '',
      askId: id,
      author: asking.viewer.accountId,
      body: text,
      at: deps.clock.instant(),
    };
    await deps.asks?.store.addMessage(tx, asking.tenantId, message);
    return ok({ id: message.id });
  });
}

/** "I can't do this" (C8): the person asked sends it back, always with a reason. */
export async function sendBackAsk(
  deps: Deps,
  asking: Asking,
  id: string,
  input: { readonly reason: SendBackReason; readonly note?: string | null },
): Promise<Result<{ readonly state: AskState }>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const found = await involved(deps, tx, asking, id);
    if (!found.ok) return found;
    if (!found.value.mine)
      return err(failure('FORBIDDEN', 'Only the person asked can send it back'));
    const note = words(input.note, 2000);
    if (input.reason === 'other' && note === null) {
      return err(failure('REASON_REQUIRED', 'Say what stops you', ['note']));
    }
    const closed = await deps.asks?.store.close(tx, asking.tenantId, id, {
      state: 'sent_back',
      reason: input.reason,
      note,
      by: asking.viewer.accountId,
      at: deps.clock.instant(),
    });
    if (closed !== true) return err(failure('CLOSED', 'This request is closed'));
    return ok({ state: 'sent_back' as const });
  });
}

/** Cancelled by whoever asked (Z2): the fields lock and it stops counting. */
export async function cancelAsk(
  deps: Deps,
  asking: Asking,
  id: string,
  note: string | null,
): Promise<Result<{ readonly state: AskState }>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const found = await involved(deps, tx, asking, id);
    if (!found.ok) return found;
    if (!found.value.sent) return err(failure('FORBIDDEN', 'Only whoever asked can cancel it'));
    const closed = await deps.asks?.store.close(tx, asking.tenantId, id, {
      state: 'cancelled',
      reason: null,
      note: words(note, 2000),
      by: asking.viewer.accountId,
      at: deps.clock.instant(),
    });
    if (closed !== true) return err(failure('CLOSED', 'This request is closed'));
    return ok({ state: 'cancelled' as const });
  });
}

/** The batch's open asks the viewer sent, or a refusal. */
async function ownBatch(
  deps: Deps,
  tx: Tx,
  asking: Asking,
  batchId: string,
): Promise<Result<readonly DetailAsk[]>> {
  if (deps.asks === undefined) return unavailable();
  const all = await deps.asks.store.inBatch(tx, asking.tenantId, batchId);
  if (all.length === 0 || all.some((a) => a.requestedBy !== asking.viewer.accountId)) {
    return err(failure('NOT_FOUND', 'No such request'));
  }
  return ok(all);
}

/** H4: cancel what is still open in a batch, for everyone. */
export async function cancelBatch(
  deps: Deps,
  asking: Asking,
  batchId: string,
): Promise<Result<{ readonly cancelled: number }>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const batch = await ownBatch(deps, tx, asking, batchId);
    if (!batch.ok) return batch;
    let cancelled = 0;
    for (const ask of batch.value) {
      if (ask.state !== 'open') continue;
      const closed = await deps.asks?.store.close(tx, asking.tenantId, ask.id, {
        state: 'cancelled',
        reason: null,
        note: null,
        by: asking.viewer.accountId,
        at: deps.clock.instant(),
      });
      if (closed === true) cancelled += 1;
    }
    return ok({ cancelled });
  });
}

/** H4: a new due date for everyone in a batch. */
export async function changeBatchDue(
  deps: Deps,
  asking: Asking,
  batchId: string,
  dueOn: string | null,
): Promise<Result<{ readonly dueOn: string | null }>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const batch = await ownBatch(deps, tx, asking, batchId);
    if (!batch.ok) return batch;
    await deps.asks?.store.setDue(tx, asking.tenantId, batchId, dueOn);
    return ok({ dueOn });
  });
}

/**
 * H4's Remind: ask the people still owing again, which emails anyone not
 * reminded in the last day (`recordOne`'s cap). `personIds` narrows it to
 * some of them ("Remind" on one row).
 */
export async function remindBatch(
  deps: Deps,
  asking: Asking,
  batchId: string,
  personIds: readonly string[] | null,
): Promise<Result<{ readonly reminded: number }>> {
  const now = deps.clock.now();
  const done = await run(deps.service, asking.tenantId, async (tx) => {
    const batch = await ownBatch(deps, tx, asking, batchId);
    if (!batch.ok) return batch;
    const recorded: Recorded[] = [];
    for (const ask of batch.value) {
      if (ask.state !== 'open') continue;
      if (personIds !== null && !personIds.includes(ask.personId)) continue;
      const one = await recordOne(deps, tx, asking, ask.personId, ask.keys, now);
      if (one.ok) recorded.push(one.value);
    }
    const company =
      recorded.length === 0 || deps.requests?.company === undefined
        ? null
        : await deps.requests.company(tx, asking.tenantId);
    return ok({ recorded, company });
  });
  if (!done.ok) return done;
  const sent = await emailAll(deps, asking.tenantId, done.value.company, done.value.recorded, now);
  return ok({ reminded: sent });
}

/** How long after finishing a task its Undo still works (C5). */
export const UNDO_MS = 60_000;

/**
 * Fill it in from the Inbox (C1, M:B1): the values go on the record as the
 * profile saves them (a sensitive one waits for HR, `held`), then the ask is
 * done and its sender gets an update. Only the fields asked for are taken.
 */
export async function completeAsk(
  deps: Deps,
  asking: Asking,
  id: string,
  values: Readonly<Record<string, unknown>>,
): Promise<Result<{ readonly held: readonly string[] }>> {
  const found = await run(deps.service, asking.tenantId, (tx) => involved(deps, tx, asking, id));
  if (!found.ok) return found;
  const { ask, mine } = found.value;
  if (!mine) return err(failure('FORBIDDEN', 'Only the person asked can fill it in'));
  if (ask.state !== 'open') return err(failure('CLOSED', 'This request is closed'));
  const asked = new Set(ask.keys);
  const changed = Object.fromEntries(Object.entries(values).filter(([k]) => asked.has(k)));
  const saved = await saveSection(deps, asking, ask.personId, changed);
  if (!saved.ok) return saved;
  const closed = await run(deps.service, asking.tenantId, async (tx) =>
    ok(
      await deps.asks?.store.close(tx, asking.tenantId, id, {
        state: 'done',
        reason: null,
        note: null,
        by: asking.viewer.accountId,
        at: deps.clock.instant(),
      }),
    ),
  );
  if (!closed.ok) return closed;
  return ok({ held: saved.value.held ?? [] });
}

/**
 * C5's Undo: what was on the record goes back and the task opens again,
 * within a minute of finishing it. `previous` is what the task showed before.
 */
export async function undoAsk(
  deps: Deps,
  asking: Asking,
  id: string,
  previous: Readonly<Record<string, unknown>>,
): Promise<Result<{ readonly state: AskState }>> {
  const found = await run(deps.service, asking.tenantId, (tx) => involved(deps, tx, asking, id));
  if (!found.ok) return found;
  const { ask, mine } = found.value;
  const late =
    ask.closedAt === null || Date.parse(deps.clock.instant()) - Date.parse(ask.closedAt) > UNDO_MS;
  if (!mine || ask.state !== 'done' || late) {
    return err(failure('TOO_LATE', 'It can no longer be undone'));
  }
  const asked = new Set(ask.keys);
  const restored = await saveSection(
    deps,
    asking,
    ask.personId,
    Object.fromEntries(Object.entries(previous).filter(([k]) => asked.has(k))),
  );
  if (!restored.ok) return restored;
  return run(deps.service, asking.tenantId, async (tx) => {
    await deps.asks?.store.reopen(tx, asking.tenantId, id);
    return ok({ state: 'open' as const });
  });
}

/** After this long waiting, a requester may nudge HR once (E1). */
export const CHANGE_NUDGE_AFTER_MS = 48 * 3_600_000;

/** E1, M:D2: nudge HR about the caller's own change, once, after 48 hours. */
export async function nudgeChange(
  deps: Deps,
  asking: Asking,
  changeId: string,
): Promise<Result<{ readonly at: string }>> {
  const pending = deps.service.pending;
  if (deps.asks === undefined || pending === undefined) return unavailable();
  const asks = deps.asks;
  return run(deps.service, asking.tenantId, async (tx) => {
    const change = await pending.store.find(tx, asking.tenantId, changeId);
    if (change === null || change.approval.requestedBy !== asking.viewer.accountId) {
      return err(failure('NOT_FOUND', 'No such request'));
    }
    if (change.approval.state !== 'pending') {
      return err(failure('NOT_WAITING', 'It is no longer waiting'));
    }
    const at = deps.clock.instant();
    if (Date.parse(at) - Date.parse(change.approval.requestedAt) < CHANGE_NUDGE_AFTER_MS) {
      return err(failure('TOO_SOON', 'You can nudge after 48 hours'));
    }
    const first = await asks.store.nudge(
      tx,
      asking.tenantId,
      changeId,
      asking.viewer.accountId,
      at,
    );
    return first ? ok({ at }) : err(failure('ALREADY_NUDGED', 'You already nudged'));
  });
}
