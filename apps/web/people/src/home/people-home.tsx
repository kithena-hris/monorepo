import {
  Avatar,
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
  dateFormat,
  formatList,
  type IconName,
  icons,
  KeyValues,
  List,
  ListItem,
  locale,
  PageHeader,
  Sparkline,
  Stack,
  Stat,
  type UploadedImage,
  Widget,
  WidgetGrid,
} from '@reach/ui';
import { useState, type ComponentType, type JSX, type ReactNode } from 'react';

import { whoOf } from '../export/words';
import { Loaded, type Loadable } from '../load';
import { FieldFiles, FileInput, type UploadOutcome } from '../record/files';
import { localTime } from '../record/display';
import { MissingMark } from '../record/missing';
import { t as tr } from '../i18n';

/**
 * Home (design B1, B2; MA B1, B2): People's overview, folded into the app's
 * front page, because Home and People › Overview were two pages answering
 * the same question.
 *
 * Everybody opens on "Hi" and what needs them. An employee's Home is one To
 * do list — what of theirs is missing and what of theirs waits on HR, one
 * button each, how complete their record is beside its title — with who they
 * are and their reporting line beside it. HR's is the records' figures and
 * "Needs HR", one list across every queue, each row opening Review with that
 * chip chosen; beside it who is starting, who joined and their own record.
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
}

/** One row of the host's To do, already worded by the host. */
export interface HostTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  /** A Reach icon name; an unknown one draws as the Inbox's. */
  readonly icon: string;
  readonly tone?: 'warning' | 'danger' | 'info' | 'accent';
}

export interface HostToDo {
  /** Where the whole list lives: "Open Inbox". */
  readonly href: string;
  readonly tasks: readonly HostTask[];
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

/** "2 years, 3 months": whole months from a start date to today, both calendar dates. */
export function tenure(startedOn: string, today: string): string | null {
  const [y1, m1, d1] = startedOn.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  if ([y1, m1, d1, y2, m2, d2].some((n) => n === undefined || Number.isNaN(n))) return null;
  const months =
    ((y2 ?? 0) - (y1 ?? 0)) * 12 + ((m2 ?? 0) - (m1 ?? 0)) - ((d2 ?? 0) < (d1 ?? 0) ? 1 : 0);
  if (months < 0) return null;
  if (months === 0) return tr('home.people-home.less_than_a_month', 'less than a month');
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
  ]
    .filter((x) => x !== null)
    .join(', ');
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

/** A link beside a section's title, because it goes somewhere. */
function SeeAll({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Button asChild size="sm" variant="link">
      <a href={href}>{children}</a>
    </Button>
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
 * A row's way onward (B1, B2): a button with its word at a desk, a chevron
 * under a finger, where the whole list is a list of places (MA B1, B2).
 */
function Onward({
  href,
  label,
  word,
  primary = false,
}: {
  readonly href: string;
  /** What it does, for a screen reader: "Review 4 changes to approve". */
  readonly label: string;
  readonly word: string | null;
  readonly primary?: boolean;
}): JSX.Element {
  return (
    <>
      {word === null ? null : (
        <Button
          asChild
          size="sm"
          variant={primary ? 'primary' : 'secondary'}
          className="touch:hidden"
        >
          <a href={href} aria-label={label}>
            {word}
          </a>
        </Button>
      )}
      <Button
        asChild
        size="sm"
        variant="ghost"
        startIcon={<icons.forward aria-hidden />}
        className={word === null ? undefined : 'hidden touch:inline-flex'}
      >
        <a href={href} aria-label={label} />
      </Button>
    </>
  );
}

/** One thing to do (B1): its tile, what it is, why, and the one way to do it. */
function Todo({
  icon,
  tone,
  title,
  description,
  href,
  word,
  primary,
}: {
  readonly icon: ReactNode;
  readonly tone?: 'warning' | 'danger' | 'info' | 'accent';
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly word: string | null;
  readonly primary?: boolean;
}): JSX.Element {
  return (
    <ListItem
      leading={<Tile icon={icon} name={title} {...(tone === undefined ? {} : { tone })} />}
      description={description}
      trailing={
        <Onward
          href={href}
          label={
            word === null
              ? tr('home.people-home.open_title', 'Open: {{title}}', { title })
              : tr('home.people-home.text_3', '{{value}}: {{title}}', { value: word, title })
          }
          word={word}
          {...(primary === undefined ? {} : { primary })}
        />
      }
    >
      {title}
    </ListItem>
  );
}

const iconOf = (name: string): ComponentType<{ 'aria-hidden'?: boolean }> =>
  Object.hasOwn(icons, name) ? icons[name as IconName] : icons.inbox;

/** The host's To do and what waits on others, in People's own rows. */
function HostList({ toDo }: { readonly toDo: HostToDo }): JSX.Element {
  const rows = (tasks: readonly HostTask[], label: string) => (
    <List aria-label={label}>
      {tasks.map((t) => {
        const Icon = iconOf(t.icon);
        return (
          <Todo
            key={t.id}
            icon={<Icon aria-hidden />}
            {...(t.tone === undefined ? {} : { tone: t.tone })}
            title={t.title}
            description={t.description}
            href={t.href}
            word={null}
          />
        );
      })}
    </List>
  );
  return (
    <>
      <Section
        title={tr('home.people-home.to_do', 'To do')}
        icon={<icons.inbox aria-hidden />}
        tone="accent"
        {...(toDo.tasks.length === 0 ? {} : { meta: toDo.tasks.length })}
        span={2}
        flush={toDo.tasks.length > 0}
        action={<SeeAll href={toDo.href}>{tr('home.people-home.open_inbox', 'Open Inbox')}</SeeAll>}
      >
        {toDo.tasks.length === 0 ? (
          <Done
            title={tr('home.people-home.nothing_needs_you', 'Nothing needs you')}
            detail={tr(
              'home.people-home.new_tasks_from_every_part_of',
              'New tasks from every part of the app show up here.',
            )}
          />
        ) : (
          rows(toDo.tasks, tr('home.people-home.to_do', 'To do'))
        )}
      </Section>
      {toDo.waiting.length === 0 ? null : (
        <Section
          title={tr('home.people-home.waiting_on_others', 'Waiting on others')}
          icon={<icons.pending aria-hidden />}
          meta={toDo.waiting.length}
          span={2}
          flush
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
        <List aria-label={tr('home.people-home.to_do', 'To do')} className="-mx-5 touch:-mx-4">
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
              word={tr('home.people-home.correct_it', 'Correct it')}
              primary
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
              word={tr('home.people-home.add', 'Add')}
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
              href={review('changes', `change-${c.id}`)}
              word={null}
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

/** Who they are (B1): photo, name, what they do, their badges, three facts and their profile. */
function Identity({
  me,
  now,
}: {
  readonly me: NonNullable<PeopleHomeState['me']>;
  readonly now: string;
}): JSX.Element {
  const role = [me.title, me.department, me.location].filter((x) => x !== null).join(' · ');
  const status = me.status === null ? undefined : STATUS[me.status];
  const time = localTime(now, me.timeZone);
  const since = me.startedOn === null ? null : tenure(me.startedOn, me.today);
  return (
    <Widget
      title={tr('home.people-home.your_profile', 'Your profile')}
      icon={<icons.person aria-hidden />}
      tone="chart-2"
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
        {me.missing === null || me.missing === 0 ? null : <MissingMark count={me.missing} />}
      </div>
      <KeyValues
        layout="stacked"
        aria-label={tr('home.people-home.your_details', 'Your details')}
        items={[
          ...(time === ''
            ? []
            : [{ label: tr('home.people-home.local_time', 'Local time'), value: time }]),
          ...(me.startedOn === null
            ? []
            : [
                {
                  label: tr('home.people-home.joined', 'Joined'),
                  value: `${longDate(me.startedOn)}${since === null ? '' : ` · ${since}`}`,
                },
              ]),
          ...(me.email === null
            ? []
            : [
                {
                  label: tr('home.people-home.email', 'Email'),
                  value: (
                    <a
                      className="relative tap-target text-accent-fg underline-offset-4 hover:underline"
                      href={`mailto:${me.email}`}
                    >
                      {me.email}
                    </a>
                  ),
                },
              ]),
        ]}
      />
      <Button asChild fullWidth size="sm">
        <a href="/people/me">{tr('home.people-home.view_your_profile', 'View your profile')}</a>
      </Button>
    </Widget>
  );
}

/**
 * The reporting line (B1): the managers from the top, then them, as the org
 * chart draws it, and who else reports to their manager. Under a finger, the
 * manager alone, a row to their profile (MA B1).
 */
function ReportingLine({
  line,
  me,
}: {
  readonly line: NonNullable<PeopleHomeState['reportingLine']>;
  readonly me: NonNullable<PeopleHomeState['me']>;
}): JSX.Element {
  // Top of the chart first, as an org chart reads.
  const above = line.managers.toReversed();
  const manager = line.managers[0];
  return (
    <Section
      title={tr('home.people-home.your_reporting_line', 'Your reporting line')}
      icon={<icons.hierarchy aria-hidden />}
      tone="chart-3"
      flush
      action={
        <SeeAll href="/people/directory/org-chart">
          {tr('home.people-home.org_chart', 'Org chart')}
        </SeeAll>
      }
    >
      <List
        aria-label={tr(
          'home.people-home.your_managers_from_the_top',
          'Your managers, from the top',
        )}
      >
        {above.map((m, i) => (
          <ListItem
            key={m.id}
            asChild
            // Under a finger, only the manager: the one row a phone keeps.
            className={i === above.length - 1 ? undefined : 'touch:hidden'}
            leading={<Avatar size="md" name={m.name} src={m.avatarUrl ?? undefined} />}
            description={
              m.id === manager?.id
                ? m.title == null || m.title === ''
                  ? tr('home.people-home.your_manager', 'Your manager')
                  : tr('home.people-home.your_manager_title', 'Your manager · {{title}}', {
                      title: m.title,
                    })
                : (m.title ?? undefined)
            }
            chevron
          >
            <a href={`/people/${m.id}`}>{m.name}</a>
          </ListItem>
        ))}
        <ListItem
          selected
          className="touch:hidden"
          leading={<Avatar size="md" name={me.name} src={me.avatarUrl ?? undefined} />}
          description={
            line.peers === null || manager === undefined || line.peers === 0
              ? (me.title ?? undefined)
              : tr(
                  'home.people-home.to',
                  {
                    one: '{{count}} other reports to {{first}}.',
                    other: '{{count}} others report to {{first}}.',
                  },
                  { count: line.peers, first: first(manager.name) },
                )
          }
        >
          {tr('home.people-home.you', 'You')}
        </ListItem>
      </List>
    </Section>
  );
}

/** Who reports to them, for a manager: a row of faces and the way to all of them. */
function Team({
  line,
}: {
  readonly line: NonNullable<PeopleHomeState['reportingLine']>;
}): JSX.Element {
  return (
    <Section
      title={tr('home.people-home.direct_reports', 'Direct reports')}
      icon={<icons.team aria-hidden />}
      tone="chart-4"
      meta={line.reportsTotal}
      flush
      action={
        line.reportsFilter === null ? undefined : (
          <SeeAll href={`/people/directory/list?filter=${encodeURIComponent(line.reportsFilter)}`}>
            {line.reportsTotal > line.reports.length
              ? tr('home.people-home.show_all', 'Show all {{reportsTotal}}', {
                  reportsTotal: String(line.reportsTotal),
                })
              : tr('home.people-home.in_the_directory', 'In the directory')}
          </SeeAll>
        )
      }
    >
      <List aria-label={tr('home.people-home.your_direct_reports', 'Your direct reports')}>
        {line.reports.map((r) => (
          <ListItem
            key={r.id}
            asChild
            leading={<Avatar size="md" name={r.name} src={r.avatarUrl ?? undefined} />}
            {...(r.title === null ? {} : { description: r.title })}
          >
            <a href={`/people/${r.id}`}>{r.name}</a>
          </ListItem>
        ))}
      </List>
    </Section>
  );
}

/* ---------------------------------------------------------------- HR -- */

/** A figure that is also the way to where it is worked on. */
function Figure({
  href,
  label,
  value,
  unit,
  description,
  chart,
  className,
}: {
  readonly href: string;
  readonly label: string;
  readonly value: ReactNode;
  readonly unit?: string;
  readonly description: ReactNode;
  readonly chart?: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return (
    <a
      href={href}
      className={`rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus ${className ?? ''}`}
    >
      <Stat
        label={label}
        value={value}
        {...(unit === undefined ? {} : { unit })}
        description={description}
        {...(chart === undefined ? {} : { chart })}
        className="h-full transition-shadow hover:shadow-md"
      />
    </a>
  );
}

/** A name after "by": "you" rather than "You". */
const byWhom = (who: string): string => who.replace(/^You\b/u, 'you');

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
}: {
  readonly hr: NonNullable<PeopleHomeState['hr']>;
  readonly state: PeopleHomeState;
  /** The host's To do, first in the grid beside what needs HR. */
  readonly toDo?: ReactNode;
}): JSX.Element {
  const approvals = state.approvals;
  const team = state.team;
  const changes = approvals?.total ?? 0;
  const needs: JSX.Element[] = [];
  if (changes > 0) {
    const oldest = approvals?.items.at(-1);
    const askers = whoOf(
      [...new Set(approvals?.items.map((i) => i.requestedBy))],
      (approvals?.items.length ?? 0) < changes,
    );
    needs.push(
      <Todo
        key="changes"
        icon={<icons.edit aria-hidden />}
        title={tr(
          'home.people-home.count_changes_to_approve',
          { one: '{{count}} change to approve', other: '{{count}} changes to approve' },
          { count: changes },
        )}
        description={[
          unusual(approvals) ??
            (oldest === undefined
              ? tr('home.people-home.waiting_for_your_decision', 'Waiting for your decision')
              : tr('home.people-home.oldest_asked_when', 'Oldest asked {{when}}', {
                  when: waited(oldest.requestedAt, state.now),
                })),
          askers === null
            ? null
            : tr('home.people-home.asked_by', 'asked by {{who}}', { who: byWhom(askers) }),
        ]
          .filter((x) => x !== null)
          .join(' · ')}
        href={review('changes')}
        word={tr('home.people-home.word_review', 'Review')}
        primary
      />,
    );
  }
  if ((hr.identifiers ?? 0) > 0) {
    needs.push(
      <Todo
        key="ids"
        icon={<icons.identifier aria-hidden />}
        title={tr(
          'home.people-home.count_identifiers_to_check',
          { one: '{{count}} identifier to check', other: '{{count}} identifiers to check' },
          { count: hr.identifiers ?? 0 },
        )}
        description={[
          tr(
            'home.people-home.failed_a_check_or_couldnt_be',
            'Failed a check, or couldn’t be verified',
          ),
          ((by) =>
            by === null
              ? null
              : tr('home.people-home.entered_by', 'entered by {{who}}', { who: byWhom(by) }))(
            whoOf(hr.identifiersBy ?? []),
          ),
        ]
          .filter((x) => x !== null)
          .join(' · ')}
        href={review('ids')}
        word={tr('home.people-home.word_review', 'Review')}
      />,
    );
  }
  if ((hr.duplicates ?? 0) > 0) {
    needs.push(
      <Todo
        key="duplicates"
        icon={<icons.merge aria-hidden />}
        title={tr(
          'home.people-home.count_possible_duplicates',
          { one: '{{count}} possible duplicate', other: '{{count}} possible duplicates' },
          { count: hr.duplicates ?? 0 },
        )}
        description={[
          tr(
            'home.people-home.same_work_email_or_name_and',
            'Same work email, or name and birth date',
          ),
          (hr.duplicatesBy ?? []).length === 0
            ? null
            : tr('home.people-home.flagged_by', 'flagged by {{who}}', {
                who: formatList(hr.duplicatesBy ?? []),
              }),
        ]
          .filter((x) => x !== null)
          .join(' · ')}
        href={review('duplicates')}
        word={tr('home.people-home.word_compare', 'Compare')}
      />,
    );
  }
  if ((hr.accessRequests ?? 0) > 0) {
    needs.push(
      <Todo
        key="access"
        icon={<icons.sensitive aria-hidden />}
        title={tr(
          'home.people-home.count_requests_for_full_values',
          { one: '{{count}} request for full values', other: '{{count}} requests for full values' },
          { count: hr.accessRequests ?? 0 },
        )}
        description={
          whoOf(hr.accessRequestsBy ?? []) === null
            ? tr(
                'home.people-home.somebody_asked_to_see_unmasked',
                'Somebody asked to see unmasked values',
              )
            : tr(
                'home.people-home.asked_to_see_unmasked_values',
                '{{value}} asked to see unmasked values',
                {
                  value: whoOf(hr.accessRequestsBy ?? []) ?? '',
                },
              )
        }
        href={review('access')}
        word={tr('home.people-home.word_decide', 'Decide')}
      />,
    );
  }
  if (team !== null && team.toFill > 0) {
    needs.push(
      <Todo
        key="fill"
        icon={<icons.missing aria-hidden />}
        title={tr(
          'home.people-home.count_details_for_hr_to_fill_in',
          {
            one: '{{count}} detail for HR to fill in',
            other: '{{count}} details for HR to fill in',
          },
          { count: team.toFill },
        )}
        description={tr(
          'home.people-home.missing_details_only_hr_keeps',
          'Missing details only HR keeps',
        )}
        href={review('missing')}
        word={tr('home.people-home.fill_in', 'Fill in')}
      />,
    );
  }
  if (team !== null && team.waiting > 0) {
    needs.push(
      <Todo
        key="remind"
        icon={<icons.notifications aria-hidden />}
        title={tr(
          'home.people-home.details_of_their_own_to_add',
          '{{counted}} details of their own to add',
          {
            counted: tr(
              'home.people-home.count_people_have',
              { one: '{{count}} person has', other: '{{count}} people have' },
              { count: team.waiting },
            ),
          },
        )}
        description={tr(
          'home.people-home.reminded_by_email_once_a_week',
          'Reminded by email once a week',
        )}
        href={review('missing')}
        word={tr('home.people-home.word_remind', 'Remind')}
      />,
    );
  }
  const headcount = hr.headcount;
  const oldest = approvals?.items.at(-1);
  const me = state.me;
  return (
    <Stack gap={4}>
      {/* The records' figures: tiles of one size, never stretched to the row. */}
      <WidgetGrid size="sm">
        {headcount === null ? null : (
          <Figure
            href="/people/insights/workforce"
            label={tr('home.people-home.headcount', 'Headcount')}
            value={headcount.value.toLocaleString(locale())}
            description={
              headcount.change === null
                ? tr('home.people-home.today', 'today')
                : tr('home.people-home.in_12_months', '{{value}}{{change}} in 12 months', {
                    value: headcount.change >= 0 ? '+' : '',
                    change: String(headcount.change),
                  })
            }
            {...(headcount.trend.length < 2
              ? {}
              : {
                  chart: (
                    <Sparkline
                      data={headcount.trend}
                      label={tr('home.people-home.headcount_by_month', 'Headcount by month')}
                    />
                  ),
                })}
          />
        )}
        {hr.complete === null ? null : (
          <Figure
            href={review('missing')}
            label={tr('home.people-home.complete_records', 'Complete records')}
            value={hr.complete.percent}
            unit="%"
            description={tr('home.people-home.incomplete', '{{toLocaleString}} incomplete', {
              toLocaleString: hr.complete.incomplete.toLocaleString(locale()),
            })}
          />
        )}
        {approvals === null ? null : (
          <Figure
            href={review('changes')}
            label={tr('home.people-home.waiting_for_a_decision', 'Waiting for a decision')}
            value={approvals.total}
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
            value={hr.expiring}
            description={tr(
              'home.people-home.permits_contracts_probations',
              'Permits, contracts, probations',
            )}
            className="touch:hidden"
          />
        )}
      </WidgetGrid>
      <WidgetGrid>
        {toDo}
        <Section
          title={tr('home.people-home.needs_hr', 'Needs HR')}
          icon={<icons.review aria-hidden />}
          tone="warning"
          {...(needs.length === 0 ? {} : { meta: needs.length })}
          span={2}
          flush={needs.length > 0}
          action={
            <SeeAll href="/people/review/waiting">
              {tr('home.people-home.open_review', 'Open Review')}
            </SeeAll>
          }
        >
          {needs.length === 0 ? (
            <Done
              title={tr('home.people-home.nothing_needs_hr', 'Nothing needs HR')}
              detail={tr(
                'home.people-home.records_are_complete_and_nothing_is',
                'Records are complete and nothing is flagged.',
              )}
            />
          ) : (
            <List aria-label={tr('home.people-home.needs_hr', 'Needs HR')}>{needs}</List>
          )}
        </Section>
        {hr.starting.length === 0 ? null : (
          <Section
            title={tr('home.people-home.starting_soon', 'Starting soon')}
            icon={<icons.hire aria-hidden />}
            tone="success"
            meta={hr.starting.length}
            flush
            action={
              <SeeAll href="/people/directory/list">
                {tr('home.people-home.directory', 'Directory')}
              </SeeAll>
            }
          >
            <List aria-label={tr('home.people-home.starting_soon', 'Starting soon')}>
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
                  <a href={`/people/${p.id}`}>{p.name}</a>
                </ListItem>
              ))}
            </List>
          </Section>
        )}
        {hr.joiners.length === 0 ? null : (
          <Section
            title={tr('home.people-home.joiners_by_month', 'Joiners by month')}
            icon={<icons.analytics aria-hidden />}
            tone="chart-1"
            className="touch:hidden"
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
        {me === null ? null : (
          // HR's own record, which the old overview left out.
          <Section
            title={tr('home.people-home.your_profile', 'Your profile')}
            icon={<icons.person aria-hidden />}
            tone="chart-2"
            className="touch:hidden"
            action={
              <SeeAll href="/people/me">{tr('home.people-home.my_profile', 'My profile')}</SeeAll>
            }
          >
            <div className="flex items-center gap-2.5">
              <Avatar size="sm" name={me.name} src={me.avatarUrl ?? undefined} />
              <p className="min-w-0 flex-1 text-sm text-fg-muted">
                {tr('home.people-home.your_own_record_is', 'Your own record is')}{' '}
                <b className="text-fg">
                  {me.missing === null || me.missing === 0
                    ? tr('home.people-home.complete', 'complete')
                    : tr('home.people-home.missing', 'missing {{counted}}', {
                        counted: tr(
                          'home.people-home.count_details',
                          { one: '{{count}} detail', other: '{{count}} details' },
                          { count: me.missing },
                        ),
                      })}
                </b>
              </p>
            </div>
          </Section>
        )}
      </WidgetGrid>
    </Stack>
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
 * Home: "Hi", today where they work, and the page for who they are: HR's
 * (B2) or anybody's (B1). Signing up's last asks come first.
 */
export function PeopleHome({ load, onPhoto, onSetupFile, toDo }: PeopleHomeProps): JSX.Element {
  return (
    <Loaded load={load} what={tr('home.people-home.your_home', 'your home')}>
      {(state) => {
        const { me, reportingLine, hr } = state;
        const hrFigures = state.roles.hr ? (hr ?? null) : null;
        const today = me === null ? '' : weekday(state.now, me.timeZone);
        const time = me === null ? '' : localTime(state.now, me.timeZone);
        const where = me?.location ?? null;
        const when = [
          today,
          [time, where === null ? null : tr('home.people-home.in', 'in {{where}}', { where })]
            .filter((x) => x !== null && x !== '')
            .join(' '),
        ]
          .filter((x) => x !== '')
          .join(' · ');
        return (
          <Stack gap={5}>
            <PageHeader
              className="@3xl/page:pe-64"
              title={
                me === null
                  ? tr('home.people-home.home', 'Home')
                  : tr('home.people-home.hi', 'Hi {{first}}', { first: first(me.name) })
              }
              description={
                me === null
                  ? tr(
                      'home.people-home.your_account_is_not_linked_to',
                      'Your account is not linked to anybody’s record, so there is no profile to show.',
                    )
                  : hrFigures !== null
                    ? tr(
                        'home.people-home.heres_what_needs_hr_today',
                        '{{when}}. Here’s what needs HR today.',
                        { when },
                      )
                    : when
              }
              actions={
                hrFigures === null ? undefined : (
                  <Button
                    asChild
                    variant="primary"
                    startIcon={<icons.hire aria-hidden />}
                    shortcut="create"
                  >
                    <a href="/people/directory/list?add=person">
                      {tr('home.people-home.add_person', 'Add person')}
                    </a>
                  </Button>
                )
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
                  toDo={
                    toDo === undefined || toDo.tasks.length === 0 ? undefined : (
                      <HostList toDo={{ ...toDo, waiting: [] }} />
                    )
                  }
                />
              </>
            ) : me === null ? null : (
              // A dashboard of widgets, each as wide as what it holds.
              <WidgetGrid>
                {/* Under a finger, who they are is one row above the list (MA B1). */}
                <a
                  href="/people/me"
                  className="hidden items-center gap-3.5 rounded-lg touch:flex focus-visible:outline-2 focus-visible:outline-border-focus"
                >
                  <Avatar size="2xl" name={me.name} src={me.avatarUrl ?? undefined} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-xl font-bold">{me.name}</span>
                    <span className="block text-sm text-fg-muted">
                      {[me.title, me.location, time]
                        .filter((x) => x !== null && x !== '')
                        .join(' · ')}
                    </span>
                  </span>
                </a>
                {toDo === undefined ? <ToDo state={state} me={me} /> : <HostList toDo={toDo} />}
                <div className="touch:hidden">
                  <Identity me={me} now={state.now} />
                </div>
                {reportingLine === null ? null : <ReportingLine line={reportingLine} me={me} />}
                {reportingLine === null || reportingLine.reportsTotal === 0 ? null : (
                  <Team line={reportingLine} />
                )}
              </WidgetGrid>
            )}
          </Stack>
        );
      }}
    </Loaded>
  );
}
