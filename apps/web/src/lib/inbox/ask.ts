import { dayIn } from './day';
import type { Shown } from './model';

/**
 * Asking about your Inbox (Z4, M:Z2): what is due this week, what waits on
 * others, what is new, and whether somebody has looked yet. Answered from the
 * Inbox itself, by these rules: every number and every name comes from the
 * items the person can already see, and nothing is finished for them. It can
 * list, open and offer a nudge; a task is only ever done by its owner.
 */

export interface InboxReply {
  readonly text: string;
  /** Items to open, each a chip. */
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly lane: string;
    readonly hint: string | null;
  }[];
  /** A nudge to offer, where one is open to them now. */
  readonly nudge: { readonly itemId: string; readonly label: string } | null;
}

const DAY_MS = 86_400_000;
const laneOf = (i: Shown): string =>
  ({ task: 'todo', update: 'updates', request: 'requests', done: 'done' })[i.lane];
const days = (n: number): string => `${String(n)} day${n === 1 ? '' : 's'}`;
const first = (name: string | null | undefined): string => (name ?? '').split(' ')[0] ?? '';

function nudgeOf(i: Shown, now: string): { itemId: string; label: string } | null {
  const n = (i.detail as { nudge?: { from?: string; used?: boolean } | null } | null)?.nudge;
  if (n == null || n.used === true || typeof n.from !== 'string' || n.from > now) return null;
  const holder = i.status?.label.replace(/^With /u, '') ?? 'them';
  return { itemId: i.id, label: `Nudge ${first(holder) || 'them'}` };
}

export function answerInbox(
  question: string,
  items: readonly Shown[],
  now: string,
  zone: string,
): InboxReply {
  const q = question.toLowerCase();
  const today = dayIn(now, zone);
  const inDays = (due: string): number =>
    Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  const tasks = items.filter((i) => i.counted);
  const requests = items.filter((i) => i.lane === 'request');
  const unread = items.filter((i) => i.unread);
  const chip = (i: Shown, hint: string | null) => ({
    id: i.id,
    title: i.title,
    lane: laneOf(i),
    hint,
  });

  // Somebody by name: has Ada looked at my address change?
  const named = requests.find((r) => {
    const holder = r.status?.label.replace(/^With /u, '').toLowerCase() ?? '';
    const who = first(holder);
    return who !== '' && q.includes(who);
  });
  if (named !== undefined || /\b(nudge|looked|seen)\b/u.test(q)) {
    const r = named ?? requests[0];
    if (r === undefined) {
      return {
        text: 'Nothing you asked for is waiting on anybody right now.',
        items: [],
        nudge: null,
      };
    }
    const waited = Math.max(0, Math.floor((Date.parse(now) - Date.parse(r.at)) / DAY_MS));
    const nudge = nudgeOf(r, now);
    return {
      text: `${r.title}: ${r.status?.label.toLowerCase() ?? 'waiting'}, sent ${waited === 0 ? 'today' : `${days(waited)} ago`}.${nudge === null ? '' : ' You can nudge them now.'}`,
      items: [chip(r, r.status?.label ?? null)],
      nudge,
    };
  }
  if (/\b(waiting|others|requests?|asked)\b/u.test(q)) {
    if (requests.length === 0) {
      return { text: 'Nothing you asked for is waiting on anybody.', items: [], nudge: null };
    }
    return {
      text: `${String(requests.length)} of your requests ${requests.length === 1 ? 'is' : 'are'} waiting on somebody.`,
      items: requests.slice(0, 5).map((r) => chip(r, r.status?.label ?? null)),
      nudge: requests.map((r) => nudgeOf(r, now)).find((n) => n !== null) ?? null,
    };
  }
  if (/\b(updates?|news|new|happened)\b/u.test(q)) {
    return unread.length === 0
      ? { text: 'You have read every update.', items: [], nudge: null }
      : {
          text: `${String(unread.length)} update${unread.length === 1 ? '' : 's'} you haven’t opened.`,
          items: unread.slice(0, 5).map((u) => chip(u, null)),
          nudge: null,
        };
  }
  // What do I need to do (this week, today)?
  const soon = tasks
    .filter((t) => t.due !== null && inDays(t.due) <= (/\btoday\b/u.test(q) ? 0 : 7))
    .sort((a, b) => ((a.due ?? '') < (b.due ?? '') ? -1 : 1));
  if (tasks.length === 0) {
    return { text: 'Nothing needs you. New tasks appear in your Inbox.', items: [], nudge: null };
  }
  const nearest = soon[0];
  const hint = (t: Shown): string | null =>
    t.due === null
      ? null
      : inDays(t.due) < 0
        ? 'overdue'
        : inDays(t.due) === 0
          ? 'today'
          : inDays(t.due) === 1
            ? 'tomorrow'
            : t.due;
  return {
    text:
      soon.length === 0
        ? `${String(tasks.length)} task${tasks.length === 1 ? '' : 's'} to do, none due this week.`
        : `${String(soon.length)} task${soon.length === 1 ? ' is' : 's are'} due ${/\btoday\b/u.test(q) ? 'today or overdue' : 'this week'}.${nearest === undefined ? '' : ` ${nearest.title} is ${hint(nearest) === 'overdue' ? 'overdue' : `due ${hint(nearest) ?? ''}`}.`}`,
    items: (soon.length === 0 ? tasks : soon).slice(0, 5).map((t) => chip(t, hint(t))),
    nudge: null,
  };
}

/** Whether a question is about the Inbox, for the assistant to answer it here. */
export const aboutInbox = (question: string): boolean =>
  /\b(inbox|to do|todo|task|tasks|due|this week|waiting|nudge|updates?|my requests)\b/iu.test(
    question,
  );
