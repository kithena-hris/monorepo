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
  CircularProgress,
  KeyValues,
  List,
  ListItem,
  PageHeader,
  PersonCard,
  Sparkline,
  Stack,
  Stat,
  type ChartPoint,
  type UploadedImage,
  icons,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import { whoOf } from '../export/words';
import { Loaded, type Loadable } from '../load';
import { FieldFiles, FileInput, type UploadOutcome } from '../record/files';
import { localTime } from '../record/display';
import { MissingMark } from '../record/missing';

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
}

/* ------------------------------------------------------------- words -- */

const DAY = 86_400_000;

/** "today", "yesterday", "5 days ago": how long something has waited, in days. */
export function waited(since: string, now: string): string {
  const days = Math.max(0, Math.floor((Date.parse(now) - Date.parse(since)) / DAY));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${String(days)} days ago`;
  return `${String(Math.floor(days / 30))} months ago`;
}

/** "2 years, 3 months": whole months from a start date to today, both calendar dates. */
export function tenure(startedOn: string, today: string): string | null {
  const [y1, m1, d1] = startedOn.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  if ([y1, m1, d1, y2, m2, d2].some((n) => n === undefined || Number.isNaN(n))) return null;
  const months =
    ((y2 ?? 0) - (y1 ?? 0)) * 12 + ((m2 ?? 0) - (m1 ?? 0)) - ((d2 ?? 0) < (d1 ?? 0) ? 1 : 0);
  if (months < 0) return null;
  if (months === 0) return 'less than a month';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;
  return [years > 0 ? plural(years, 'year') : null, rest > 0 ? plural(rest, 'month') : null]
    .filter((x) => x !== null)
    .join(', ');
}

const longDate = (date: string): string =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

/** "Wednesday 3 October": today, where they work. */
const weekday = (now: string, timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-GB', {
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
  active: { label: 'Active', tone: 'success' },
  pre_hire: { label: 'Starting soon', tone: 'info' },
  provisional: { label: 'Not hired yet', tone: 'neutral' },
  on_leave: { label: 'On leave', tone: 'info' },
  notice: { label: 'On notice', tone: 'warning' },
};

/** "Ada" from "Ada Lovelace": what Home calls them. */
const first = (name: string): string => name.split(' ')[0] ?? name;

/** An item in Review, its chip chosen: where each row of Home's lists goes. */
const review = (kind: string, item?: string): string =>
  `/people/review/waiting?kind=${kind}${item === undefined ? '' : `&item=${encodeURIComponent(item)}`}`;

const counted = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/* -------------------------------------------------------------- parts -- */

/** A titled card, with a link or a figure beside its title: Home's section. */
function Section({
  title,
  action,
  children,
  className,
}: {
  readonly title: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}): JSX.Element {
  return (
    <section className={className}>
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle level={2}>{title}</CardTitle>
          {action}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
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
          label={`${word ?? 'Open'}: ${title}`}
          word={word}
          {...(primary === undefined ? {} : { primary })}
        />
      }
    >
      {title}
    </ListItem>
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
      title="To do"
      action={
        <div className="flex items-center gap-2">
          <CircularProgress
            value={percent}
            size={40}
            showValue={false}
            label={`${String(state.missing.length)} of ${String(me.required)} required ${me.required === 1 ? 'detail' : 'details'} missing`}
            tone={percent >= 100 ? 'success' : 'accent'}
          />
          <span className="text-sm text-fg-muted">
            <b className="text-fg">{percent}%</b> of your record
          </span>
        </div>
      }
    >
      {rows === 0 ? (
        <Done
          title={state.missing.length === 0 ? 'Your record is complete' : 'Nothing for you to do'}
          detail={
            state.missing.length === 0
              ? 'Everything People asks of you is filled in. If a new detail is needed, it shows up here.'
              : 'What is left is for somebody else to fill in.'
          }
        />
      ) : (
        <List aria-label="To do" className="-mx-2 bg-transparent shadow-none">
          {corrections.map((c) => (
            <Todo
              key={`correct-${c.key}`}
              icon={<icons.warning aria-hidden />}
              tone="danger"
              title={`Correct your ${c.label}`}
              description={`HR could not accept it: ${c.reason.charAt(0).toLowerCase()}${c.reason.slice(1)}`}
              href={`/people/me?field=${encodeURIComponent(c.key)}`}
              word="Correct it"
              primary
            />
          ))}
          {yours.map((m) => (
            <Todo
              key={m.key}
              icon={<icons.missing aria-hidden />}
              title={`Add your ${m.label.toLowerCase()}`}
              description={m.section}
              href={`/people/me?field=${encodeURIComponent(m.key)}`}
              word="Add"
            />
          ))}
          {changes.map((c) => (
            <Todo
              key={c.id}
              icon={<icons.scheduled aria-hidden />}
              title={`Your new ${c.label.toLowerCase()} is with HR`}
              description={`Sent ${waited(c.requestedAt, state.now)} · nothing changes until HR approves`}
              href={review('changes', `change-${c.id}`)}
              word={null}
            />
          ))}
        </List>
      )}
      {theirs.length === 0 ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-muted">
            Waiting on {[...new Set(theirs.map((m) => m.ownedBy))].join(' and ')}, nothing for you
            to do:
          </span>
          <ul aria-label="Waiting on somebody else" className="contents">
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
    <Card padded className="flex flex-col gap-3.5">
      <div className="flex items-center gap-3.5">
        <Avatar
          size="2xl"
          name={me.name}
          src={me.avatarUrl ?? undefined}
          {...(status === undefined ? {} : { status: status.tone })}
        />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold tracking-tight text-fg">{me.name}</h2>
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
        aria-label="Your details"
        items={[
          ...(time === '' ? [] : [{ label: 'Local time', value: time }]),
          ...(me.startedOn === null
            ? []
            : [
                {
                  label: 'Joined',
                  value: `${longDate(me.startedOn)}${since === null ? '' : ` · ${since}`}`,
                },
              ]),
          ...(me.email === null
            ? []
            : [
                {
                  label: 'Email',
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
        <a href="/people/me">View your profile</a>
      </Button>
    </Card>
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
  const top = above[0];
  const manager = line.managers[0];
  const joint = <span aria-hidden className="ms-6 h-3 w-0.5 bg-border-strong" />;
  return (
    <Section
      title="Your reporting line"
      action={<SeeAll href="/people/directory/org-chart">Org chart</SeeAll>}
    >
      <Stack gap={3}>
        <ol aria-label="Your managers, from the top" className="flex flex-col">
          {line.moreAbove && top !== undefined ? (
            <li className="pb-2 text-xs text-fg-muted">
              <a className="underline underline-offset-4" href={`/people/${top.id}`}>
                The line goes on above {top.name}
              </a>
            </li>
          ) : null}
          {above.map((m, i) => (
            <li
              key={m.id}
              // Under a finger, only the manager: the one row a phone keeps.
              className={i === above.length - 1 ? 'flex flex-col' : 'flex flex-col touch:hidden'}
            >
              <PersonCard
                layout="row"
                name={m.name}
                description={
                  m.id === manager?.id
                    ? `Your manager · ${m.title ?? ''}`.replace(/ · $/, '')
                    : m.title
                }
                href={`/people/${m.id}`}
                {...(m.avatarUrl === null ? {} : { avatarSrc: m.avatarUrl })}
              />
              <span className="contents touch:hidden">{joint}</span>
            </li>
          ))}
          <li className="touch:hidden">
            <PersonCard
              layout="row"
              selected
              name="You"
              description={me.title}
              {...(me.avatarUrl === null ? {} : { avatarSrc: me.avatarUrl })}
            />
          </li>
        </ol>
        {line.peers === null || manager === undefined ? null : (
          <p className="text-sm text-fg-muted">
            {line.peers === 0
              ? `Nobody else reports to ${manager.name}.`
              : `${String(line.peers)} ${line.peers === 1 ? 'other reports' : 'others report'} to ${first(manager.name)}.`}
          </p>
        )}
      </Stack>
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
      title={
        <>
          Your direct reports{' '}
          <span className="font-normal text-fg-muted tabular-nums">{line.reportsTotal}</span>
        </>
      }
      action={
        line.reportsFilter === null ? undefined : (
          <SeeAll href={`/people/directory/list?filter=${encodeURIComponent(line.reportsFilter)}`}>
            {line.reportsTotal > line.reports.length
              ? `Show all ${String(line.reportsTotal)}`
              : 'In the directory'}
          </SeeAll>
        )
      }
    >
      <List aria-label="Your direct reports" className="-mx-2 bg-transparent shadow-none">
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
  const what = `${String(n)} ${n === 1 ? 'looks' : 'look'} unusual`;
  return reason === null || reason === ''
    ? what
    : `${what}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
}

/**
 * Home for HR (B2, MA B2): the records' four figures, then "Needs HR", one
 * list across every queue, each row opening Review with its chip chosen;
 * beside it who is starting, who joined, and a line for their own record.
 */
function HrHome({
  hr,
  state,
}: {
  readonly hr: NonNullable<PeopleHomeState['hr']>;
  readonly state: PeopleHomeState;
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
        title={counted(changes, 'change to approve', 'changes to approve')}
        description={[
          unusual(approvals) ??
            (oldest === undefined
              ? 'Waiting for your decision'
              : `Oldest asked ${waited(oldest.requestedAt, state.now)}`),
          askers === null ? null : `asked by ${byWhom(askers)}`,
        ]
          .filter((x) => x !== null)
          .join(' · ')}
        href={review('changes')}
        word="Review"
        primary
      />,
    );
  }
  if ((hr.identifiers ?? 0) > 0) {
    needs.push(
      <Todo
        key="ids"
        icon={<icons.identifier aria-hidden />}
        title={counted(hr.identifiers ?? 0, 'identifier to check', 'identifiers to check')}
        description={[
          'Failed a check, or couldn’t be verified',
          ((by) => (by === null ? null : `entered by ${byWhom(by)}`))(
            whoOf(hr.identifiersBy ?? []),
          ),
        ]
          .filter((x) => x !== null)
          .join(' · ')}
        href={review('ids')}
        word="Review"
      />,
    );
  }
  if ((hr.duplicates ?? 0) > 0) {
    needs.push(
      <Todo
        key="duplicates"
        icon={<icons.merge aria-hidden />}
        title={counted(hr.duplicates ?? 0, 'possible duplicate', 'possible duplicates')}
        description="Same work email, or name and birth date · flagged by Kithena’s checks"
        href={review('duplicates')}
        word="Compare"
      />,
    );
  }
  if ((hr.accessRequests ?? 0) > 0) {
    needs.push(
      <Todo
        key="access"
        icon={<icons.sensitive aria-hidden />}
        title={counted(
          hr.accessRequests ?? 0,
          'request for full values',
          'requests for full values',
        )}
        description={`${whoOf(hr.accessRequestsBy ?? []) ?? 'Somebody'} asked to see unmasked values`}
        href={review('access')}
        word="Decide"
      />,
    );
  }
  if (team !== null && team.toFill > 0) {
    needs.push(
      <Todo
        key="fill"
        icon={<icons.missing aria-hidden />}
        title={counted(team.toFill, 'detail for HR to fill in', 'details for HR to fill in')}
        description="Missing details only HR keeps"
        href={review('missing')}
        word="Fill in"
      />,
    );
  }
  if (team !== null && team.waiting > 0) {
    needs.push(
      <Todo
        key="remind"
        icon={<icons.notifications aria-hidden />}
        title={`${counted(team.waiting, 'person has', 'people have')} details of their own to add`}
        description="Reminded by email once a week"
        href={review('missing')}
        word="Remind"
      />,
    );
  }
  const headcount = hr.headcount;
  const oldest = approvals?.items.at(-1);
  const me = state.me;
  return (
    <Stack gap={4}>
      <div className="grid grid-cols-2 gap-3.5 @5xl/page:grid-cols-4">
        {headcount === null ? null : (
          <Figure
            href="/people/insights/headcount"
            label="Headcount"
            value={headcount.value.toLocaleString('en-GB')}
            description={
              headcount.change === null
                ? 'today'
                : `${headcount.change >= 0 ? '+' : ''}${String(headcount.change)} in 12 months`
            }
            {...(headcount.trend.length < 2
              ? {}
              : { chart: <Sparkline data={headcount.trend} label="Headcount by month" /> })}
          />
        )}
        {hr.complete === null ? null : (
          <Figure
            href={review('missing')}
            label="Complete records"
            value={hr.complete.percent}
            unit="%"
            description={`${hr.complete.incomplete.toLocaleString('en-GB')} incomplete`}
          />
        )}
        {approvals === null ? null : (
          <Figure
            href={review('changes')}
            label="Waiting for a decision"
            value={approvals.total}
            description={
              oldest === undefined
                ? 'nothing waiting'
                : `Oldest asked ${waited(oldest.requestedAt, state.now)}`
            }
            className="touch:hidden"
          />
        )}
        {hr.expiring === null ? null : (
          <Figure
            href="/people/insights/data-quality"
            label="Expiring in 90 days"
            value={hr.expiring}
            description="Permits, contracts, probations"
            className="touch:hidden"
          />
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @5xl/page:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Section
          title="Needs HR"
          action={<SeeAll href="/people/review/waiting">Open Review</SeeAll>}
        >
          {needs.length === 0 ? (
            <Done title="Nothing needs HR" detail="Records are complete and nothing is flagged." />
          ) : (
            <List aria-label="Needs HR" className="-mx-2 bg-transparent shadow-none">
              {needs}
            </List>
          )}
        </Section>
        <Stack gap={4}>
          {hr.starting.length === 0 ? null : (
            <Section
              title="Starting soon"
              action={<SeeAll href="/people/directory/list">Directory</SeeAll>}
            >
              <List aria-label="Starting soon" className="-mx-2 bg-transparent shadow-none">
                {hr.starting.map((p) => (
                  <ListItem
                    key={p.id}
                    asChild
                    leading={<Avatar size="lg" name={p.name} src={p.avatarUrl ?? undefined} />}
                    description={p.detail}
                    trailing={
                      p.missing === null || p.missing === 0 ? (
                        <Badge size="sm" tone="success">
                          Ready
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
            <Section title="Joiners by month" className="touch:hidden">
              <BarChart
                data={hr.joiners}
                label="People who joined, by month"
                height={120}
                showValues
              />
            </Section>
          )}
          {me === null ? null : (
            // HR's own record, which the old overview left out.
            <Card variant="outlined" padded className="flex items-center gap-2.5 touch:hidden">
              <Avatar size="sm" name={me.name} src={me.avatarUrl ?? undefined} />
              <p className="min-w-0 flex-1 text-sm text-fg-muted">
                Your own record is{' '}
                <b className="text-fg">
                  {me.missing === null || me.missing === 0
                    ? 'complete'
                    : `missing ${counted(me.missing, 'detail', 'details')}`}
                </b>
              </p>
              <SeeAll href="/people/me">My profile</SeeAll>
            </Card>
          )}
        </Stack>
      </div>
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
        <CardTitle level={2}>Finish setting up your account</CardTitle>
        {required ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLater(true);
            }}
          >
            Later
          </Button>
        )}
        <CardDescription>
          {required
            ? 'Your company asks for these before anything else. Each is saved as soon as you choose it.'
            : 'Your company would like these. Each is saved as soon as you choose it.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap={5}>
          {setup.photo === null || onPhoto === undefined ? null : (
            <AvatarUploader
              label={setup.photo === 'required' ? 'Your photo (required)' : 'Your photo'}
              hint={
                busy
                  ? 'Uploading…'
                  : (photoProblem ?? 'A clear photo of your face, so colleagues know who you are.')
              }
              value={picked}
              src={photo}
              fallback={<Avatar size="xl" name={name} className="ring-0" />}
              accept={['image/png', 'image/jpeg', 'image/webp']}
              maxSize={20 * 1024 * 1024}
              disabled={busy}
              invalid={photoProblem !== null}
              onReject={(rejections) => {
                setPhotoProblem(rejections[0]?.message ?? 'That image was not accepted.');
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
                    return Promise.resolve({ ok: false, message: 'No such field' });
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
export function PeopleHome({ load, onPhoto, onSetupFile }: PeopleHomeProps): JSX.Element {
  return (
    <Loaded load={load} what="your home">
      {(state) => {
        const { me, reportingLine, hr } = state;
        const hrFigures = state.roles.hr ? (hr ?? null) : null;
        const today = me === null ? '' : weekday(state.now, me.timeZone);
        const time = me === null ? '' : localTime(state.now, me.timeZone);
        const where = me?.location ?? null;
        const when = [
          today,
          [time, where === null ? null : `in ${where}`]
            .filter((x) => x !== null && x !== '')
            .join(' '),
        ]
          .filter((x) => x !== '')
          .join(' · ');
        return (
          <Stack gap={5}>
            <PageHeader
              className="@3xl/page:pe-64"
              title={me === null ? 'Home' : `Hi ${first(me.name)}`}
              description={
                me === null
                  ? 'Your account is not linked to anybody’s record, so there is no profile to show.'
                  : hrFigures !== null
                    ? `${when}. Here’s what needs HR today.`
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
                    <a href="/people/directory/list?add=person">Add person</a>
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
              <HrHome hr={hrFigures} state={state} />
            ) : me === null ? null : (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @5xl/page:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
                <Stack gap={4}>
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
                  <ToDo state={state} me={me} />
                </Stack>
                <Stack gap={4}>
                  <div className="touch:hidden">
                    <Identity me={me} now={state.now} />
                  </div>
                  {reportingLine === null ? null : <ReportingLine line={reportingLine} me={me} />}
                  {reportingLine === null || reportingLine.reportsTotal === 0 ? null : (
                    <Team line={reportingLine} />
                  )}
                </Stack>
              </div>
            )}
          </Stack>
        );
      }}
    </Loaded>
  );
}
