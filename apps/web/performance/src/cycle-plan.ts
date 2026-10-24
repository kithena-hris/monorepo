import type { ChartTone, TimelineEntry, TimelineRow } from '@reach/ui';
import { t } from './i18n';

/**
 * A cycle's calendar worked out in the browser, so a deadline or a reminder
 * moves the moment its number does rather than after a save comes back. The
 * same rules as Performance's domain (`resolve` and `remindsOn` in
 * `services/performance/src/domain/cycle.ts`), copied because a screen does
 * not import a service; change both together.
 */

export interface Deadline {
  readonly kind: 'exact' | 'relative';
  readonly date?: string;
  readonly days?: number;
  readonly from?: 'start' | 'nominations';
}

export interface Plan {
  readonly start: { readonly date: string };
  readonly nominations: Deadline;
  readonly activities: Readonly<
    Record<string, { readonly on: boolean; readonly due: Deadline } | undefined>
  >;
  readonly peer: { readonly all: boolean };
  readonly reminders: { readonly rules: readonly string[] };
  readonly visibility?: {
    readonly release: { readonly mode: string; readonly date: string | null };
  };
}

/** `YYYY-MM-DD` plus whole days, in UTC: a calendar date has no time zone. */
export function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export function resolveDue(p: Pick<Plan, 'start' | 'nominations'>, d: Deadline): string {
  if (d.kind === 'exact' && d.date !== undefined) return d.date;
  const base = d.from === 'nominations' ? resolveDue(p, p.nominations) : p.start.date;
  return addDays(base, d.days ?? 0);
}

/** The days a review due on `due` is reminded, each with the rule that put it there. */
export function reminders(
  rules: readonly string[],
  start: string,
  due: string,
): { readonly date: string; readonly rule: string }[] {
  const out = new Map<string, string>();
  const add = (date: string, rule: string): void => {
    if (!out.has(date)) out.set(date, rule);
  };
  for (const rule of rules) {
    const [kind, n] = rule.split(':');
    const every = Math.max(1, Number(n));
    if (kind === 'opens') add(start, rule);
    else if (kind === 'on_day') add(due, rule);
    else if (kind === 'before') {
      const day = addDays(due, -Number(n));
      if (day >= start) add(day, rule);
    } else if (kind === 'late') for (let i = 1; i <= 3; i++) add(addDays(due, every * i), rule);
  }
  return [...out]
    .map(([date, rule]) => ({ date, rule }))
    .toSorted((a, b) => a.date.localeCompare(b.date));
}

/** The days a review due on `due` is reminded, by the cycle's rules. */
export const reminderDates = (rules: readonly string[], start: string, due: string): string[] =>
  reminders(rules, start, due).map((r) => r.date);

/** The kinds in order, each with its colour wherever a cycle is drawn. */
export const KIND_ORDER = ['self', 'manager', 'peer', 'upward', 'skip'] as const;
export const TONES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const;

/** What a mark on the plan is, from its id: the thing a drag or a menu changes. */
export type PlanItem =
  | { readonly what: 'open' | 'due'; readonly kind: string }
  | { readonly what: 'remind'; readonly kind: string; readonly rule: string }
  | { readonly what: 'nominations' | 'nominations-due' | 'release' };

export function planItem(id: string): PlanItem | null {
  if (id === 'nominations' || id === 'nominations-due' || id === 'release') return { what: id };
  const remind = /^([a-z]+)-remind:([a-z_:0-9]+)@/u.exec(id);
  if (remind !== null) return { what: 'remind', kind: remind[1] ?? '', rule: remind[2] ?? '' };
  const bar = /^([a-z]+)-(open|due)$/u.exec(id);
  return bar === null ? null : { what: bar[2] as 'open' | 'due', kind: bar[1] ?? '' };
}

/**
 * The whole cycle as lanes: a bar for each kind of review from when it opens
 * to its deadline, and pins in the review's own colour: solid on the
 * deadline, outlined on each reminder.
 */
export function planRows(
  p: Plan,
  label: (kind: string) => string,
  date: (iso: string) => string = (iso) => iso,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const peerNominated = p.activities['peer']?.on === true && !p.peer.all;
  const nominationsClose = peerNominated ? resolveDue(p, p.nominations) : null;
  if (nominationsClose !== null)
    rows.push({
      label: 'Nominations',
      meta: `Close ${date(nominationsClose)}`,
      items: [
        {
          id: 'nominations',
          label: 'Nominating',
          start: p.start.date,
          end: nominationsClose,
          tone: 'neutral',
        },
        {
          id: 'nominations-due',
          label: 'Nominations close',
          start: nominationsClose,
          tone: 'neutral',
        },
      ],
    });
  KIND_ORDER.forEach((k, i) => {
    const a = p.activities[k];
    if (a?.on !== true) return;
    const due = resolveDue(p, a.due);
    const tone: ChartTone = TONES[i] ?? 'accent';
    const opens =
      a.due.from === 'nominations' && nominationsClose !== null ? nominationsClose : p.start.date;
    const items: TimelineEntry[] = [
      { id: `${k}-open`, label: label(k), start: opens, end: due < opens ? opens : due, tone },
      { id: `${k}-due`, label: `${label(k)} due`, start: due, tone },
      ...reminders(p.reminders.rules, opens, due)
        .filter((r) => r.date !== due)
        .map((r) => ({
          id: `${k}-remind:${r.rule}@${r.date}`,
          label: t('cycle-plan.reminder', 'Reminder'),
          start: r.date,
          tone,
          tentative: true,
          locked: true,
        })),
    ];
    rows.push({ label: label(k), meta: `Due ${date(due)}`, items });
  });
  const release = p.visibility?.release;
  if (release?.mode === 'hr_date' && release.date !== null)
    rows.push({
      label: 'Release',
      meta: 'Everyone at once',
      items: [{ id: 'release', label: 'Released', start: release.date, tone: 'success' }],
    });
  return rows;
}
