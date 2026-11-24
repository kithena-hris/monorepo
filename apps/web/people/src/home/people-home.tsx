import {
  Avatar,
  AvatarGroup,
  AvatarUploader,
  Badge,
  BarChart,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type ChartPoint,
  CircularProgress,
  cn,
  dateFormat,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatList,
  type IconName,
  icons,
  KeyValues,
  List,
  ListItem,
  locale,
  PageHeader,
  PersonCard,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Stack,
  Stat,
  Tooltip,
  TooltipProvider,
  TrendChart,
  type UploadedImage,
  VirtualList,
  type VirtualRowProps,
  Widget,
} from '@reach/ui';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type JSX,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { Loaded, type Loadable } from '../load';
import { FieldFiles, FileInput, type UploadOutcome } from '../record/files';
import { localTime } from '../record/display';
import { MissingMark } from '../record/missing';
import { cut, type Grouping, type TaskView, viewOf } from './task-view';
import { t as tr } from '../i18n';

/**
 * Home (design B1, B2; MA B1, B2): People's overview, folded into the app's
 * front page, because Home and People › Overview were two pages answering
 * the same question.
 *
 * Everybody opens on a greeting, in the middle, and what needs them. An
 * employee's Home is one To do list beside who they are: their record, the
 * line above them and who reports to them in one card, then who of the team
 * is away and their own time off, when the host has those to hand over. HR's
 * adds the queue waiting on HR, one list across every kind, each row opening
 * Review with that chip chosen, the records' figures, who is starting and who
 * joined.
 *
 * Nothing on Home takes them off it. Where the host can open a page over
 * Home, a task, a person, a request or a missing detail opens its own page
 * there, to be done whole, and closing it is back on Home. What only informs
 * (who is away, a figure) opens a quick look: the facts, and a button to its
 * page over Home. Each is still a link, so a new tab goes straight to the page.
 *
 * Everything here was decided by People for this viewer: a part they have no
 * use for arrives as null and is simply not drawn, and nothing on the page
 * can show a person or a field People did not hand over. Every time on it is
 * read from when People answered, in their own zone, so the server's page and
 * the browser's are the same page.
 */

export interface OverviewPerson {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  readonly avatarUrl: string | null;
}

export interface PeopleHomeState {
  readonly roles: { readonly hr: boolean; readonly admin: boolean; readonly finance: boolean };
  /** When the page was drawn: what a local time and an age are read against. */
  readonly now: string;
  readonly me: {
    readonly id: string;
    readonly name: string;
    readonly avatarUrl: string | null;
    readonly title: string | null;
    readonly department: string | null;
    readonly email: string | null;
    readonly phone: string | null;
    readonly location: string | null;
    readonly timeZone: string;
    readonly startedOn: string | null;
    readonly today: string;
    readonly status: string | null;
    readonly missing: number | null;
    readonly required: number;
  } | null;
  readonly reportingLine: {
    readonly managers: readonly OverviewPerson[];
    readonly moreAbove: boolean;
    readonly peers: number | null;
    readonly reports: readonly OverviewPerson[];
    readonly reportsTotal: number;
    readonly reportsFilter: string | null;
  } | null;
  readonly approvals: {
    readonly isHr: boolean;
    readonly total: number;
    /** HR's: how many the checks flag, and the newest one's reasons. Absent from an older People. */
    readonly flagged?: number | null;
    readonly flagReason?: string | null;
    readonly items: readonly {
      readonly id: string;
      readonly personId: string;
      readonly name: string;
      readonly avatarUrl: string | null;
      readonly label: string;
      readonly requestedAt: string;
      readonly requestedBy: string;
    }[];
  } | null;
  readonly missing: readonly {
    readonly key: string;
    readonly label: string;
    readonly sectionKey: string;
    readonly section: string;
    /** Null: the viewer fills it in. */
    readonly ownedBy: string | null;
  }[];
  /** Their own identifiers HR sent back, to correct (B1). Absent from an older People. */
  readonly corrections?: readonly {
    readonly key: string;
    readonly label: string;
    readonly sectionKey: string;
    readonly reason: string;
  }[];
  readonly team: { readonly waiting: number; readonly toFill: number } | null;
  /**
   * HR's figures (W2), read by the shell beside the overview: headcount and
   * complete records from analytics, the queues of the Records screens, and
   * who is starting. Absent or null for anybody but HR.
   */
  readonly hr?: {
    readonly headcount: {
      readonly value: number;
      readonly change: number | null;
      readonly trend: readonly ChartPoint[];
    } | null;
    readonly complete: { readonly percent: number; readonly incomplete: number } | null;
    readonly expiring: number | null;
    readonly identifiers: number | null;
    readonly duplicates: number | null;
    readonly accessRequests: number | null;
    /** Who entered the identifiers to check, and who asked for full values. Absent from an older People. */
    readonly identifiersBy?: readonly string[] | null;
    /** What flagged the suspected duplicates: Kithena's check, SCIM provisioning, or both. */
    readonly duplicatesBy?: readonly string[] | null;
    readonly accessRequestsBy?: readonly string[] | null;
    /** People who joined, by month. */
    readonly joiners: readonly ChartPoint[];
    readonly starting: readonly {
      readonly id: string;
      readonly name: string;
      readonly avatarUrl: string | null;
      readonly detail: string;
      readonly missing: number | null;
    }[];
  } | null;
  /**
   * What signing up still asks of them: a photo, and image or document fields
   * collected at sign-up. Absent or null when nothing is left.
   */
  readonly setup?: {
    readonly photo: 'optional' | 'required' | null;
    readonly fields: readonly SetupField[];
  } | null;
}

export interface SetupField {
  readonly key: string;
  readonly sectionKey: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
  readonly required: boolean;
}

export type PhotoOutcome =
  | { readonly ok: true; readonly avatarUrl: string | null }
  | { readonly ok: false; readonly message: string };

export interface PeopleHomeProps {
  readonly load: Loadable<PeopleHomeState>;
  /** Their own photo, uploaded by the shell. */
  readonly onPhoto?: (file: File) => Promise<PhotoOutcome>;
  /** A sign-up file: uploaded, then saved to the field, by the shell. */
  readonly onSetupFile?: (field: SetupField, file: File) => Promise<UploadOutcome>;
  /**
   * The host's To do, when it keeps one across every module (an Inbox):
   * drawn where People's own To do would be, so a person has one list. Plain
   * data, so the server's render can be handed it too.
   */
  readonly toDo?: HostToDo;
  /**
   * What the host calls them: the name they prefer, else their given name.
   * Without it, the first word of the name on their record.
   */
  readonly greeting?: string;
  /** Who of the team is away, now and next, from a host that knows. */
  readonly away?: HostAway;
  /** Their own time off: what is left and what is coming up, from a host that knows. */
  readonly leave?: HostLeave;
  /** Hands a question to the host's assistant, when it has one. */
  readonly onAsk?: (question: string) => void;
  /**
   * Opens a page over Home, from a host that can: a task, a profile or a
   * request is then done there, and closing it is back on Home.
   */
  readonly onOpen?: (href: string, label: string) => void;
  /** Who is away in another of the host's scopes; null when it will not say. */
  readonly onAway?: (scope: string, from?: number) => Promise<HostAway | null>;
  /**
   * What the host is still reading: Home is drawn at once, and each of these
   * says it is loading in its own widget until the host hands it over.
   */
  readonly pending?: { readonly toDo?: boolean; readonly time?: boolean };
}

/** Who is away, already worded by the host: People never learns what leave is. */
export interface HostAway {
  /** Where the whole calendar lives. */
  readonly href: string;
  /** Whose time off this is, and what else the host can be asked for, in words. */
  readonly scope?: string;
  readonly scopes?: readonly { readonly key: string; readonly label: string }[];
  /** How many are away in all: `people` may be the first of them. */
  readonly total?: number;
  readonly people: readonly {
    readonly id: string;
    readonly name: string;
    readonly team?: string;
    /** "Today – Wed 25 Nov". */
    readonly when: string;
    /** "Back Thu 26 Nov", "In 8 days". */
    readonly detail: string;
    readonly now: boolean;
  }[];
}

/** Their own time off, already worded by the host. */
export interface HostLeave {
  readonly href: string;
  /** Where to ask for some. */
  readonly requestHref: string;
  readonly balances: readonly {
    readonly key: string;
    readonly name: string;
    readonly left: string;
    readonly unit: string;
    readonly href: string;
  }[];
  readonly requests: readonly {
    readonly id: string;
    readonly title: string;
    readonly when: string;
    readonly detail: string;
    readonly status: string;
    readonly tone: 'success' | 'warning' | 'info' | 'neutral';
    readonly href: string;
  }[];
}

/** One row of the host's To do, already worded by the host. */
export interface HostTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** `description` without when it is due, from a host that says `due` apart. */
  readonly context?: string;
  /** When it is due, in words: "Overdue 3 days". Drawn at the row's end. */
  readonly due?: string;
  /** Why it is theirs, in a sentence. */
  readonly summary?: string;
  /** Who it is from. */
  readonly from?: string;
  /** When it arrived: "3 Oct". */
  readonly since?: string;
  readonly href: string;
  /** A Reach icon name; an unknown one draws as the Inbox's. */
  readonly icon: string;
  readonly tone?: 'warning' | 'danger' | 'info' | 'accent';
  /** Which module it is from, in words: what To do filters and groups by. */
  readonly module?: string;
  /** Where in the module, when the module names somewhere of its own. */
  readonly area?: string;
  /** The day it is due, as a calendar date. */
  readonly dueDay?: string;
  /** When it arrived, as an instant. */
  readonly at?: string;
  readonly overdue?: boolean;
}

export interface HostToDo {
  /** Where the whole list lives: "Open Inbox". */
  readonly href: string;
  readonly tasks: readonly HostTask[];
  /** Every task that is theirs: `tasks` may be the first of them. */
  readonly total?: number;
  /** What of theirs waits on somebody else. */
  readonly waiting: readonly HostTask[];
}

/* ------------------------------------------------------------- words -- */

const DAY = 86_400_000;

/** "today", "yesterday", "5 days ago": how long something has waited, in days. */
export function waited(since: string, now: string): string {
  const days = Math.max(0, Math.floor((Date.parse(now) - Date.parse(since)) / DAY));
  if (days === 0) return tr('home.people-home.today', 'today');
  if (days === 1) return tr('home.people-home.yesterday', 'yesterday');
  if (days < 60)
    return tr(
      'home.people-home.days_ago_count',
      { one: '{{count}} day ago', other: '{{count}} days ago' },
      { count: days },
    );
  return tr(
    'home.people-home.months_ago_count',
    { one: '{{count}} month ago', other: '{{count}} months ago' },
    { count: Math.floor(days / 30) },
  );
}

/**
 * "2 years, 3 months, 5 days": from a start date to today, both calendar
 * dates. The days are those since the start's day of the month last came
 * round, so the count goes up by one at each midnight.
 */
export function tenure(startedOn: string, today: string): string | null {
  const [y1, m1, d1] = startedOn.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  if ([y1, m1, d1, y2, m2, d2].some((n) => n === undefined || Number.isNaN(n))) return null;
  const before = (d2 ?? 0) < (d1 ?? 0);
  const months = ((y2 ?? 0) - (y1 ?? 0)) * 12 + ((m2 ?? 0) - (m1 ?? 0)) - (before ? 1 : 0);
  if (months < 0) return null;
  // Day 0 of this month is the last day of the one before: how long that month was.
  const lastMonth = new Date(Date.UTC(y2 ?? 0, (m2 ?? 1) - 1, 0)).getUTCDate();
  // A start on the 31st comes round on a shorter month's last day.
  const days = before ? (d2 ?? 0) + Math.max(0, lastMonth - (d1 ?? 0)) : (d2 ?? 0) - (d1 ?? 0);
  if (months === 0 && days === 0) return tr('home.people-home.first_day', 'first day');
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [
    years > 0
      ? tr(
          'home.people-home.count_years',
          { one: '{{count}} year', other: '{{count}} years' },
          { count: years },
        )
      : null,
    rest > 0
      ? tr(
          'home.people-home.count_months',
          { one: '{{count}} month', other: '{{count}} months' },
          { count: rest },
        )
      : null,
    days > 0
      ? tr(
          'home.people-home.count_days',
          { one: '{{count}} day', other: '{{count}} days' },
          { count: days },
        )
      : null,
  ]
    .filter((x) => x !== null)
    .join(', ');
}

/** Today's calendar date where they work, from the clock: it turns over at their midnight. */
function dayIn(now: string, timeZone: string, or: string): string {
  try {
    // Sweden writes a date as the calendar does: 2026-11-24.
    return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone }).format(new Date(now));
  } catch {
    return or;
  }
}

const longDate = (date: string): string =>
  dateFormat({ dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

/** "Wednesday 3 October": today, where they work. */
const weekday = (now: string, timeZone: string): string => {
  try {
    return dateFormat({
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone,
    })
      .format(new Date(now))
      .replace(',', '');
  } catch {
    return '';
  }
};

/** Easter Sunday in the Western churches, as `MM-DD` (the anonymous Gregorian algorithm). */
function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const h =
    (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ponytail: Diwali and the Lunar New Year follow lunisolar calendars. The
// platform carries none for Diwali, and its Chinese calendar is a day late
// when the new moon falls near midnight in Beijing (2027), so their days are
// listed, three years of them. Past the lists Home falls back to the hour; a
// holiday calendar from the host is the way on if this outlives them.
const DIWALI: readonly string[] = ['2026-11-08', '2027-10-29', '2028-10-17'];
const LUNAR_NEW_YEAR: readonly string[] = ['2027-02-06', '2028-01-26', '2029-02-13'];

/** The month and day of an instant in another calendar, where they work. */
function inCalendar(
  calendar: string,
  at: Date,
  timeZone: string,
): { readonly month: string; readonly day: string } {
  const parts = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, {
    month: 'numeric',
    day: 'numeric',
    timeZone,
  }).formatToParts(at);
  const of = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return { month: of('month'), day: of('day') };
}

/**
 * The festival a day is, where they work, or null: New Year, Lunar New Year,
 * Easter, the two Eids, Diwali and Christmas. The fixed ones by the date,
 * Easter by its rule, the Eids by the Islamic calendar the platform carries,
 * and the other two from a list.
 */
export function festivalOf(now: string, timeZone: string): string | null {
  try {
    const at = new Date(now);
    // `en-CA` writes a date as `YYYY-MM-DD`.
    const date = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    }).format(at);
    const day = date.slice(5);
    if (day === '01-01') return 'new_year';
    if (day === '12-25') return 'christmas';
    if (day === easter(Number(date.slice(0, 4)))) return 'easter';
    if (DIWALI.includes(date)) return 'diwali';
    if (LUNAR_NEW_YEAR.includes(date)) return 'lunar_new_year';
    // The Umm al-Qura calendar, Saudi Arabia's: a country that sights the
    // moon itself may keep the day before or after.
    const hijri = inCalendar('islamic-umalqura', at, timeZone);
    if (hijri.month === '10' && hijri.day === '1') return 'eid';
    if (hijri.month === '12' && hijri.day === '10') return 'eid';
    return null;
  } catch {
    return null;
  }
}

/**
 * What Home says first: a festival's greeting on its day, else "Good
 * morning", "Good afternoon" or "Good evening" by the hour, both read where
 * they work when People answered, so the server's page and the browser's agree.
 */
export function greetingOf(now: string, timeZone: string, name: string): string {
  // The festival's own sign after its words, outside what is translated.
  switch (festivalOf(now, timeZone)) {
    case 'new_year':
      return `${tr('home.people-home.happy_new_year', 'Happy New Year, {{name}}!', { name })} 🎉`;
    case 'lunar_new_year':
      return `${tr('home.people-home.happy_lunar_new_year', 'Happy Lunar New Year, {{name}}!', { name })} 🧧`;
    case 'easter':
      return `${tr('home.people-home.happy_easter', 'Happy Easter, {{name}}!', { name })} 🐣`;
    case 'eid':
      return `${tr('home.people-home.eid_mubarak', 'Eid Mubarak, {{name}}!', { name })} 🌙`;
    case 'diwali':
      return `${tr('home.people-home.happy_diwali', 'Happy Diwali, {{name}}!', { name })} 🪔`;
    case 'christmas':
      return `${tr('home.people-home.merry_christmas', 'Merry Christmas, {{name}}!', { name })} 🎄`;
    default:
  }
  let hour = 12;
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(
        new Date(now),
      ),
    );
  } catch {
    // An unknown zone: the afternoon is the least wrong.
  }
  // A wave after an ordinary day's words, as a festival has its sign.
  if (hour >= 5 && hour < 12)
    return `${tr('home.people-home.good_morning', 'Good morning, {{name}}!', { name })} 👋`;
  if (hour >= 12 && hour < 18)
    return `${tr('home.people-home.good_afternoon', 'Good afternoon, {{name}}!', { name })} 👋`;
  return `${tr('home.people-home.good_evening', 'Good evening, {{name}}!', { name })} 👋`;
}

const STATUS: Readonly<
  Record<string, { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' }>
> = {
  active: {
    get label(): string {
      return tr('home.people-home.active', 'Active');
    },
    tone: 'success',
  },
  pre_hire: {
    get label(): string {
      return tr('home.people-home.starting_soon', 'Starting soon');
    },
    tone: 'info',
  },
  onboarding: {
    get label(): string {
      return tr('home.people-home.onboarding', 'Onboarding');
    },
    tone: 'info',
  },
  provisional: {
    get label(): string {
      return tr('home.people-home.not_hired_yet', 'Not hired yet');
    },
    tone: 'neutral',
  },
  on_leave: {
    get label(): string {
      return tr('home.people-home.on_leave', 'On leave');
    },
    tone: 'info',
  },
  notice: {
    get label(): string {
      return tr('home.people-home.on_notice', 'On notice');
    },
    tone: 'warning',
  },
};

/** "Ada" from "Ada Lovelace": what Home calls them. */
const first = (name: string): string => name.split(' ')[0] ?? name;

/** An item in Review, its chip chosen: where each row of Home's lists goes. */
const review = (kind: string, item?: string): string =>
  `/people/review/waiting?kind=${kind}${item === undefined ? '' : `&item=${encodeURIComponent(item)}`}`;
/* --------------------------------------------------------------- peek -- */

/** What a quick look shows: the thing, a few facts, and the way to its page. */
interface Peeked {
  readonly media?: ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly body?: ReactNode;
  /** The page it is a look at, and what the button to it says. */
  readonly href: string;
  readonly go: string;
  /** A question about it for the host's assistant. */
  readonly ask?: string;
  /**
   * Its page does the whole job (a task, a profile, a request): where the
   * host can open a page over Home, a press opens that at once and the look
   * is skipped.
   */
  readonly direct?: boolean;
}

/** What a press on Home can open: a quick look, and a page over Home where the host can. */
interface Looks {
  readonly peek: (peeked: Peeked) => void;
  readonly open: ((href: string, label: string) => void) | null;
}

/** Null where nothing can open, and a link is only a link. */
const PeekContext = createContext<Looks | null>(null);

/** A plain press: a modified one (a new tab, a new window) is the browser's. */
const plain = (event: MouseEvent): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * A link's press, turned into what Home opens over itself: the page, where
 * it does the whole job and the host can open one; else a quick look.
 */
function opens(
  looks: Looks | null,
  peeked: Peeked,
): { readonly onClick?: (event: MouseEvent) => void; readonly 'data-over'?: string } {
  if (looks === null) return {};
  return {
    // What the host opens over Home, said in the markup so it can read it ahead.
    ...(peeked.direct === true && looks.open !== null ? { 'data-over': peeked.href } : {}),
    onClick: (event) => {
      if (!plain(event)) return;
      event.preventDefault();
      if (peeked.direct === true && looks.open !== null) looks.open(peeked.href, peeked.title);
      else looks.peek(peeked);
    },
  };
}

/** A few facts, label over value, two across. */
function Facts({
  items,
}: {
  readonly items: readonly { readonly label: string; readonly value: ReactNode }[];
}): JSX.Element | null {
  return items.length === 0 ? null : <KeyValues layout="stacked" columns={2} items={[...items]} />;
}

/** The quick look itself: one dialog for the page, showing what was last pressed. */
function Peek({
  peeked,
  open,
  onClose,
  onAsk,
  onOpen,
}: {
  readonly peeked: Peeked | null;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onAsk?: ((question: string) => void) | undefined;
  /** Opens its page over Home, where the host can. */
  readonly onOpen: ((href: string, label: string) => void) | null;
}): JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {peeked === null ? null : (
        <DialogContent
          // Focus lands on the look itself, not on its first control: a chart's
          // first point would open its tooltip over the summary.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
          }}
        >
          <DialogHeader className="flex items-center gap-3.5 space-y-0">
            {peeked.media}
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle>{peeked.title}</DialogTitle>
              {peeked.description === undefined ? null : (
                <DialogDescription>{peeked.description}</DialogDescription>
              )}
            </div>
          </DialogHeader>
          {peeked.body === undefined ? null : (
            <DialogBody className="flex flex-col gap-4 pb-4">{peeked.body}</DialogBody>
          )}
          <DialogFooter>
            {peeked.ask === undefined || onAsk === undefined ? null : (
              <Button
                variant="secondary"
                startIcon={<icons.assistant aria-hidden />}
                onClick={() => {
                  onClose();
                  onAsk(peeked.ask ?? '');
                }}
              >
                {tr('home.people-home.ask_the_assistant', 'Ask the assistant')}
              </Button>
            )}
            <Button asChild variant="primary" endIcon={<icons.forward aria-hidden />}>
              <a
                href={peeked.href}
                {...(onOpen === null
                  ? {}
                  : {
                      onClick: (event: MouseEvent) => {
                        if (!plain(event)) return;
                        event.preventDefault();
                        onOpen(peeked.href, peeked.title);
                      },
                    })}
              >
                {peeked.go}
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Somebody's quick look: their face, what they do, and how they relate to the reader. */
const personPeek = (
  person: {
    readonly id: string;
    readonly name: string;
    readonly avatarUrl?: string | null;
    readonly title?: string | null;
  },
  relation: string,
  facts: readonly { readonly label: string; readonly value: ReactNode }[] = [],
): Peeked => ({
  media: <Avatar size="xl" name={person.name} src={person.avatarUrl ?? undefined} />,
  title: person.name,
  ...(person.title == null || person.title === '' ? {} : { description: person.title }),
  body: (
    <>
      <div>
        <Badge size="sm">{relation}</Badge>
      </div>
      <Facts items={facts} />
    </>
  ),
  href: `/people/${person.id}`,
  go: tr('home.people-home.open_profile', 'Open profile'),
  direct: true,
});

/* -------------------------------------------------------------- parts -- */

/**
 * One of Home's widgets: a titled card as wide as what it holds (`span`
 * columns of the dashboard), with its glyph, a count, and one way on.
 */
function Section({
  title,
  action,
  icon,
  tone,
  meta,
  span = 1,
  flush = false,
  children,
  className,
}: {
  readonly title: ReactNode;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
  readonly tone?:
    | 'chart-1'
    | 'chart-2'
    | 'chart-3'
    | 'chart-4'
    | 'chart-5'
    | 'chart-6'
    | 'accent'
    | 'warning'
    | 'success';
  readonly meta?: ReactNode;
  readonly span?: 1 | 2 | 3;
  readonly flush?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return (
    <Widget
      title={title}
      span={span}
      flush={flush}
      {...(action === undefined ? {} : { action })}
      {...(icon === undefined ? {} : { icon })}
      {...(tone === undefined ? {} : { tone })}
      {...(meta === undefined ? {} : { meta })}
      {...(className === undefined ? {} : { className })}
    >
      {children}
    </Widget>
  );
}

/**
 * The way on from a widget, at its header's end: a glyph alone, named for a
 * screen reader and by a tooltip under a pointer, so a row of widgets is not
 * a row of links to read.
 */
function Way({
  href,
  label,
  icon,
  over = false,
}: {
  readonly href: string;
  readonly label: string;
  readonly icon?: ReactNode;
  /** Something to do, not somewhere to go: opens over Home where the host can. */
  readonly over?: boolean;
}): JSX.Element {
  const looks = useContext(PeekContext);
  const open = over ? (looks?.open ?? null) : null;
  return (
    // Its own provider: Home can be drawn in a root no app provider reaches.
    <TooltipProvider>
      <Tooltip content={label}>
        <Button
          asChild
          size="sm"
          variant="ghost"
          aria-label={label}
          startIcon={icon ?? <icons.forward aria-hidden />}
        >
          <a
            href={href}
            {...(open === null
              ? {}
              : {
                  onClick: (event: MouseEvent) => {
                    if (!plain(event)) return;
                    event.preventDefault();
                    open(href, label);
                  },
                })}
          />
        </Button>
      </Tooltip>
    </TooltipProvider>
  );
}

/** A tile for a row: what kind of thing it is, in its tone. */
function Tile({
  icon,
  tone,
  name,
}: {
  readonly icon: ReactNode;
  readonly tone?: 'warning' | 'danger' | 'info' | 'accent';
  readonly name: string;
}): JSX.Element {
  return (
    <Avatar
      size="lg"
      shape="rounded"
      name={name}
      {...(tone === undefined ? {} : { tone })}
      fallback={icon}
    />
  );
}

/**
 * One thing to do (B1): its tile, what it is and where it is from, who sent
 * it and since when on a line of its own, and when it is due at the row's
 * end. The row opens a quick look, with why it is theirs and the way to do it.
 */
function Todo({
  icon,
  tone,
  title,
  description,
  supporting,
  why,
  href,
  due,
  go,
}: {
  readonly icon: ReactNode;
  readonly tone?: 'warning' | 'danger' | 'info' | 'accent';
  readonly title: string;
  readonly description: string;
  /** Who it is from and since when: a line of its own, apart from when it is due. */
  readonly supporting?: string;
  /** Why it is theirs, in a sentence: said in the quick look. */
  readonly why?: string;
  readonly href: string;
  /** When it is due, at the row's end, in the row's tone. */
  readonly due?: string;
  /** What the quick look's button says. */
  readonly go?: string;
}): JSX.Element {
  const peek = useContext(PeekContext);
  const badge =
    due === undefined ? null : (
      <Badge size="sm" tone={tone === 'danger' || tone === 'warning' ? tone : 'neutral'}>
        {due}
      </Badge>
    );
  const tile = <Tile icon={icon} name={title} {...(tone === undefined ? {} : { tone })} />;
  return (
    // The row is one link, named by what it does, with a chevron at the end
    // rather than a button to aim at.
    <ListItem
      asChild
      chevron
      leading={tile}
      description={
        due === undefined ? (
          description
        ) : (
          // Where the widget is narrow the due date is under the title, so
          // the title keeps the row's width.
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{description}</span>
            <span className="@md/col:hidden">{badge}</span>
          </span>
        )
      }
      {...(supporting === undefined ? {} : { supporting })}
      {...(due === undefined
        ? {}
        : { trailing: <span className="hidden @md/col:flex">{badge}</span> })}
    >
      <a
        href={href}
        {...opens(peek, {
          media: tile,
          title,
          description,
          body: (
            <>
              {why === undefined ? null : <p className="text-sm text-fg">{why}</p>}
              <Facts
                items={[
                  ...(due === undefined
                    ? []
                    : [{ label: tr('home.people-home.due', 'Due'), value: badge }]),
                  ...(supporting === undefined
                    ? []
                    : [{ label: tr('home.people-home.sent', 'Sent'), value: supporting }]),
                ]}
              />
            </>
          ),
          href,
          go: go ?? tr('home.people-home.open', 'Open'),
          direct: true,
        })}
      >
        {title}
      </a>
    </ListItem>
  );
}

const iconOf = (name: string): ComponentType<{ 'aria-hidden'?: boolean }> =>
  Object.hasOwn(icons, name) ? icons[name as IconName] : icons.inbox;

/** "From Ada · since 3 Oct": who a task is from and how long it has been theirs. */
const sender = (t: HostTask): string | null => {
  const parts = [
    t.from === undefined
      ? null
      : tr('home.people-home.from_name', 'From {{name}}', { name: t.from }),
    t.since === undefined
      ? null
      : t.from === undefined
        ? tr('home.people-home.since_day_capital', 'Since {{day}}', { day: t.since })
        : tr('home.people-home.since_day', 'since {{day}}', { day: t.since }),
  ].filter((x) => x !== null);
  return parts.length === 0 ? null : parts.join(' · ');
};

/** How many rows a list on Home shows before it says "and more". */
const TOP = 5;
/** How many tasks past the rows drawn a host is told of, to read ahead: what a filter is likeliest to bring up. */
const AHEAD = 15;

/** One small choice in a widget's toolbar: what it is for is its label, read out and shown on the trigger. */
function Pick({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly key: string; readonly label: string }[];
  readonly onChange: (key: string) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}): JSX.Element {
  // A Select has no empty value: "every one of them" travels as a word.
  const ALL = 'all';
  return (
    <Select
      value={value === '' ? ALL : value}
      disabled={disabled}
      onValueChange={(v) => {
        onChange(v === ALL ? '' : v);
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className={className ?? 'w-auto'}>
        <SelectValue>{options.find((o) => o.key === value)?.label ?? label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.key} value={o.key === '' ? ALL : o.key}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A choice kept in this browser for the next visit: the default on the
 * server and until the browser has been read, so the two agree.
 * ponytail: per browser, not per account; move it to the person's
 * preferences if a view should follow them between devices.
 */
function useKept<T>(key: string, read: (raw: unknown) => T): [T, (next: T) => void] {
  const [value, setValue] = useState(() => read(null));
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(read(JSON.parse(raw)));
    } catch {
      // No storage, or not ours: the default stands.
    }
    // `read` is pure and the same every draw: only the key says what to read.
  }, [key]);
  return [
    value,
    (next) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not kept: it still holds for this visit.
      }
    },
  ];
}

/** "Showing 5 of 23", and the way to the rest: said whenever a widget holds back rows. */
function Showing({
  shown,
  of,
  children,
}: {
  readonly shown: number;
  readonly of: number;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <>
      <span className="text-fg-muted tabular-nums">
        {tr('home.people-home.showing_of', 'Showing {{shown}} of {{of}}', {
          shown: String(shown),
          of: String(of),
        })}
      </span>
      <span className="ms-auto">{children}</span>
    </>
  );
}

/**
 * The host's To do: the first five as the reader cuts them (a module, when
 * they are due), in groups and inside groups if they ask, in the order they
 * choose. The count is every task that is theirs; the footer says how many
 * of them show and leads to the rest.
 */
function Tasks({
  toDo,
  today,
  rows,
}: {
  readonly toDo: HostToDo;
  readonly today: string;
  readonly rows: (tasks: readonly HostTask[], label: string) => ReactNode;
}): JSX.Element {
  const [kept, setView] = useKept('kithena.home.todo', viewOf);
  const modules = [
    ...new Set(toDo.tasks.flatMap((t) => (t.module === undefined ? [] : [t.module]))),
  ].toSorted((a, b) => a.localeCompare(b));
  // A module kept from another day that has no task today is every module.
  const view: TaskView = modules.includes(kept.module) ? kept : { ...kept, module: '' };
  const words = {
    overdue: tr('home.people-home.overdue', 'Overdue'),
    week: tr('home.people-home.due_this_week', 'Due this week'),
    later: tr('home.people-home.due_later', 'Due later'),
    noDue: tr('home.people-home.no_due_date', 'No due date'),
    noArea: tr('home.people-home.general', 'General'),
    noSender: tr('home.people-home.no_sender', 'From nobody in particular'),
    noModule: tr('home.people-home.other', 'Other'),
  };
  const { sections, matched } = cut(toDo.tasks, view, today, words, TOP);
  const shown = sections.reduce((n, s) => n + s.tasks.length, 0);
  const total = Math.max(toDo.total ?? 0, toDo.tasks.length);
  const filtered = view.module !== '' || view.due !== 'any';
  // What the footer counts against: the tasks that match, or all of theirs.
  const of = filtered ? matched : total;
  const drawn = new Set(sections.flatMap((s) => s.tasks.map((t) => t.id)));
  const GROUPS: Readonly<Record<Grouping, string>> = {
    none: tr('home.people-home.no_grouping', 'No grouping'),
    module: tr('home.people-home.module', 'Module'),
    area: tr('home.people-home.area', 'Area in the module'),
    due: tr('home.people-home.when_due', 'When it is due'),
    from: tr('home.people-home.sender', 'Who it is from'),
  };
  const groupOptions = (Object.keys(GROUPS) as Grouping[]).map((key) => ({
    key,
    label: GROUPS[key],
  }));
  const set = (change: Partial<TaskView>): void => {
    setView(viewOf({ ...view, ...change }));
  };
  const label = 'text-xs font-semibold text-fg-subtle';
  const all = toDo.href;
  return (
    <Widget
      title={tr('home.people-home.to_do', 'To do')}
      icon={<icons.inbox aria-hidden />}
      tone="accent"
      {...(total === 0 ? {} : { meta: total })}
      span={2}
      flush={toDo.tasks.length > 0}
      // One way to the Inbox: the footer's when rows are held back, the header's when all show.
      {...(shown < of
        ? {}
        : { action: <Way href={all} label={tr('home.people-home.open_inbox', 'Open Inbox')} /> })}
      {...(toDo.tasks.length === 0
        ? {}
        : {
            toolbar: (
              <>
                {modules.length < 2 ? null : (
                  <Pick
                    label={tr('home.people-home.filter_by_module', 'Filter by module')}
                    value={view.module}
                    options={[
                      { key: '', label: tr('home.people-home.all_modules', 'All modules') },
                      ...modules.map((m) => ({ key: m, label: m })),
                    ]}
                    onChange={(module) => {
                      set({ module });
                    }}
                  />
                )}
                <Pick
                  label={tr('home.people-home.filter_by_due', 'Filter by when it is due')}
                  value={view.due}
                  options={[
                    { key: 'any', label: tr('home.people-home.any_time', 'Any time') },
                    { key: 'overdue', label: words.overdue },
                    {
                      key: 'week',
                      label: tr('home.people-home.overdue_or_this_week', 'Overdue or this week'),
                    },
                  ]}
                  onChange={(due) => {
                    set({ due: due as TaskView['due'] });
                  }}
                />
                {/* Grouping and order are how it is laid out, not which tasks: one menu, at the end. */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ms-auto"
                      startIcon={<icons.adjust aria-hidden />}
                    >
                      {tr('home.people-home.view', 'View')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
                    <Stack gap={3}>
                      <div className="flex flex-col gap-1.5">
                        <span className={label}>{tr('home.people-home.group_by', 'Group by')}</span>
                        <Pick
                          label={tr('home.people-home.group_by', 'Group by')}
                          value={view.group}
                          options={groupOptions}
                          className="w-full"
                          onChange={(group) => {
                            set({ group: group as Grouping });
                          }}
                        />
                      </div>
                      {view.group === 'none' ? null : (
                        <div className="flex flex-col gap-1.5">
                          <span className={label}>
                            {tr('home.people-home.then_by', 'Then, inside each group, by')}
                          </span>
                          <Pick
                            label={tr('home.people-home.then_by', 'Then, inside each group, by')}
                            value={view.inside}
                            options={groupOptions.filter((o) => o.key !== view.group)}
                            className="w-full"
                            onChange={(inside) => {
                              set({ inside: inside as Grouping });
                            }}
                          />
                        </div>
                      )}
                      <div className="flex flex-col gap-1.5">
                        <span className={label}>{tr('home.people-home.sort_by', 'Sort by')}</span>
                        <Pick
                          label={tr('home.people-home.sort_by', 'Sort by')}
                          value={view.sort}
                          options={[
                            { key: 'due', label: tr('home.people-home.due_first', 'Due first') },
                            {
                              key: 'newest',
                              label: tr('home.people-home.newest_first', 'Newest first'),
                            },
                            {
                              key: 'oldest',
                              label: tr('home.people-home.oldest_first', 'Oldest first'),
                            },
                          ]}
                          className="w-full"
                          onChange={(sort) => {
                            set({ sort: sort as TaskView['sort'] });
                          }}
                        />
                      </div>
                    </Stack>
                  </PopoverContent>
                </Popover>
              </>
            ),
          })}
      {...(shown >= of
        ? {}
        : {
            footer: (
              <Showing shown={shown} of={of}>
                <Button asChild size="sm" variant="ghost" endIcon={<icons.forward aria-hidden />}>
                  <a href={all}>
                    {tr(
                      'home.people-home.see_all_count_in_the_inbox',
                      'See all {{count}} in the Inbox',
                      { count: String(total) },
                    )}
                  </a>
                </Button>
              </Showing>
            ),
          })}
    >
      {toDo.tasks.length === 0 ? (
        <Done
          title={tr('home.people-home.nothing_needs_you', 'Nothing needs you')}
          detail={tr(
            'home.people-home.new_tasks_from_every_part_of',
            'New tasks from every part of the app show up here.',
          )}
        />
      ) : shown === 0 ? (
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm text-fg-muted touch:px-4">
          {tr('home.people-home.no_task_matches', 'No task matches these filters.')}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              set({ module: '', due: 'any' });
            }}
          >
            {tr('home.people-home.clear_filters', 'Clear filters')}
          </Button>
        </div>
      ) : (
        sections.map((section) => {
          const name = [section.group, section.sub].filter((x) => x !== null).join(' › ');
          return (
            <section key={name} aria-label={name === '' ? undefined : name}>
              {name === '' ? null : (
                <h3 className="flex items-center gap-2 bg-surface-sunken px-5 py-1.5 text-xs font-semibold text-fg-muted touch:px-4">
                  {name}
                  <span className="font-medium tabular-nums">{section.count}</span>
                </h3>
              )}
              {rows(section.tasks, name === '' ? tr('home.people-home.to_do', 'To do') : name)}
            </section>
          );
        })
      )}
      {/* The next tasks not drawn, named for a host that reads ahead what a row opens. */}
      {toDo.tasks
        .filter((t) => !drawn.has(t.id))
        .slice(0, AHEAD)
        .map((t) => (
          <span key={t.id} hidden data-over={t.href} />
        ))}
    </Widget>
  );
}

/** A widget whose rows the host is still reading: its header as it will be, and a loader where they go. */
function Waiting({
  title,
  icon,
  tone,
  span = 1,
}: {
  readonly title: string;
  readonly icon: ReactNode;
  readonly tone: 'accent' | 'chart-3' | 'chart-4';
  readonly span?: 1 | 2;
}): JSX.Element {
  return (
    <Widget title={title} icon={icon} tone={tone} span={span} aria-busy>
      <div className="grid min-h-28 place-items-center">
        <Spinner label={tr('home.people-home.loading_title', 'Loading {{title}}', { title })} />
      </div>
    </Widget>
  );
}

/** The host's To do and what waits on others, in People's own rows. */
function HostList({
  toDo,
  today,
}: {
  readonly toDo: HostToDo;
  /** Today where they work, as a calendar date: what "overdue" and "this week" are read against. */
  readonly today: string;
}): JSX.Element {
  const rows = (tasks: readonly HostTask[], label: string) => (
    <List aria-label={label} className={ROWS_IN}>
      {tasks.map((t) => {
        const Icon = iconOf(t.icon);
        return (
          <Todo
            key={t.id}
            icon={<Icon aria-hidden />}
            {...(t.tone === undefined ? {} : { tone: t.tone })}
            title={t.title}
            description={t.due === undefined ? t.description : (t.context ?? t.description)}
            {...(sender(t) === null ? {} : { supporting: sender(t) ?? '' })}
            {...(t.summary === undefined ? {} : { why: t.summary })}
            {...(t.due === undefined ? {} : { due: t.due })}
            href={t.href}
          />
        );
      })}
    </List>
  );
  return (
    <>
      <Tasks toDo={toDo} today={today} rows={rows} />
      {toDo.waiting.length === 0 ? null : (
        <Section
          title={tr('home.people-home.waiting_on_others', 'Waiting on others')}
          icon={<icons.pending aria-hidden />}
          meta={toDo.waiting.length}
          span={2}
          flush
          action={
            <Way
              href="/inbox/requests"
              label={tr('home.people-home.see_all_requests', 'See all your requests')}
            />
          }
        >
          {rows(toDo.waiting, tr('home.people-home.waiting_on_others', 'Waiting on others'))}
        </Section>
      )}
    </>
  );
}

/** Done, said quietly: the state is good news, not an empty page. */
function Done({ title, detail }: { readonly title: string; readonly detail: string }): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className="mt-0.5 shrink-0 text-success-fg [&_svg]:size-4">
        <icons.success />
      </span>
      <p className="max-w-prose text-sm text-fg-muted">
        <span className="font-medium text-fg">{title}.</span> {detail}
      </p>
    </div>
  );
}

/**
 * The one To do list (B1, MA B1): what of theirs is missing, and what of
 * theirs waits on somebody else, one row and one button each, with how
 * complete their record is beside the title. What only HR fills in is named
 * underneath, as nothing for them to do.
 */
function ToDo({
  state,
  me,
}: {
  readonly state: PeopleHomeState;
  readonly me: NonNullable<PeopleHomeState['me']>;
}): JSX.Element {
  const yours = state.missing.filter((m) => m.ownedBy === null);
  const theirs = state.missing.filter((m) => m.ownedBy !== null);
  const percent =
    me.required === 0
      ? 100
      : Math.round(((me.required - state.missing.length) / me.required) * 100);
  // Their own changes waiting for a decision: an employee's are theirs; HR's are under Review.
  const changes = state.approvals !== null && !state.approvals.isHr ? state.approvals.items : [];
  // What HR sent back comes first: nothing else of theirs is wrong rather than missing.
  const corrections = state.corrections ?? [];
  const rows = corrections.length + yours.length + changes.length;
  return (
    <Section
      title={tr('home.people-home.to_do', 'To do')}
      icon={<icons.inbox aria-hidden />}
      tone="accent"
      span={2}
      action={
        <div className="flex items-center gap-2">
          <CircularProgress
            value={percent}
            size={40}
            showValue={false}
            label={tr(
              'home.people-home.of_required_missing',
              {
                one: '{{length}} of {{count}} required detail missing',
                other: '{{length}} of {{count}} required details missing',
              },
              { count: me.required, length: String(state.missing.length) },
            )}
            tone={percent >= 100 ? 'success' : 'accent'}
          />
          <span className="text-sm text-fg-muted">
            <b className="text-fg">{percent}%</b>{' '}
            {tr('home.people-home.of_your_record', 'of your record')}
          </span>
        </div>
      }
    >
      {rows === 0 ? (
        <Done
          title={
            state.missing.length === 0
              ? tr('home.people-home.your_record_is_complete', 'Your record is complete')
              : tr('home.people-home.nothing_for_you_to_do', 'Nothing for you to do')
          }
          detail={
            state.missing.length === 0
              ? tr(
                  'home.people-home.everything_people_asks_of_you_is',
                  'Everything People asks of you is filled in. If a new detail is needed, it shows up here.',
                )
              : tr(
                  'home.people-home.what_is_left_is_for_somebody',
                  'What is left is for somebody else to fill in.',
                )
          }
        />
      ) : (
        <List
          aria-label={tr('home.people-home.to_do', 'To do')}
          className={cn('-mx-5 touch:-mx-4', ROWS_IN)}
        >
          {corrections.map((c) => (
            <Todo
              key={`correct-${c.key}`}
              icon={<icons.warning aria-hidden />}
              tone="danger"
              title={tr('home.people-home.correct_your', 'Correct your {{label}}', {
                label: c.label,
              })}
              description={tr(
                'home.people-home.hr_could_not_accept_it',
                'HR could not accept it: {{charAt}}{{slice}}',
                { charAt: c.reason.charAt(0).toLowerCase(), slice: c.reason.slice(1) },
              )}
              href={`/people/me?field=${encodeURIComponent(c.key)}`}
            />
          ))}
          {yours.map((m) => (
            <Todo
              key={m.key}
              icon={<icons.missing aria-hidden />}
              title={tr('home.people-home.add_your', 'Add your {{label}}', {
                label: m.label.toLowerCase(),
              })}
              description={m.section}
              href={`/people/me?field=${encodeURIComponent(m.key)}`}
            />
          ))}
          {changes.map((c) => (
            <Todo
              key={c.id}
              icon={<icons.scheduled aria-hidden />}
              title={tr('home.people-home.your_new_is_with_hr', 'Your new {{label}} is with HR', {
                label: c.label.toLowerCase(),
              })}
              description={tr(
                'home.people-home.sent_nothing_changes_until_hr_approves',
                'Sent {{waited}} · nothing changes until HR approves',
                { waited: waited(c.requestedAt, state.now) },
              )}
              go={inReviewWord()}
              href={review('changes', `change-${c.id}`)}
            />
          ))}
        </List>
      )}
      {theirs.length === 0 ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-muted">
            {tr('home.people-home.waiting_on', 'Waiting on')}{' '}
            {formatList(
              [...new Set(theirs.map((m) => m.ownedBy))].filter((o): o is string => o !== null),
            )}
            {tr('home.people-home.nothing_for_you_to_do_2', ', nothing for you to do:')}
          </span>
          <ul
            aria-label={tr('home.people-home.waiting_on_somebody_else', 'Waiting on somebody else')}
            className="contents"
          >
            {theirs.map((m) => (
              <li key={m.key}>
                <Badge size="sm">{m.label}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

/** A part of a card, named: a small heading over what it holds. */
function Part({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-1 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Who they are (B1), in one card: photo, name, what they do, their badges
 * and facts; then a small org chart: the line above them from the top, a
 * card each joined by a line, themselves, and who reports to them as faces
 * under it. A card or a face opens a quick look at that person, and how many
 * details are missing opens which.
 */
function Profile({
  me,
  now,
  line,
  missing,
}: {
  readonly me: NonNullable<PeopleHomeState['me']>;
  readonly now: string;
  readonly line: PeopleHomeState['reportingLine'];
  readonly missing: PeopleHomeState['missing'];
}): JSX.Element {
  const peek = useContext(PeekContext);
  const role = [me.title, me.department, me.location].filter((x) => x !== null).join(' · ');
  const status = me.status === null ? undefined : STATUS[me.status];
  const time = localTime(now, me.timeZone);
  // Counted from the clock, so it is a day more at their midnight without a reload.
  const since =
    me.startedOn === null ? null : tenure(me.startedOn, dayIn(now, me.timeZone, me.today));
  // Top of the chart first, as an org chart reads.
  const above = line === null ? [] : line.managers.toReversed();
  const manager = line?.managers[0];
  return (
    <Widget
      title={tr('home.people-home.your_profile', 'Your profile')}
      icon={<icons.person aria-hidden />}
      tone="chart-2"
      action={
        <>
          {line === null ? null : (
            <Way
              href="/people/directory/org-chart"
              label={tr('home.people-home.open_the_org_chart', 'Open the org chart')}
              icon={<icons.hierarchy aria-hidden />}
            />
          )}
          <Way
            href="/people/me"
            label={tr('home.people-home.open_your_profile', 'Open your profile')}
          />
        </>
      }
    >
      <div className="flex items-center gap-3.5">
        <Avatar
          size="xl"
          name={me.name}
          src={me.avatarUrl ?? undefined}
          {...(status === undefined ? {} : { status: status.tone })}
        />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold tracking-tight text-fg">{me.name}</p>
          {role === '' ? null : <p className="text-sm text-fg-muted">{role}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {status === undefined ? null : (
          <Badge size="sm" dot tone={status.tone}>
            {status.label}
          </Badge>
        )}
        {me.missing === null || me.missing === 0 ? null : peek === null || missing.length === 0 ? (
          <MissingMark count={me.missing} />
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="relative tap-target h-auto p-0"
            aria-haspopup="dialog"
            {...(peek.open === null ? {} : { 'data-over': `/people/${me.id}?fill=missing` })}
            onClick={() => {
              // Where the host can, the fields themselves, to fill in and save there.
              if (peek.open !== null) {
                peek.open(
                  `/people/${me.id}?fill=missing`,
                  tr('home.people-home.missing_details', 'Missing details'),
                );
                return;
              }
              peek.peek({
                media: <Tile icon={<icons.missing aria-hidden />} name="Missing" tone="warning" />,
                title: tr('home.people-home.missing_details', 'Missing details'),
                description: tr(
                  'home.people-home.of_required_missing',
                  {
                    one: '{{length}} of {{count}} required detail missing',
                    other: '{{length}} of {{count}} required details missing',
                  },
                  { count: me.required, length: String(missing.length) },
                ),
                body: (
                  <List
                    className="-mx-6 touch:-mx-5.5"
                    aria-label={tr('home.people-home.missing_details', 'Missing details')}
                  >
                    {missing.map((m) =>
                      m.ownedBy === null ? (
                        <ListItem key={m.key} asChild chevron description={m.section}>
                          <a
                            href={`/people/me?field=${encodeURIComponent(m.key)}`}
                            {...(peek.open === null
                              ? {}
                              : {
                                  onClick: (event: MouseEvent) => {
                                    if (!plain(event)) return;
                                    event.preventDefault();
                                    peek.open?.(
                                      `/people/me?field=${encodeURIComponent(m.key)}`,
                                      m.label,
                                    );
                                  },
                                })}
                          >
                            {m.label}
                          </a>
                        </ListItem>
                      ) : (
                        <ListItem
                          key={m.key}
                          description={tr(
                            'home.people-home.filled_in_by',
                            '{{section}} · filled in by {{who}}',
                            { section: m.section, who: m.ownedBy },
                          )}
                        >
                          {m.label}
                        </ListItem>
                      ),
                    )}
                  </List>
                ),
                href: '/people/me',
                go: tr('home.people-home.open_your_profile', 'Open your profile'),
              });
            }}
          >
            <MissingMark count={me.missing} />
          </Button>
        )}
      </div>
      <KeyValues
        layout="stacked"
        columns={2}
        aria-label={tr('home.people-home.your_details', 'Your details')}
        items={[
          ...(time === ''
            ? []
            : [{ label: tr('home.people-home.local_time', 'Local time'), value: time }]),
          ...(me.startedOn === null
            ? []
            : [
                since === null
                  ? {
                      label: tr('home.people-home.joined', 'Joined'),
                      value: longDate(me.startedOn),
                    }
                  : {
                      label: tr('home.people-home.time_at_the_company', 'Time at the company'),
                      value: tr('home.people-home.tenure_since', '{{tenure}} (since {{date}})', {
                        tenure: since,
                        date: longDate(me.startedOn),
                      }),
                    },
              ]),
          ...(me.email === null
            ? []
            : [
                {
                  label: tr('home.people-home.email', 'Email'),
                  value: (
                    <a
                      className="relative tap-target break-all text-accent-fg underline-offset-4 hover:underline"
                      href={`mailto:${me.email}`}
                    >
                      {me.email}
                    </a>
                  ),
                },
              ]),
          ...(me.phone === null
            ? []
            : [
                {
                  label: tr('home.people-home.phone', 'Phone'),
                  value: (
                    <a
                      className="relative tap-target text-accent-fg underline-offset-4 hover:underline"
                      href={`tel:${me.phone}`}
                    >
                      {me.phone}
                    </a>
                  ),
                },
              ]),
        ]}
      />
      {line === null || (above.length === 0 && line.reportsTotal === 0) ? null : (
        <Part title={tr('home.people-home.your_reporting_line', 'Your reporting line')}>
          <ol
            className="flex flex-col items-center pt-2"
            aria-label={tr(
              'home.people-home.your_managers_from_the_top',
              'Your managers, from the top',
            )}
          >
            {above.map((m) => {
              const relation =
                m.id === manager?.id
                  ? tr('home.people-home.your_manager', 'Your manager')
                  : tr('home.people-home.above_you', 'In your reporting line');
              return (
                <li key={m.id} className="flex w-full max-w-sm flex-col items-center">
                  <PersonCard
                    layout="row"
                    className="w-full"
                    name={m.name}
                    {...(m.avatarUrl === null ? {} : { avatarSrc: m.avatarUrl })}
                    description={
                      m.id === manager?.id
                        ? m.title == null || m.title === ''
                          ? relation
                          : tr('home.people-home.your_manager_title', 'Your manager · {{title}}', {
                              title: m.title,
                            })
                        : (m.title ?? undefined)
                    }
                    href={`/people/${m.id}`}
                    {...opens(peek, personPeek(m, relation))}
                  />
                  <span aria-hidden className="h-4 w-px bg-border-strong" />
                </li>
              );
            })}
            <li className="w-full max-w-sm">
              <PersonCard
                layout="row"
                selected
                name={me.name}
                {...(me.avatarUrl === null ? {} : { avatarSrc: me.avatarUrl })}
                description={[tr('home.people-home.you', 'You'), me.title]
                  .filter((x) => x !== null && x !== '')
                  .join(' · ')}
                {...(line.peers === null || manager === undefined || line.peers === 0
                  ? {}
                  : {
                      note: tr(
                        'home.people-home.to',
                        {
                          one: '{{count}} other reports to {{first}}.',
                          other: '{{count}} others report to {{first}}.',
                        },
                        { count: line.peers, first: first(manager.name) },
                      ),
                    })}
              />
            </li>
          </ol>
          {line.reportsTotal === 0 ? null : (
            <div className="flex flex-col items-center gap-1.5">
              <span aria-hidden className="h-4 w-px bg-border-strong" />
              <p className="text-xs font-medium text-fg-muted">
                {tr(
                  'home.people-home.count_direct_reports',
                  { one: '{{count}} direct report', other: '{{count}} direct reports' },
                  { count: line.reportsTotal },
                )}
              </p>
              <div className="flex items-center gap-2">
                <AvatarGroup
                  max={6}
                  total={line.reportsTotal}
                  aria-label={tr('home.people-home.your_direct_reports', 'Your direct reports')}
                >
                  {line.reports.map((r) => (
                    // A face opens a quick look at them.
                    <a
                      key={r.id}
                      href={`/people/${r.id}`}
                      title={r.name}
                      className="relative tap-target rounded-full focus-visible:outline-2 focus-visible:outline-border-focus"
                      {...opens(
                        peek,
                        personPeek(r, tr('home.people-home.reports_to_you', 'Reports to you')),
                      )}
                    >
                      {/* Named in full for a screen reader; the initials are the picture. */}
                      <span aria-hidden>
                        <Avatar size="md" name={r.name} src={r.avatarUrl ?? undefined} />
                      </span>
                      <span className="sr-only">{r.name}</span>
                    </a>
                  ))}
                </AvatarGroup>
                {line.reportsFilter === null ? null : (
                  <Way
                    href={`/people/directory/list?filter=${encodeURIComponent(line.reportsFilter)}`}
                    label={tr(
                      'home.people-home.see_them_in_the_directory',
                      {
                        one: 'See your {{count}} direct report in the directory',
                        other: 'See your {{count}} direct reports in the directory',
                      },
                      { count: line.reportsTotal },
                    )}
                  />
                )}
              </div>
            </div>
          )}
        </Part>
      )}
    </Widget>
  );
}

type AwayPerson = HostAway['people'][number];
/** A row's height before it is measured: a face, a name and a line under it. */
const AWAY_ROW_PX = 64;
/** The list's height by how many rows it holds: a virtual list needs one, and a short list should not be a tall box. */
const AWAY_HEIGHT: readonly (string | undefined)[] = [
  undefined,
  'h-16',
  'h-32',
  'h-48',
  'h-64',
  'h-80',
  'h-96',
];

/**
 * Whose time off is shown: the host's scope (their team, the whole company,
 * a department), asked of the host when it changes, and the pages after the
 * first, asked for as the full list nears its end. The widget and the full
 * list each hold their own, the list starting from what the widget shows.
 */
function useAway(
  first: HostAway,
  onAway: PeopleHomeProps['onAway'],
): {
  readonly away: HostAway;
  readonly people: readonly AwayPerson[];
  /** Every one away in this scope, loaded or not. */
  readonly total: number;
  /** The scope choices, for a toolbar; null when there is nothing to choose. */
  readonly choices: ReactNode;
  readonly busy: boolean;
  /** Asks the host for the next page; undefined when every one is loaded. */
  readonly more: (() => void) | undefined;
  readonly loading: boolean;
} {
  const [away, setAway] = useState(first);
  // The pages after the host's first, of the scope they were read in.
  const [later, setLater] = useState<readonly AwayPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refused, setRefused] = useState(false);
  const scopes = away.scopes ?? [];
  const people = later.length === 0 ? away.people : [...away.people, ...later];
  const total = Math.max(away.total ?? 0, people.length);
  const choices =
    onAway === undefined || scopes.length < 2 ? null : (
      <>
        <Pick
          label={tr('home.people-home.whose_time_off', 'Whose time off')}
          value={away.scope ?? ''}
          options={scopes}
          disabled={busy}
          onChange={(scope) => {
            setBusy(true);
            setRefused(false);
            void onAway(scope)
              .catch(() => null)
              .then((next) => {
                setBusy(false);
                if (next === null) setRefused(true);
                else {
                  setAway(next);
                  setLater([]);
                }
              });
          }}
        />
        {busy ? <Spinner size="sm" label={tr('home.people-home.reading', 'Reading')} /> : null}
        {refused ? (
          <span role="status" className="text-sm text-fg-muted">
            {tr(
              'home.people-home.time_off_does_not_show_you_that',
              'Time Off does not show you that.',
            )}
          </span>
        ) : null}
      </>
    );
  const scope = away.scope;
  const more =
    onAway === undefined || scope === undefined || people.length >= total || busy || loading
      ? undefined
      : (): void => {
          setLoading(true);
          void onAway(scope, people.length)
            .catch(() => null)
            .then((next) => {
              setLoading(false);
              // Nothing more to give (or refused): stop asking.
              if (next === null || next.people.length === 0) {
                setAway((had) => ({ ...had, total: people.length }));
                return;
              }
              const had = new Set(people.map((p) => p.id));
              setLater((old) => [...old, ...next.people.filter((p) => !had.has(p.id))]);
            });
        };
  return { away, people, total, choices, busy, more, loading };
}

/** One person away, as a row: a face, when, and when they are back or how soon they go. */
function AwayRow({
  p,
  row,
}: {
  readonly p: AwayPerson;
  /** In a list that draws only the rows in view: where this one stands. */
  readonly row?: VirtualRowProps;
}): JSX.Element {
  return (
    <ListItem
      {...row}
      leading={
        <Avatar size="lg" name={p.name} {...(p.now ? { status: 'warning' as const } : {})} />
      }
      description={[p.team, p.when].filter((x) => x !== undefined).join(' · ')}
      trailing={
        <span className="flex items-center gap-3">
          <Badge size="sm" tone={p.now ? 'warning' : 'neutral'}>
            {p.now ? tr('home.people-home.out_today', 'Out today') : p.detail}
          </Badge>
          {p.now ? (
            <span className="hidden text-sm whitespace-nowrap text-fg-muted @md/col:inline">
              {p.detail}
            </span>
          ) : null}
        </span>
      }
    >
      {p.name}
    </ListItem>
  );
}

/** Everyone away, in the quick look: the same choices as the widget, and every row. */
function AwayAll({
  first,
  onAway,
}: {
  readonly first: HostAway;
  readonly onAway: PeopleHomeProps['onAway'];
}): JSX.Element {
  const { people, total, choices, busy, more, loading } = useAway(first, onAway);
  const count = tr(
    'home.people-home.count_people_away',
    {
      one: '{{count}} person away, today and next',
      other: '{{count}} people away, today and next',
    },
    { count: total },
  );
  return (
    <div className="flex flex-col gap-3">
      {choices === null ? null : <div className="flex flex-wrap items-center gap-2">{choices}</div>}
      <p className="text-sm text-fg-muted" aria-live="polite">
        {count}
      </p>
      {people.length === 0 ? (
        <Done
          title={tr('home.people-home.everyone_is_in', 'Everyone is in')}
          detail={tr(
            'home.people-home.nobody_here_is_away',
            'Nobody here is away in the next three weeks.',
          )}
        />
      ) : (
        // Only the rows in view are drawn, and the next page is asked for near the end.
        <VirtualList
          label={count}
          items={people}
          itemKey={(p) => p.id}
          listItems
          estimateItemHeight={AWAY_ROW_PX}
          total={total}
          loadingMore={loading}
          {...(more === undefined ? {} : { onEndReached: more })}
          // As tall as a few rows are; a little over half the window for more.
          className={`${AWAY_HEIGHT[people.length] ?? 'h-[55vh]'} ${busy ? 'opacity-60' : ''}`}
          renderItem={(p, _i, row) => <AwayRow key={p.id} p={p} row={row} />}
        />
      )}
    </div>
  );
}

/**
 * Who is away, today first and then who is next, from a host that knows:
 * the first five of the reader's team, or of whoever they choose, and the
 * rest in one list over Home.
 */
function Away({
  away: first,
  onAway,
}: {
  readonly away: HostAway;
  readonly onAway: PeopleHomeProps['onAway'];
}): JSX.Element {
  const peek = useContext(PeekContext);
  const { away, people, total, choices, busy } = useAway(first, onAway);
  const out = people.filter((p) => p.now).length;
  const shown = people.slice(0, TOP);
  const title = tr('home.people-home.whos_out', 'Who’s out');
  const everyone = {
    media: <Tile icon={<icons.calendar aria-hidden />} name="Away" tone="info" />,
    title,
    // Starts from what the widget shows, and is drawn again when that changes.
    body: <AwayAll key={`${away.scope ?? ''}:${String(total)}`} first={away} onAway={onAway} />,
    href: away.href,
    go: tr('home.people-home.open_the_team_calendar', 'Open the team calendar'),
  };
  return (
    <Widget
      title={title}
      icon={<icons.calendar aria-hidden />}
      tone="chart-4"
      {...(total === 0 ? {} : { meta: total })}
      flush={people.length > 0}
      action={
        <Way
          href={away.href}
          label={tr('home.people-home.open_the_team_calendar', 'Open the team calendar')}
        />
      }
      {...(choices === null ? {} : { toolbar: choices })}
      {...(shown.length >= total
        ? {}
        : {
            footer: (
              <Showing shown={shown.length} of={total}>
                <Button asChild size="sm" variant="ghost" endIcon={<icons.forward aria-hidden />}>
                  <a href={away.href} aria-haspopup="dialog" {...opens(peek, everyone)}>
                    {tr('home.people-home.see_everyone', 'See everyone')}
                  </a>
                </Button>
              </Showing>
            ),
          })}
    >
      {people.length === 0 ? (
        <Done
          title={tr('home.people-home.everyone_is_in', 'Everyone is in')}
          detail={tr(
            'home.people-home.nobody_here_is_away',
            'Nobody here is away in the next three weeks.',
          )}
        />
      ) : (
        <List
          aria-label={
            out === 0
              ? tr('home.people-home.away_next', 'Away next')
              : tr('home.people-home.away_today_and_next', 'Away today and next')
          }
          className={cn(ROWS_IN, busy && 'opacity-60')}
        >
          {shown.map((p) => (
            <AwayRow key={p.id} p={p} />
          ))}
        </List>
      )}
    </Widget>
  );
}

/**
 * Their own time off, from a host that knows: what is left of the first two
 * balances, then what is coming up with where each request stands.
 */
function Leave({ leave }: { readonly leave: HostLeave }): JSX.Element {
  const peek = useContext(PeekContext);
  return (
    <Section
      title={tr('home.people-home.your_time_off', 'Your time off')}
      icon={<icons.vacation aria-hidden />}
      tone="chart-3"
      action={
        <>
          <Way
            href={leave.requestHref}
            label={tr('home.people-home.request_time_off', 'Request time off')}
            icon={<icons.add aria-hidden />}
            over
          />
          <Way
            href={leave.href}
            label={tr('home.people-home.open_your_requests', 'Open your requests')}
          />
        </>
      }
    >
      {leave.balances.length === 0 ? null : (
        <div className="grid grid-cols-2 gap-3">
          {leave.balances.map((b) => (
            <Stat
              key={b.key}
              href={b.href}
              label={b.name}
              value={b.left}
              description={b.unit}
              inset
              {...opens(peek, {
                media: <Tile icon={<icons.vacation aria-hidden />} name={b.name} />,
                title: b.name,
                description: `${b.left} ${b.unit}`,
                href: b.href,
                go: tr('home.people-home.open_this_balance', 'Open this balance'),
                direct: true,
              })}
            />
          ))}
        </div>
      )}
      {leave.requests.length === 0 ? (
        <Done
          title={tr('home.people-home.nothing_booked', 'Nothing booked')}
          detail={tr(
            'home.people-home.time_off_you_ask_for_shows',
            'Time off you ask for shows up here, with where it stands.',
          )}
        />
      ) : (
        <List
          className="-mx-5 touch:-mx-4"
          aria-label={tr('home.people-home.your_time_off_coming_up', 'Your time off coming up')}
        >
          {leave.requests.map((r) => (
            <ListItem
              key={r.id}
              asChild
              chevron
              leading={<Tile icon={<icons.calendar aria-hidden />} name={r.title} />}
              description={r.when}
              supporting={r.detail}
              trailing={
                <Badge size="sm" tone={r.tone}>
                  {r.status}
                </Badge>
              }
            >
              <a
                href={r.href}
                {...opens(peek, {
                  media: <Tile icon={<icons.calendar aria-hidden />} name={r.title} />,
                  title: r.title,
                  description: r.when,
                  body: (
                    <>
                      <div>
                        <Badge size="sm" tone={r.tone}>
                          {r.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-fg">{r.detail}</p>
                    </>
                  ),
                  href: r.href,
                  go: tr('home.people-home.open_this_request', 'Open this request'),
                  direct: true,
                })}
              >
                {r.title}
              </a>
            </ListItem>
          ))}
        </List>
      )}
    </Section>
  );
}

/*
 * How Home comes in. Each widget arrives (Reach's `arrive`: a short rise out
 * of a soft blur), the wide column's a step ahead of the one beside it, down
 * the page, so the eye is led from To do across and down rather than handed
 * everything at once. A widget whose rows come later arrives again when they
 * do. A list's first rows follow their widget, a step apart. Nothing moves
 * for somebody who asked for less motion.
 */
const ARRIVE = 'motion-safe:*:animate-arrive';
const MAIN_AFTER =
  '*:nth-2:[animation-delay:90ms] *:nth-3:[animation-delay:180ms] *:nth-[n+4]:[animation-delay:270ms]';
const SIDE_AFTER =
  '*:nth-1:[animation-delay:45ms] *:nth-2:[animation-delay:135ms] *:nth-[n+3]:[animation-delay:225ms]';
const ROWS_IN =
  'motion-safe:*:animate-enter *:[animation-delay:180ms] *:nth-2:[animation-delay:210ms] *:nth-3:[animation-delay:240ms] *:nth-4:[animation-delay:270ms] *:nth-[n+5]:[animation-delay:300ms]';

/** A greeting's sign (the hand, a festival's) apart from its words, to wave once. */
function Greeting({ words }: { readonly words: string }): JSX.Element {
  const at = words.lastIndexOf(' ');
  const sign = words.slice(at + 1);
  if (at === -1 || !/\p{Extended_Pictographic}/u.test(sign)) return <>{words}</>;
  return (
    <>
      {words.slice(0, at)}{' '}
      <span className="inline-block origin-[70%_70%] motion-safe:animate-wave">{sign}</span>
    </>
  );
}

/**
 * Home's two columns, the width of the page: what to act on, wide, and who
 * and what is around it beside it. One column where the page is not wide
 * enough for both. Each column is a container, so a widget in it can say
 * more where it has the room.
 */
function Columns({
  main,
  side,
}: {
  readonly main: ReactNode;
  readonly side: ReactNode;
}): JSX.Element {
  return (
    <div className="grid items-start gap-4 touch:gap-3 @5xl/page:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div
        className={cn('@container/col flex min-w-0 flex-col gap-4 touch:gap-3', ARRIVE, MAIN_AFTER)}
      >
        {main}
      </div>
      <div
        className={cn('@container/col flex min-w-0 flex-col gap-4 touch:gap-3', ARRIVE, SIDE_AFTER)}
      >
        {side}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- HR -- */

/**
 * A figure that is also the way to where it is worked on. It opens a quick
 * look first: the number, what it says in sentences worked out from the same
 * figures, and a question for the host's assistant where it has one.
 */
function Figure({
  says,
  ask,
  go,
  more,
  href,
  label,
  value,
  unit,
  description,
  chart,
  icon,
  tone,
  className,
  children,
}: {
  readonly href: string;
  readonly label: string;
  readonly value: string | number;
  readonly unit?: string;
  readonly description: ReactNode;
  readonly chart?: ReactNode;
  readonly icon: ReactNode;
  readonly tone: 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4';
  readonly className?: string;
  /** A meter of what the number is out of, under it. */
  readonly children?: ReactNode;
  /** What the figure says, a sentence each: the quick look's summary. */
  readonly says: readonly string[];
  /** A question about it for the assistant. */
  readonly ask?: string;
  /** What the quick look's button says. */
  readonly go: string;
  /** Under the summary: a chart. */
  readonly more?: ReactNode;
}): JSX.Element {
  const peek = useContext(PeekContext);
  return (
    <Stat
      {...opens(peek, {
        media: <Avatar size="lg" shape="rounded" name={label} fallback={icon} />,
        title: label,
        description: `${String(value)}${unit ?? ''}`,
        body: (
          <>
            <ul
              className="flex list-disc flex-col gap-1.5 ps-5 text-sm text-fg"
              aria-label={tr('home.people-home.summary', 'Summary')}
            >
              {says.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {more}
          </>
        ),
        href,
        go,
        ...(ask === undefined ? {} : { ask }),
      })}
      href={href}
      label={label}
      value={value}
      {...(unit === undefined ? {} : { unit })}
      description={description}
      {...(chart === undefined ? {} : { chart })}
      icon={icon}
      iconPosition="start"
      tone={tone}
      inset
      className={className}
    >
      {children}
    </Stat>
  );
}

const inReviewWord = (): string => tr('home.people-home.open_in_review', 'Open in Review');

/** What headcount says, in sentences worked out from the figures on the page. */
export function headcountSays(headcount: {
  readonly value: number;
  readonly change: number | null;
  readonly trend: readonly ChartPoint[];
}): string[] {
  const moved = (n: number, over: string): string =>
    n === 0
      ? tr('home.people-home.says_same', 'The same as {{over}}.', { over })
      : n > 0
        ? tr('home.people-home.says_up', 'Up {{n}} on {{over}}.', { n: String(n), over })
        : tr('home.people-home.says_down', 'Down {{n}} on {{over}}.', { n: String(-n), over });
  const last = headcount.trend.at(-1);
  const before = headcount.trend.at(-2);
  return [
    tr(
      'home.people-home.says_headcount',
      {
        one: '{{count}} person is on the records today.',
        other: '{{count}} people are on the records today.',
      },
      { count: headcount.value },
    ),
    ...(headcount.change === null
      ? []
      : [moved(headcount.change, tr('home.people-home.a_year_ago', 'a year ago'))]),
    ...(last === undefined || before === undefined
      ? []
      : [
          moved(
            last.value - before.value,
            tr('home.people-home.the_month_before', 'the month before'),
          ),
        ]),
  ];
}

/** "1 looks unusual: a 38% raise", from what People's checks flag (B2); null for nothing flagged. */
export function unusual(approvals: PeopleHomeState['approvals']): string | null {
  const n = approvals?.flagged ?? 0;
  if (n === 0) return null;
  const reason = approvals?.flagReason ?? null;
  const what = tr(
    'home.people-home.unusual',
    { one: '{{count}} looks unusual', other: '{{count}} look unusual' },
    { count: n },
  );
  return reason === null || reason === ''
    ? what
    : tr('home.people-home.text_4', '{{what}}: {{charAt}}{{slice}}', {
        what,
        charAt: reason.charAt(0).toLowerCase(),
        slice: reason.slice(1),
      });
}

/**
 * Home for HR (B2, MA B2): the records' four figures, then "Needs HR", one
 * list across every queue, each row opening Review with its chip chosen;
 * beside it who is starting, who joined, and a line for their own record.
 */
function HrHome({
  hr,
  state,
  toDo,
  out,
  around,
}: {
  readonly hr: NonNullable<PeopleHomeState['hr']>;
  readonly state: PeopleHomeState;
  /** The host's To do, first in the grid beside what needs HR. */
  readonly toDo?: ReactNode;
  /** Who is away: a list, so under To do where it has the width. */
  readonly out?: ReactNode;
  /** Who they are and their own time off: first beside the lists. */
  readonly around?: ReactNode;
}): JSX.Element {
  const peek = useContext(PeekContext);
  const approvals = state.approvals;
  const team = state.team;
  const headcount = hr.headcount;
  const oldest = approvals?.items.at(-1);
  const insights = tr('home.people-home.open_workforce_insights', 'Open workforce insights');
  return (
    <Columns
      main={
        <>
          {toDo}
          {out}
          {/* The records' figures in one card, over how headcount has moved. */}
          <Section
            title={tr('home.people-home.workforce', 'Workforce')}
            icon={<icons.team aria-hidden />}
            tone="chart-1"
            action={
              <Way
                href="/people/insights/workforce"
                label={tr('home.people-home.open_workforce_insights', 'Open workforce insights')}
              />
            }
          >
            {/* Where the card is wide, the figures beside how headcount moved. */}
            <div className="grid gap-4 @4xl/col:grid-cols-2 @4xl/col:items-center">
              <div className="grid grid-cols-2 gap-3">
                {headcount === null ? null : (
                  <Figure
                    href="/people/insights/workforce"
                    label={tr('home.people-home.headcount', 'Headcount')}
                    icon={<icons.team aria-hidden />}
                    tone="chart-1"
                    value={headcount.value.toLocaleString(locale())}
                    go={insights}
                    ask={tr(
                      'home.people-home.ask_headcount',
                      'How has headcount changed over the last 12 months, and in which teams?',
                    )}
                    says={headcountSays(headcount)}
                    {...(headcount.trend.length < 2
                      ? {}
                      : {
                          more: (
                            <TrendChart
                              series={[
                                {
                                  label: tr('home.people-home.people', 'People'),
                                  tone: 'chart-1',
                                  data: headcount.trend,
                                },
                              ]}
                              label={tr(
                                'home.people-home.headcount_by_month',
                                'Headcount by month',
                              )}
                              height={140}
                              area
                              showLastPoint
                            />
                          ),
                        })}
                    description={
                      headcount.change === null
                        ? tr('home.people-home.today', 'today')
                        : tr('home.people-home.in_12_months', '{{value}}{{change}} in 12 months', {
                            value: headcount.change >= 0 ? '+' : '',
                            change: String(headcount.change),
                          })
                    }
                  />
                )}
                {hr.complete === null ? null : (
                  <Figure
                    go={inReviewWord()}
                    href={review('missing')}
                    label={tr('home.people-home.complete_records', 'Complete records')}
                    icon={<icons.success aria-hidden />}
                    tone="chart-2"
                    value={hr.complete.percent}
                    ask={tr(
                      'home.people-home.ask_complete',
                      'Which records are incomplete, and what is missing from them?',
                    )}
                    says={[
                      tr(
                        'home.people-home.says_complete',
                        '{{percent}}% of records have every required detail.',
                        { percent: String(hr.complete.percent) },
                      ),
                      tr(
                        'home.people-home.says_incomplete',
                        {
                          one: '{{count}} record still has a gap.',
                          other: '{{count}} records still have gaps.',
                        },
                        { count: hr.complete.incomplete },
                      ),
                      ...(team === null || team.toFill === 0
                        ? []
                        : [
                            tr(
                              'home.people-home.says_to_fill',
                              {
                                one: '{{count}} missing detail is HR’s to fill in.',
                                other: '{{count}} missing details are HR’s to fill in.',
                              },
                              { count: team.toFill },
                            ),
                          ]),
                      ...(team === null || team.waiting === 0
                        ? []
                        : [
                            tr(
                              'home.people-home.says_waiting',
                              {
                                one: '{{count}} person has details of their own to add, and is reminded weekly.',
                                other:
                                  '{{count}} people have details of their own to add, and are reminded weekly.',
                              },
                              { count: team.waiting },
                            ),
                          ]),
                    ]}
                    unit="%"
                    description={tr(
                      'home.people-home.incomplete',
                      '{{toLocaleString}} incomplete',
                      {
                        toLocaleString: hr.complete.incomplete.toLocaleString(locale()),
                      },
                    )}
                  >
                    <Progress
                      size="sm"
                      value={hr.complete.percent}
                      label={tr('home.people-home.complete_records', 'Complete records')}
                      tone={hr.complete.percent >= 100 ? 'success' : 'accent'}
                    />
                  </Figure>
                )}
                {approvals === null ? null : (
                  <Figure
                    go={inReviewWord()}
                    href={review('changes')}
                    label={tr('home.people-home.waiting_for_a_decision', 'Waiting for a decision')}
                    icon={<icons.pending aria-hidden />}
                    tone="chart-3"
                    value={approvals.total}
                    says={[
                      tr(
                        'home.people-home.says_changes',
                        {
                          one: '{{count}} change to a record waits for HR to approve or decline.',
                          other: '{{count}} changes to records wait for HR to approve or decline.',
                        },
                        { count: approvals.total },
                      ),
                      ...(oldest === undefined
                        ? []
                        : [
                            tr('home.people-home.says_oldest', 'The oldest was asked {{waited}}.', {
                              waited: waited(oldest.requestedAt, state.now),
                            }),
                          ]),
                      ...((flag) => (flag === null ? [] : [`${flag}.`]))(unusual(approvals)),
                      tr(
                        'home.people-home.says_nothing_changes',
                        'Nothing changes on a record until HR decides.',
                      ),
                    ]}
                    description={
                      oldest === undefined
                        ? tr('home.people-home.nothing_waiting', 'nothing waiting')
                        : tr('home.people-home.oldest_asked', 'Oldest asked {{waited}}', {
                            waited: waited(oldest.requestedAt, state.now),
                          })
                    }
                    className="touch:hidden"
                  />
                )}
                {hr.expiring === null ? null : (
                  <Figure
                    href="/people/insights/workforce"
                    label={tr('home.people-home.expiring_in_90_days', 'Expiring in 90 days')}
                    icon={<icons.scheduled aria-hidden />}
                    tone="chart-4"
                    value={hr.expiring}
                    go={insights}
                    ask={tr(
                      'home.people-home.ask_expiring',
                      'Whose permit, contract or probation ends in the next 90 days?',
                    )}
                    says={[
                      tr(
                        'home.people-home.says_expiring',
                        {
                          one: '{{count}} permit, contract or probation ends in the next 90 days.',
                          other:
                            '{{count}} permits, contracts or probations end in the next 90 days.',
                        },
                        { count: hr.expiring },
                      ),
                      tr(
                        'home.people-home.says_expiring_where',
                        'Workforce insights lists each one with its end date.',
                      ),
                    ]}
                    description={tr(
                      'home.people-home.permits_contracts_probations',
                      'Permits, contracts, probations',
                    )}
                    className="touch:hidden"
                  />
                )}
              </div>
              {headcount === null || headcount.trend.length < 2 ? null : (
                <TrendChart
                  series={[
                    {
                      label: tr('home.people-home.people', 'People'),
                      tone: 'chart-1',
                      data: headcount.trend,
                    },
                  ]}
                  label={tr('home.people-home.headcount_by_month', 'Headcount by month')}
                  height={176}
                  area
                  showLastPoint
                />
              )}
            </div>
          </Section>
          {hr.joiners.length === 0 ? null : (
            <Section
              title={tr('home.people-home.joiners_by_month', 'Joiners by month')}
              icon={<icons.analytics aria-hidden />}
              tone="chart-1"
              action={
                <Way
                  href="/people/insights/workforce"
                  label={tr('home.people-home.open_workforce_insights', 'Open workforce insights')}
                />
              }
            >
              <BarChart
                data={hr.joiners}
                label={tr(
                  'home.people-home.people_who_joined_by_month',
                  'People who joined, by month',
                )}
                height={120}
                showValues
              />
            </Section>
          )}
        </>
      }
      side={
        <>
          {around}
          {hr.starting.length === 0 ? null : (
            <Section
              title={tr('home.people-home.starting_soon', 'Starting soon')}
              icon={<icons.hire aria-hidden />}
              tone="success"
              meta={hr.starting.length}
              flush
              action={
                <Way
                  href="/people/directory/list"
                  label={tr('home.people-home.open_the_directory', 'Open the directory')}
                />
              }
            >
              <List
                aria-label={tr('home.people-home.starting_soon', 'Starting soon')}
                className={ROWS_IN}
              >
                {hr.starting.map((p) => (
                  <ListItem
                    key={p.id}
                    asChild
                    leading={<Avatar size="lg" name={p.name} src={p.avatarUrl ?? undefined} />}
                    description={p.detail}
                    trailing={
                      p.missing === null || p.missing === 0 ? (
                        <Badge size="sm" tone="success">
                          {tr('home.people-home.ready', 'Ready')}
                        </Badge>
                      ) : (
                        <MissingMark count={p.missing} />
                      )
                    }
                  >
                    <a
                      href={`/people/${p.id}`}
                      {...opens(
                        peek,
                        personPeek(p, tr('home.people-home.starting_soon', 'Starting soon'), [
                          { label: tr('home.people-home.starts', 'Starts'), value: p.detail },
                          {
                            label: tr('home.people-home.record', 'Record'),
                            value:
                              p.missing === null || p.missing === 0 ? (
                                tr('home.people-home.ready', 'Ready')
                              ) : (
                                <MissingMark count={p.missing} />
                              ),
                          },
                        ]),
                      )}
                    >
                      {p.name}
                    </a>
                  </ListItem>
                ))}
              </List>
            </Section>
          )}
        </>
      }
    />
  );
}

/* --------------------------------------------------------------- page -- */

/**
 * What signing up still asks of them, first on the first screen they land on
 * (the sign-up page itself is identity's, and never holds a file): their
 * photo when the company asks for one, and any image or document the company
 * collects at sign-up. Each is kept as soon as it is chosen. What is optional
 * can wait; the card goes once nothing is left.
 */
function Setup({
  setup,
  name,
  onPhoto,
  onSetupFile,
}: {
  readonly setup: NonNullable<PeopleHomeState['setup']>;
  readonly name: string;
  readonly onPhoto: PeopleHomeProps['onPhoto'];
  readonly onSetupFile: PeopleHomeProps['onSetupFile'];
}): JSX.Element | null {
  const [later, setLater] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<readonly UploadedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const required =
    setup.photo === 'required' || setup.fields.some((f) => f.required && !done.has(f.key));
  if (later && !required) return null;
  const byKey = new Map(setup.fields.map((f) => [f.key, f]));

  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>
          {tr('home.people-home.finish_setting_up_your_account', 'Finish setting up your account')}
        </CardTitle>
        {required ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLater(true);
            }}
          >
            {tr('home.people-home.later', 'Later')}
          </Button>
        )}
        <CardDescription>
          {required
            ? tr(
                'home.people-home.your_company_asks_for_these_before',
                'Your company asks for these before anything else. Each is saved as soon as you choose it.',
              )
            : tr(
                'home.people-home.your_company_would_like_these_each',
                'Your company would like these. Each is saved as soon as you choose it.',
              )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap={5}>
          {setup.photo === null || onPhoto === undefined ? null : (
            <AvatarUploader
              label={
                setup.photo === 'required'
                  ? tr('home.people-home.your_photo_required', 'Your photo (required)')
                  : tr('home.people-home.your_photo', 'Your photo')
              }
              hint={
                busy
                  ? tr('home.people-home.uploading', 'Uploading…')
                  : (photoProblem ??
                    tr(
                      'home.people-home.a_clear_photo_of_your_face',
                      'A clear photo of your face, so colleagues know who you are.',
                    ))
              }
              value={picked}
              src={photo}
              fallback={<Avatar size="xl" name={name} className="ring-0" />}
              accept={['image/png', 'image/jpeg', 'image/webp']}
              maxSize={20 * 1024 * 1024}
              disabled={busy}
              invalid={photoProblem !== null}
              onReject={(rejections) => {
                setPhotoProblem(
                  rejections[0]?.message ??
                    tr(
                      'home.people-home.that_image_was_not_accepted',
                      'That image was not accepted.',
                    ),
                );
              }}
              onChange={(next) => {
                const file = next[0]?.file;
                setPicked(next);
                setPhotoProblem(null);
                if (file === undefined) return;
                setBusy(true);
                void onPhoto(file).then((outcome) => {
                  setBusy(false);
                  if (outcome.ok) setPhoto(outcome.avatarUrl);
                  else {
                    setPhotoProblem(outcome.message);
                    setPicked([]);
                  }
                });
              }}
            />
          )}
          {setup.fields.length === 0 || onSetupFile === undefined ? null : (
            <FieldFiles.Provider
              value={{
                known: new Map(),
                upload: (key, file) => {
                  const field = byKey.get(key);
                  if (field === undefined) {
                    return Promise.resolve({
                      ok: false,
                      message: tr('home.people-home.no_such_field', 'No such field'),
                    });
                  }
                  return onSetupFile(field, file).then((outcome) => {
                    if (outcome.ok) setDone((d) => new Set([...d, key]));
                    return outcome;
                  });
                },
              }}
            >
              {setup.fields.map((f) => (
                <FileInput
                  key={f.key}
                  field={{
                    key: f.key,
                    label: f.label,
                    description: f.description,
                    dataType: f.dataType as 'image' | 'document_ref',
                    options: [],
                    required: f.required,
                    readOnly: false,
                  }}
                  value={null}
                  invalid={false}
                  description={f.description ?? ''}
                  onChange={() => undefined}
                />
              ))}
            </FieldFiles.Provider>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * The time now, for what Home says about the clock: null until the browser
 * has it (the server's page says when it was drawn, which a kept page shows
 * long after), then again as each minute turns. A timer set for the turn of
 * the minute, not a sweep: nothing runs between.
 */
function useMinute(): string | null {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      setNow(new Date().toISOString());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    timer = setTimeout(tick, 0);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return now;
}

/**
 * Home: today where they work over a greeting by the hour, in the middle of
 * a wash of colour; then the page for who they are: HR's (B2) or anybody's
 * (B1). Nothing here leads anywhere the sidebar does not: no shortcuts and no
 * page action. Signing up's last asks come first.
 */
export function PeopleHome({
  load,
  onPhoto,
  onSetupFile,
  toDo,
  greeting,
  away,
  leave,
  onAsk,
  onOpen,
  onAway,
  pending,
}: PeopleHomeProps): JSX.Element {
  // The quick look: what was last pressed stays while it closes.
  const [peeked, setPeeked] = useState<Peeked | null>(null);
  const [peeking, setPeeking] = useState(false);
  const looks: Looks = {
    peek: (next) => {
      setPeeked(next);
      setPeeking(true);
    },
    // A page over Home takes the quick look's place.
    open:
      onOpen === undefined
        ? null
        : (href, label) => {
            setPeeking(false);
            onOpen(href, label);
          },
  };
  const minute = useMinute();
  return (
    <PeekContext.Provider value={looks}>
      <Peek
        peeked={peeked}
        open={peeking}
        onClose={() => {
          setPeeking(false);
        }}
        onAsk={onAsk}
        onOpen={looks.open}
      />
      <Loaded load={load} what={tr('home.people-home.your_home', 'your home')}>
        {(state) => {
          const { me, reportingLine, hr } = state;
          const hrFigures = state.roles.hr ? (hr ?? null) : null;
          // The clock's words follow the minute; what was counted when People answered does not.
          const clock = minute ?? state.now;
          const today = me === null ? '' : weekday(clock, me.timeZone);
          const time = me === null ? '' : localTime(clock, me.timeZone);
          const where = me?.location ?? null;
          const when = [
            today,
            [time, where === null ? null : tr('home.people-home.in', 'in {{where}}', { where })]
              .filter((x) => x !== null && x !== '')
              .join(' '),
          ]
            .filter((x) => x !== '')
            .join(' · ');
          // The host's To do, still being read: its widget, loading, where it will be.
          const waitingToDo =
            pending?.toDo === true ? (
              <Waiting
                title={tr('home.people-home.to_do', 'To do')}
                icon={<icons.inbox aria-hidden />}
                tone="accent"
                span={2}
              />
            ) : undefined;
          // Who is away, under To do: the profile beside them is the tallest
          // card on the page, so the lists share the wide column and the two
          // columns end near each other.
          const out =
            me === null ? null : away !== undefined ? (
              <Away away={away} onAway={onAway} />
            ) : pending?.time === true ? (
              <Waiting
                title={tr('home.people-home.whos_out', 'Who’s out')}
                icon={<icons.calendar aria-hidden />}
                tone="chart-4"
              />
            ) : null;
          // Who they are and their own time off, beside the lists.
          const around =
            me === null ? null : (
              <>
                <Profile me={me} now={clock} line={reportingLine} missing={state.missing} />
                {leave !== undefined ? (
                  <Leave leave={leave} />
                ) : pending?.time === true ? (
                  <Waiting
                    title={tr('home.people-home.your_time_off', 'Your time off')}
                    icon={<icons.vacation aria-hidden />}
                    tone="chart-3"
                  />
                ) : null}
              </>
            );
          return (
            // The wash is behind the header and the first rows under it.
            <div className="page-backdrop flex flex-col gap-6">
              <PageHeader
                align="center"
                // A greeting, not a title to keep in view: it goes with the page.
                sticky={false}
                {...(when === ''
                  ? {}
                  : {
                      breadcrumb: (
                        <p className="text-center text-sm font-medium text-fg-muted">{when}</p>
                      ),
                    })}
                className="motion-safe:animate-arrive"
                title={
                  me === null ? (
                    tr('home.people-home.home', 'Home')
                  ) : (
                    <Greeting words={greetingOf(clock, me.timeZone, greeting ?? first(me.name))} />
                  )
                }
                description={
                  me === null
                    ? tr(
                        'home.people-home.your_account_is_not_linked_to',
                        'Your account is not linked to anybody’s record, so there is no profile to show.',
                      )
                    : hrFigures !== null
                      ? tr('home.people-home.what_needs_hr_today', 'Here’s what needs HR today.')
                      : tr('home.people-home.what_needs_you_today', 'Here’s what needs you today.')
                }
              />
              {me === null || state.setup == null ? null : (
                <Setup
                  setup={state.setup}
                  name={me.name}
                  onPhoto={onPhoto}
                  onSetupFile={onSetupFile}
                />
              )}
              {hrFigures !== null ? (
                <>
                  <HrHome
                    hr={hrFigures}
                    state={state}
                    out={out}
                    around={around}
                    toDo={
                      toDo === undefined ? (
                        waitingToDo
                      ) : toDo.tasks.length === 0 ? undefined : (
                        <HostList toDo={{ ...toDo, waiting: [] }} today={me?.today ?? ''} />
                      )
                    }
                  />
                </>
              ) : me === null ? null : (
                <Columns
                  main={
                    <>
                      {toDo === undefined ? (
                        (waitingToDo ?? <ToDo state={state} me={me} />)
                      ) : (
                        <HostList toDo={toDo} today={me.today} />
                      )}
                      {out}
                    </>
                  }
                  side={around}
                />
              )}
            </div>
          );
        }}
      </Loaded>
    </PeekContext.Provider>
  );
}
