import type { InboxAnswer, Item } from './model';
import { dueOf, shortDay } from './time';

/**
 * The one line that opens the Inbox and Home (design v3 I1, I4, I5, H1): what
 * the lane holds, in words, worked out from the items themselves. Pure, so the
 * sentences are tested without a phone; nothing here asks a model.
 */

const word = (n: number): string =>
  ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][n] ?? String(n);

const plural = (n: number, one: string, many: string): string =>
  `${word(n)} ${n === 1 ? one : many}`;

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

export const tasksOf = (inbox: InboxAnswer): readonly Item[] =>
  inbox.lanes.todo.flatMap((g) => g.items).filter((i) => i.lane === 'task');

export const updatesOf = (inbox: InboxAnswer): readonly Item[] =>
  inbox.lanes.todo
    .concat(inbox.lanes.updates)
    .flatMap((g) => g.items)
    .filter((i, at, all) => i.lane === 'update' && all.findIndex((x) => x.id === i.id) === at);

/** Due today, tomorrow or already late. */
const urgent = (item: Item, now: string, zone: string): boolean => {
  const due = dueOf(item, now, zone);
  return due !== null && due.tone !== 'neutral';
};

/** "due tomorrow", "to decide today", "3 days late". */
function dueWords(item: Item, now: string, zone: string): string {
  const due = dueOf(item, now, zone);
  if (due === null) return '';
  return lower(due.label);
}

/** To do's line: what is urgent, and when the rest is due. */
export function todoBrief(inbox: InboxAnswer): string | null {
  const tasks = tasksOf(inbox);
  if (tasks.length === 0) return null;
  const { now, zone } = inbox;
  const approvals = tasks.filter((t) => t.kind === 'timeoff.approval');
  const pressing = tasks.filter((t) => urgent(t, now, zone));
  const parts: string[] = [];
  if (pressing.length === 1) {
    const [first] = pressing;
    if (first !== undefined)
      parts.push(`One thing is urgent: ${lower(first.title)}, ${dueWords(first, now, zone)}.`);
  } else if (pressing.length > 1) {
    parts.push(`${plural(pressing.length, 'thing is', 'things are')} urgent.`);
  } else if (approvals.length > 0) {
    parts.push(
      `${plural(approvals.length, 'time off request waits', 'time off requests wait')} for you.`,
    );
  } else {
    parts.push(`${plural(tasks.length, 'thing', 'things')} to do, nothing due before tomorrow.`);
  }
  const rest = tasks.filter((t) => !pressing.includes(t));
  if (pressing.length > 0 && rest.length > 0) {
    const later = rest
      .map((t) => t.due)
      .filter((d): d is string => d !== null)
      .sort()[0];
    parts.push(
      later === undefined
        ? 'The rest has no date.'
        : `The rest can wait until ${shortDay(later)}.`,
    );
  }
  return parts.join(' ');
}

/** Updates' line: how many are new, and that none asks anything. */
export function updatesBrief(inbox: InboxAnswer): string | null {
  const fresh = updatesOf(inbox).filter((u) => u.unread).length;
  if (fresh === 0) return null;
  return `${plural(fresh, 'new update', 'new updates')}. None need anything from you.`;
}

/**
 * Home's line (H1): the most pressing task in the sender's words, then the
 * newest update, so the day opens on what matters most and what changed.
 */
export function homeBrief(inbox: InboxAnswer): string | null {
  const { now, zone } = inbox;
  const tasks = tasksOf(inbox);
  const first = tasks.find((t) => urgent(t, now, zone)) ?? tasks[0];
  const update = updatesOf(inbox).find((u) => u.unread);
  const parts: string[] = [];
  if (first !== undefined) {
    const from = first.from?.name?.split(' ')[0];
    const due = dueWords(first, now, zone);
    parts.push(
      `${from === undefined || from === '' || from === 'You' ? 'Next' : `${from} asks`}: ${lower(first.title)}${due === '' ? '' : `, ${due}`}.`,
    );
  }
  if (update !== undefined) parts.push(`${update.title}.`);
  if (parts.length === 0) return null;
  if (tasks.length > 1) parts.push(`${plural(tasks.length, 'task', 'tasks')} in all.`);
  return parts.join(' ');
}
