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
  List,
  ListItem,
  PageHeader,
  PersonCard,
  Progress,
  Sparkline,
  Stack,
  Stat,
  type ChartPoint,
  type UploadedImage,
  icons,
} from '@reach/ui';
import { useState, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable } from '../load';
import { FieldFiles, FileInput, type UploadOutcome } from '../record/files';
import { MissingMark } from '../record/missing';

/**
 * Where People starts: who am I here, what needs me, what is missing.
 *
 * Read top to bottom in that order. The person first, as a strip rather than
 * a card of cards — their photo, what they do, where and since when, and the
 * way to their record. Then what needs them, as lists with a way to all of
 * it: the changes waiting for a decision and the details only they can give,
 * each one a link to exactly where it is done. Beside that, narrower, the
 * reporting line as the org chart draws it: the managers above, them, the
 * people below. HR's quieter figures and every place People has come last.
 *
 * Everything here was decided by People for this viewer: a part they have no
 * use for arrives as null and is simply not drawn, and nothing on the page
 * can show a person or a field People did not hand over.
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

const localTime = (now: string, timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone }).format(new Date(now));
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

/* -------------------------------------------------------------- parts -- */

/** A card with a heading and, optionally, a link beside it: the overview's section. */
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

/** A "Show all" that is a link, because it goes somewhere. */
function ShowAll({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Button asChild size="sm" variant="ghost" endIcon={<icons.forward aria-hidden />}>
      <a href={href}>{children}</a>
    </Button>
  );
}

/** Who they are (W1): the photo, what they do, their badges, and the way to their record. */
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
    <Card padded className="flex flex-wrap items-center gap-5">
      <Avatar size="3xl" name={me.name} src={me.avatarUrl ?? undefined} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h2 className="font-display text-xl font-bold tracking-tight text-fg">{me.name}</h2>
        {role === '' ? null : <p className="text-sm text-fg-muted">{role}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          {status === undefined ? null : (
            <Badge size="sm" dot tone={status.tone}>
              {status.label}
            </Badge>
          )}
          {me.missing === null || me.missing === 0 ? null : <MissingMark count={me.missing} />}
        </div>
        <ul aria-label="Your details" className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
          {time === '' ? null : (
            <Detail icon={<icons.location />}>
              <span className="tabular-nums">{time} local time</span>
            </Detail>
          )}
          {me.startedOn === null ? null : (
            <Detail icon={<icons.calendar />}>
              Joined {longDate(me.startedOn)}
              {since === null ? null : ` · ${since}`}
            </Detail>
          )}
          {me.email === null ? null : (
            <Detail icon={<icons.email />}>
              <a
                className="relative tap-target underline-offset-4 hover:underline"
                href={`mailto:${me.email}`}
              >
                {me.email}
              </a>
            </Detail>
          )}
        </ul>
      </div>
      <Button asChild endIcon={<icons.forward aria-hidden />}>
        <a href="/people/me">View your profile</a>
      </Button>
    </Card>
  );
}

/** A detail with its icon: the icon is decoration, the words carry it. */
function Detail({
  icon,
  children,
}: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <li className="flex min-w-0 items-center gap-1.5 text-sm text-fg-muted">
      <span aria-hidden className="shrink-0 text-fg-subtle [&_svg]:size-3.5">
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </li>
  );
}

/** A warning tile, for a detail that is wanted: the icon repeats what the words say. */
function Wanted(): JSX.Element {
  return (
    <Avatar
      size="lg"
      shape="rounded"
      name="Missing"
      tone="warning"
      fallback={<icons.missing aria-hidden />}
    />
  );
}

/** How complete their own record is, and each detail of theirs that is missing (W1). */
function Completeness({
  missing,
  required,
}: {
  readonly missing: PeopleHomeState['missing'];
  readonly required: number;
}): JSX.Element {
  const yours = missing.filter((m) => m.ownedBy === null);
  const theirs = missing.filter((m) => m.ownedBy !== null);
  const percent = required === 0 ? 100 : Math.round(((required - missing.length) / required) * 100);
  return (
    <Section
      title={
        missing.length === 0
          ? 'Your record is complete'
          : `Your profile is ${String(percent)}% complete`
      }
      action={
        missing.length === 0 ? undefined : <ShowAll href="/people/me">Open your profile</ShowAll>
      }
    >
      {missing.length === 0 ? (
        <Done
          title="Your record is complete"
          detail="Everything People asks of you is filled in. If a new detail is needed, it shows up here."
        />
      ) : (
        <Stack gap={4}>
          <Progress
            value={percent}
            showValue
            label={`${String(missing.length)} of ${String(required)} required ${required === 1 ? 'detail' : 'details'} missing`}
            valueLabel={`${String(percent)}%`}
          />
          {yours.length === 0 ? null : (
            <List aria-label="For you to add" className="-mx-2 bg-transparent shadow-none">
              {yours.map((m) => (
                <ListItem
                  key={m.key}
                  asChild
                  leading={<Wanted />}
                  description={m.section}
                  trailing={
                    <Badge size="sm" tone="accent">
                      Add
                    </Badge>
                  }
                >
                  <a href={`/people/me?field=${encodeURIComponent(m.key)}`}>{m.label}</a>
                </ListItem>
              ))}
            </List>
          )}
          {theirs.length === 0 ? null : (
            <div>
              <p className="text-xs text-fg-muted">
                Waiting on {[...new Set(theirs.map((m) => m.ownedBy))].join(' and ')}, nothing for
                you to do:
              </p>
              <ul aria-label="Waiting on somebody else" className="mt-1.5 flex flex-wrap gap-2">
                {theirs.map((m) => (
                  <li key={m.key}>
                    <Badge size="sm">{m.label}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Stack>
      )}
    </Section>
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

/** Changes waiting for a decision: theirs to decide, or their own waiting on HR. */
function Approvals({
  approvals,
  now,
}: {
  readonly approvals: NonNullable<PeopleHomeState['approvals']>;
  readonly now: string;
}): JSX.Element {
  const title = approvals.isHr ? 'Waiting for your approval' : 'Your changes waiting for approval';
  return (
    <Section
      title={title}
      action={
        approvals.total > 0 ? (
          <ShowAll href="/people/approvals">
            {approvals.total > approvals.items.length
              ? `Show all ${String(approvals.total)}`
              : 'Open approvals'}
          </ShowAll>
        ) : undefined
      }
    >
      {approvals.items.length === 0 ? (
        <Done
          title="Nothing waiting"
          detail={
            approvals.isHr
              ? 'When somebody changes a detail that needs HR’s approval, it lands here first.'
              : 'Changes you make that need HR’s approval wait here until they decide.'
          }
        />
      ) : (
        <List aria-label={title} className="-mx-2 bg-transparent shadow-none">
          {approvals.items.map((a) => (
            <ListItem
              key={a.id}
              asChild
              leading={<Avatar size="lg" name={a.name} src={a.avatarUrl ?? undefined} />}
              description={`${a.label} · asked by ${a.requestedBy}`}
              meta={waited(a.requestedAt, now)}
            >
              <a href="/people/approvals">{`${a.name} · ${a.label}`}</a>
            </ListItem>
          ))}
        </List>
      )}
    </Section>
  );
}

/**
 * The reporting line as the org chart draws it (W1): the managers from the
 * top, one card each joined by a rule, then them, then who reports to them.
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
  const joint = <span aria-hidden className="mx-auto h-3.5 w-0.5 bg-border-strong" />;
  return (
    <Section title="Your reporting line">
      <Stack gap={4}>
        <ol aria-label="Your managers, from the top" className="flex flex-col">
          {line.moreAbove && top !== undefined ? (
            <li className="pb-2 text-center text-xs text-fg-muted">
              <a className="underline underline-offset-4" href={`/people/${top.id}`}>
                The line goes on above {top.name}
              </a>
            </li>
          ) : null}
          {above.map((m) => (
            <li key={m.id} className="flex flex-col">
              <PersonCard
                layout="row"
                name={m.name}
                description={m.title}
                href={`/people/${m.id}`}
                {...(m.avatarUrl === null ? {} : { avatarSrc: m.avatarUrl })}
              />
              {joint}
            </li>
          ))}
          <li>
            <PersonCard
              layout="row"
              selected
              name={me.name}
              description={`You${me.title === null ? '' : ` · ${me.title}`}`}
              {...(me.avatarUrl === null ? {} : { avatarSrc: me.avatarUrl })}
            />
          </li>
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {line.peers === null || manager === undefined ? (
            <span />
          ) : (
            <p className="text-xs text-fg-muted">
              {line.peers === 0
                ? `Nobody else reports to ${manager.name}.`
                : `${String(line.peers)} ${line.peers === 1 ? 'other person reports' : 'others report'} to ${manager.name}.`}
            </p>
          )}
          <ShowAll href="/people/directory/org-chart">Open org chart</ShowAll>
        </div>
      </Stack>
    </Section>
  );
}

/** Who reports to them (W1, "Your team"), as a row of faces and the way to all of them. */
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
          <ShowAll href={`/people/directory/list?filter=${encodeURIComponent(line.reportsFilter)}`}>
            {line.reportsTotal > line.reports.length
              ? `Show all ${String(line.reportsTotal)}`
              : 'In the directory'}
          </ShowAll>
        )
      }
    >
      <ul aria-label="Your direct reports" className="flex flex-col">
        {line.reports.map((r) => (
          <li key={r.id}>
            <a
              href={`/people/${r.id}`}
              className="flex min-h-tap items-center gap-3 rounded-md px-2 py-1.5 -mx-2 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-border-focus"
            >
              <Avatar size="md" name={r.name} src={r.avatarUrl ?? undefined} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{r.name}</span>
                {r.title === null ? null : (
                  <span className="block truncate text-xs text-fg-muted">{r.title}</span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ul>
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
}: {
  readonly href: string;
  readonly label: string;
  readonly value: ReactNode;
  readonly unit?: string;
  readonly description: ReactNode;
  readonly chart?: ReactNode;
}): JSX.Element {
  return (
    <a
      href={href}
      className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
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

/** A row of "Needs attention": the count, what it is, and the button to it. */
function Attention({
  icon,
  tone,
  title,
  description,
  action,
  href,
}: {
  readonly icon: ReactNode;
  readonly tone: 'warning' | 'danger' | 'info' | 'accent';
  readonly title: string;
  readonly description: string;
  readonly action: string;
  readonly href: string;
}): JSX.Element {
  return (
    <ListItem
      leading={<Avatar size="lg" shape="rounded" name={title} tone={tone} fallback={icon} />}
      description={description}
      trailing={
        <Button asChild size="xs">
          <a href={href} aria-label={`${action}: ${title}`}>
            {action}
          </a>
        </Button>
      }
    >
      {title}
    </ListItem>
  );
}

/** HR's overview (W2): the figures, what needs HR, who joins, who starts. */
function HrOverview({
  hr,
  state,
}: {
  readonly hr: NonNullable<PeopleHomeState['hr']>;
  readonly state: PeopleHomeState;
}): JSX.Element {
  const approvals = state.approvals;
  const team = state.team;
  const attention: JSX.Element[] = [];
  if (team !== null && team.toFill + team.waiting > 0) {
    attention.push(
      <Attention
        key="incomplete"
        icon={<icons.missing aria-hidden />}
        tone="warning"
        title={`${String(team.toFill)} ${team.toFill === 1 ? 'detail waits' : 'details wait'} for HR`}
        description={`${String(team.waiting)} ${team.waiting === 1 ? 'person has' : 'people have'} something of their own to add`}
        action="Review"
        href="/people/data-health/completeness"
      />,
    );
  }
  if ((hr.identifiers ?? 0) > 0) {
    attention.push(
      <Attention
        key="ids"
        icon={<icons.identifier aria-hidden />}
        tone="danger"
        title={`${String(hr.identifiers)} ${hr.identifiers === 1 ? 'identifier needs' : 'identifiers need'} review`}
        description="A national identifier failed its country’s check"
        action="Review"
        href="/people/data-health/id-checks"
      />,
    );
  }
  if ((hr.duplicates ?? 0) > 0) {
    attention.push(
      <Attention
        key="dupes"
        icon={<icons.merge aria-hidden />}
        tone="info"
        title={`${String(hr.duplicates)} possible ${hr.duplicates === 1 ? 'duplicate' : 'duplicates'}`}
        description="Records that look like the same person"
        action="Compare"
        href="/people/data-health/duplicates"
      />,
    );
  }
  if ((hr.accessRequests ?? 0) > 0) {
    attention.push(
      <Attention
        key="access"
        icon={<icons.sensitive aria-hidden />}
        tone="accent"
        title={`${String(hr.accessRequests)} access ${hr.accessRequests === 1 ? 'request' : 'requests'}`}
        description="Somebody asked to see unmasked values"
        action="Decide"
        href="/people/data-health/access-requests"
      />,
    );
  }
  const headcount = hr.headcount;
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
            href="/people/data-health/completeness"
            label="Complete records"
            value={hr.complete.percent}
            unit="%"
            description={`${hr.complete.incomplete.toLocaleString('en-GB')} incomplete`}
          />
        )}
        {approvals === null ? null : (
          <Figure
            href="/people/approvals"
            label="Approvals waiting"
            value={approvals.total}
            description={
              approvals.items[0] === undefined
                ? 'nothing waiting'
                : `oldest ${waited(approvals.items[0].requestedAt, state.now)}`
            }
          />
        )}
        {hr.expiring === null ? null : (
          <Figure
            href="/people/insights/data-quality"
            label="Expiring in 90 days"
            value={hr.expiring}
            description="permits, contracts and probations"
          />
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @5xl/page:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section title="Needs attention">
          {attention.length === 0 ? (
            <Done title="Nothing needs HR" detail="Records are complete and nothing is flagged." />
          ) : (
            <List aria-label="Needs attention" className="-mx-2 bg-transparent shadow-none">
              {attention}
            </List>
          )}
        </Section>
        {hr.joiners.length === 0 ? (
          approvals === null ? null : (
            <Approvals approvals={approvals} now={state.now} />
          )
        ) : (
          <Section title="Joiners by month">
            <BarChart
              data={hr.joiners}
              label="People who joined, by month"
              height={170}
              showValues
            />
          </Section>
        )}
      </div>
      {hr.starting.length === 0 ? null : (
        <Section
          title="Starting soon"
          action={<ShowAll href="/people/directory/list">Directory</ShowAll>}
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
          {required ? null : (
            <div>
              <Button
                variant="ghost"
                onClick={() => {
                  setLater(true);
                }}
              >
                Later
              </Button>
            </div>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * The People overview (W1 for everybody, W2 for HR).
 *
 * Everybody opens on themselves: who they are here, how complete their record
 * is and each detail they can add, what of theirs waits for approval, and,
 * beside that, their reporting line as the org chart draws it and who
 * reports to them. HR opens on the records instead: the figures that matter,
 * what needs HR (each row a way to the screen that fixes it), who joined and
 * who is starting.
 *
 * Everything here was decided by People for this viewer: a part they have no
 * use for arrives as null and is simply not drawn, and nothing on the page
 * can show a person or a field People did not hand over.
 */
export function PeopleHome({ load, onPhoto, onSetupFile }: PeopleHomeProps): JSX.Element {
  return (
    <Loaded load={load} what="your overview">
      {(state) => {
        const { me, reportingLine, approvals, hr } = state;
        const hrFigures = state.roles.hr ? (hr ?? null) : null;
        const personal = (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @5xl/page:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Stack gap={4}>
              {me === null ? null : <Identity me={me} now={state.now} />}
              {me === null ? null : <Completeness missing={state.missing} required={me.required} />}
              {approvals === null ? null : <Approvals approvals={approvals} now={state.now} />}
            </Stack>
            {me === null || reportingLine === null ? null : (
              <Stack gap={4}>
                <ReportingLine line={reportingLine} me={me} />
                {reportingLine.reportsTotal === 0 ? null : <Team line={reportingLine} />}
              </Stack>
            )}
          </div>
        );
        return (
          <Stack gap={6}>
            <PageHeader
              title="Overview"
              description={
                hrFigures !== null
                  ? 'The state of your people records, and what needs HR.'
                  : me === null
                    ? 'Your account is not linked to anybody’s record, so there is no profile to show.'
                    : 'Your profile, what you need to do, and who you work with.'
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
            {hrFigures === null ? personal : <HrOverview hr={hrFigures} state={state} />}
          </Stack>
        );
      }}
    </Loaded>
  );
}
