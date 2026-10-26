import { dayIn } from './plain';
import type { Shown } from './model';
import { t } from '../t';

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
const first = (name: string | null | undefined): string => (name ?? '').split(' ')[0] ?? '';

function nudgeOf(i: Shown, now: string): { itemId: string; label: string } | null {
  const n = (i.detail as { nudge?: { from?: string; used?: boolean } | null } | null)?.nudge;
  if (n == null || n.used === true || typeof n.from !== 'string' || n.from > now) return null;
  const holder = i.status?.label.replace(/^With /u, '') ?? '';
  const who = first(holder);
  return {
    itemId: i.id,
    label:
      who === ''
        ? t('lib.inbox.ask.nudge_them', 'Nudge them')
        : t('lib.inbox.ask.nudge_name', 'Nudge {{name}}', { name: who }),
  };
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
  const unread = items.filter((i) => i.unread && i.lane === 'update');
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
        text: t(
          'lib.inbox.ask.nothing_you_asked_for_is_waiting_now',
          'Nothing you asked for is waiting on anybody right now.',
        ),
        items: [],
        nudge: null,
      };
    }
    const waited = Math.max(0, Math.floor((Date.parse(now) - Date.parse(r.at)) / DAY_MS));
    const nudge = nudgeOf(r, now);
    return {
      text: `${
        waited === 0
          ? t('lib.inbox.ask.status_sent_today', '{{title}}: {{status}}, sent today.', {
              title: r.title,
              status: r.status?.label.toLowerCase() ?? t('lib.inbox.ask.waiting', 'waiting'),
            })
          : t(
              'lib.inbox.ask.status_sent_days_ago',
              {
                one: '{{title}}: {{status}}, sent {{count}} day ago.',
                other: '{{title}}: {{status}}, sent {{count}} days ago.',
              },
              {
                title: r.title,
                status: r.status?.label.toLowerCase() ?? t('lib.inbox.ask.waiting', 'waiting'),
                count: waited,
              },
            )
      }${nudge === null ? '' : t('lib.inbox.ask.you_can_nudge_them_now', ' You can nudge them now.')}`,
      items: [chip(r, r.status?.label ?? null)],
      nudge,
    };
  }
  if (/\b(waiting|others|requests?|asked)\b/u.test(q)) {
    if (requests.length === 0) {
      return {
        text: t(
          'lib.inbox.ask.nothing_you_asked_for_is_waiting',
          'Nothing you asked for is waiting on anybody.',
        ),
        items: [],
        nudge: null,
      };
    }
    return {
      text: t(
        'lib.inbox.ask.requests_waiting_on_somebody',
        {
          one: '{{count}} of your requests is waiting on somebody.',
          other: '{{count}} of your requests are waiting on somebody.',
        },
        { count: requests.length },
      ),
      items: requests.slice(0, 5).map((r) => chip(r, r.status?.label ?? null)),
      nudge: requests.map((r) => nudgeOf(r, now)).find((n) => n !== null) ?? null,
    };
  }
  if (/\b(updates?|news|new|happened)\b/u.test(q)) {
    return unread.length === 0
      ? {
          text: t('lib.inbox.ask.you_have_read_every_update', 'You have read every update.'),
          items: [],
          nudge: null,
        }
      : {
          text: t(
            'lib.inbox.ask.updates_you_havent_opened',
            {
              one: '{{count}} update you haven’t opened.',
              other: '{{count}} updates you haven’t opened.',
            },
            { count: unread.length },
          ),
          items: unread.slice(0, 5).map((u) => chip(u, null)),
          nudge: null,
        };
  }
  // What do I need to do (this week, today)?
  const soon = tasks
    .filter((t) => t.due !== null && inDays(t.due) <= (/\btoday\b/u.test(q) ? 0 : 7))
    .sort((a, b) => ((a.due ?? '') < (b.due ?? '') ? -1 : 1));
  if (tasks.length === 0) {
    return {
      text: t(
        'lib.inbox.ask.nothing_needs_you',
        'Nothing needs you. New tasks appear in your Inbox.',
      ),
      items: [],
      nudge: null,
    };
  }
  const nearest = soon[0];
  const hint = (task: Shown): string | null =>
    task.due === null
      ? null
      : inDays(task.due) < 0
        ? t('lib.inbox.ask.overdue', 'overdue')
        : inDays(task.due) === 0
          ? t('lib.inbox.ask.today', 'today')
          : inDays(task.due) === 1
            ? t('lib.inbox.ask.tomorrow', 'tomorrow')
            : task.due;
  const askedToday = /\btoday\b/u.test(q);
  return {
    text:
      soon.length === 0
        ? t(
            'lib.inbox.ask.tasks_to_do_none_due_this_week',
            {
              one: '{{count}} task to do, none due this week.',
              other: '{{count}} tasks to do, none due this week.',
            },
            { count: tasks.length },
          )
        : `${
            askedToday
              ? t(
                  'lib.inbox.ask.tasks_due_today_or_overdue',
                  {
                    one: '{{count}} task is due today or overdue.',
                    other: '{{count}} tasks are due today or overdue.',
                  },
                  { count: soon.length },
                )
              : t(
                  'lib.inbox.ask.tasks_due_this_week',
                  {
                    one: '{{count}} task is due this week.',
                    other: '{{count}} tasks are due this week.',
                  },
                  { count: soon.length },
                )
          }${
            nearest === undefined
              ? ''
              : nearest.due !== null && inDays(nearest.due) < 0
                ? t('lib.inbox.ask.title_is_overdue', ' {{title}} is overdue.', {
                    title: nearest.title,
                  })
                : t('lib.inbox.ask.title_is_due', ' {{title}} is due {{when}}.', {
                    title: nearest.title,
                    when: hint(nearest) ?? '',
                  })
          }`,
    items: (soon.length === 0 ? tasks : soon).slice(0, 5).map((task) => chip(task, hint(task))),
    nudge: null,
  };
}

/** Whether a question is about the Inbox, for the assistant to answer it here. */
export const aboutInbox = (question: string): boolean =>
  /\b(inbox|to do|todo|task|tasks|due|this week|waiting|nudge|updates?|my requests)\b/iu.test(
    question,
  );
