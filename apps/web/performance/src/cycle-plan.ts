import type { TimelineEntry, TimelineRow } from '@reach/ui';

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

/** The days a review due on `due` is reminded, by the cycle's rules. */
export function reminderDates(rules: readonly string[], start: string, due: string): string[] {
  const out = new Set<string>();
  for (const rule of rules) {
    const [kind, n] = rule.split(':');
    const every = Math.max(1, Number(n));
    if (kind === 'opens') out.add(start);
    else if (kind === 'on_day') out.add(due);
    else if (kind === 'before') {
      const day = addDays(due, -Number(n));
      if (day >= start) out.add(day);
    } else if (kind === 'late') for (let i = 1; i <= 3; i++) out.add(addDays(due, every * i));
  }
  return [...out].toSorted();
}

const KIND_ORDER = ['self', 'manager', 'peer', 'upward', 'skip'] as const;
const TONES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const;

/**
 * The whole cycle as lanes: a bar for each kind of review from when it opens
 * to its deadline, a pin on the deadline, and a pin on each reminder.
 */
export function planRows(p: Plan, label: (kind: string) => string): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const peerNominated = p.activities['peer']?.on === true && !p.peer.all;
  const nominationsClose = peerNominated ? resolveDue(p, p.nominations) : null;
  if (nominationsClose !== null)
    rows.push({
      label: 'Nominations',
      meta: 'Peers chosen',
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
          tone: 'danger',
        },
      ],
    });
  KIND_ORDER.forEach((k, i) => {
    const a = p.activities[k];
    if (a?.on !== true) return;
    const due = resolveDue(p, a.due);
    const opens =
      a.due.from === 'nominations' && nominationsClose !== null ? nominationsClose : p.start.date;
    const items: TimelineEntry[] = [
      {
        id: `${k}-open`,
        label: label(k),
        start: opens,
        end: due < opens ? opens : due,
        tone: TONES[i] ?? 'accent',
      },
      { id: `${k}-due`, label: `${label(k)} due`, start: due, tone: 'danger' },
      ...reminderDates(p.reminders.rules, opens, due)
        .filter((d) => d !== due)
        .map((d) => ({
          id: `${k}-remind-${d}`,
          label: 'Reminder',
          start: d,
          tone: 'warning' as const,
        })),
    ];
    rows.push({ label: label(k), meta: `Due ${due}`, items });
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
