import {
  Bell,
  Calendar,
  CalendarCheck,
  CalendarDays,
  CalendarX,
  Check,
  CircleCheck,
  Download,
  Eye,
  Clock,
  FileText,
  IdCard,
  Inbox as InboxGlyph,
  ListChecks,
  MessageCircle,
  PenLine,
  Pencil,
  Plus,
  PlugZap,
  Send,
  TriangleAlert,
  Undo2,
  Upload,
  User,
  UserMinus,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react-native';

/**
 * The Inbox as the phone draws it (INB-040): the web's merge
 * (`apps/web/src/lib/inbox`), answered already grouped by `/api/mobile/inbox`,
 * so the phone draws and never decides what is due or where it goes.
 */

export type Lane = 'task' | 'update' | 'request' | 'done';
export type LaneName = 'todo' | 'updates' | 'requests' | 'done';
export type Tone = 'accent' | 'danger' | 'info' | 'neutral' | 'success' | 'warning';

export interface Item {
  readonly id: string;
  readonly lane: Lane;
  readonly kind: string;
  readonly module: string;
  readonly area: string | null;
  readonly icon: string;
  readonly tone: Tone | null;
  readonly title: string;
  readonly summary: string | null;
  readonly from: { readonly name: string | null; readonly personId: string | null } | null;
  readonly at: string;
  readonly due: string | null;
  readonly dueVerb: 'due' | 'decide';
  readonly status: { readonly label: string; readonly tone: Tone } | null;
  readonly outcome: { readonly label: string; readonly tone: Tone } | null;
  readonly count: number | null;
  readonly team: {
    readonly role: string;
    readonly takenBy: { readonly name: string | null } | null;
    readonly takenAt: string | null;
    readonly mine: boolean;
  } | null;
  readonly replies: number;
  readonly link: string;
  readonly openIn: string;
  readonly message: string | null;
  readonly detail: unknown;
  readonly unread: boolean;
  readonly snoozedUntil: string | null;
  readonly counted: boolean;
  readonly dim: boolean;
  readonly ticks: readonly string[];
}

export interface Group {
  readonly label: string | null;
  readonly items: readonly Item[];
}

export interface Mute {
  readonly what: string;
  readonly inbox: boolean;
  readonly email: boolean;
  readonly phone: boolean;
}

export interface InboxAnswer {
  readonly lanes: Readonly<Record<LaneName, readonly Group[]>>;
  readonly snoozed: readonly Item[];
  readonly counts: { readonly todo: number; readonly updates: number; readonly requests: number };
  readonly modules: readonly string[];
  readonly unanswered: readonly string[];
  readonly waking: boolean;
  readonly now: string;
  readonly zone: string;
  readonly muted: readonly Mute[];
}

export { dayIn } from './time';
import { dayIn } from './time';

export const MODULE_NAMES: Readonly<Record<string, string>> = {
  people: 'People',
  timeoff: 'Time off',
};
export const moduleName = (m: string): string => MODULE_NAMES[m] ?? m;

/** The design system's word for a row's tile, as the phone draws it. */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  edit: Pencil,
  identifier: IdCard,
  leave: CalendarDays,
  approve: CalendarCheck,
  reject: CalendarX,
  pending: Clock,
  review: InboxGlyph,
  list: ListChecks,
  message: MessageCircle,
  document: PenLine,
  file: FileText,
  system: PlugZap,
  add: Plus,
  send: Send,
  person: User,
  offboard: UserMinus,
  hire: UserPlus,
  success: CircleCheck,
  undo: Undo2,
  warning: TriangleAlert,
  upload: Upload,
  confirm: Check,
  close: X,
  notifications: Bell,
  calendar: Calendar,
  download: Download,
  visible: Eye,
};
export const iconOf = (name: string): LucideIcon => ICONS[name] ?? InboxGlyph;

export const firstName = (name: string | null | undefined): string =>
  (name ?? '').split(' ')[0] ?? '';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (day: string): string =>
  `${String(Number(day.slice(8, 10)))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ''}`;

/** "3 Oct, 09:40", where they work. */
export function when(instant: string, zone: string): string {
  let time = instant.slice(11, 16);
  try {
    time = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(instant));
  } catch {
    // An unknown zone: the instant's own clock.
  }
  return `${shortDay(dayIn(instant, zone))}, ${time}`;
}

/** "12m", "3h", "2d": how long ago, against the time the Inbox answered. */
export function ago(at: string, now: string): string {
  const minutes = Math.max(1, Math.floor((Date.parse(now) - Date.parse(at)) / 60_000));
  if (minutes < 60) return `${String(minutes)}m`;
  if (minutes < 24 * 60) return `${String(Math.floor(minutes / 60))}h`;
  return `${String(Math.floor(minutes / (24 * 60)))}d`;
}

/** A task's due date as its row says it, and how loudly (C9). */
export function dueOf(
  item: Pick<Item, 'due' | 'dueVerb'>,
  now: string,
  zone: string,
): { readonly label: string; readonly tone: 'danger' | 'warning' | 'neutral' } | null {
  if (item.due === null) return null;
  const today = dayIn(now, zone);
  const days = Math.round(
    (Date.parse(`${item.due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  const decide = item.dueVerb === 'decide';
  if (days < 0) return { label: `Overdue ${String(-days)}d`, tone: 'danger' };
  if (days === 0) return { label: decide ? 'Decide today' : 'Due today', tone: 'warning' };
  if (days === 1) return { label: decide ? 'Decide by tomorrow' : 'Due tomorrow', tone: 'warning' };
  return { label: `${decide ? 'Decide by' : 'Due'} ${shortDay(item.due)}`, tone: 'neutral' };
}

/** "1 day", "2.5 days". */
export const days = (n: string | number): string => {
  const v = Number(n);
  return `${Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/u, '')} day${v === 1 ? '' : 's'}`;
};

/** "28–30 December", "30 December – 2 January". */
export function spanLong(from: string, to: string): string {
  const long = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
  if (from === to) return long(from);
  if (from.slice(0, 7) === to.slice(0, 7))
    return `${String(Number(from.slice(8, 10)))}–${long(to)}`;
  return `${long(from)} – ${long(to)}`;
}

/** Snooze choices from now (C6, M:B5), never past the due date. */
export function snoozeChoices(now: Date, due: string | null): { label: string; at: string }[] {
  const at = (offset: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const monday = (8 - now.getDay()) % 7 || 7;
  return [
    ...(now.getHours() < 15 ? [{ label: 'This afternoon', at: at(0, 16) }] : []),
    { label: 'Tomorrow morning', at: at(1, 9) },
    { label: 'Monday', at: at(monday, 9) },
  ]
    .filter((c) => due === null || c.at.toISOString().slice(0, 10) <= due)
    .map((c) => ({ label: c.label, at: c.at.toISOString() }));
}
