import {
  Avatar,
  SegmentedControl,
  SegmentedControlItem,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  DataTable,
  type DataColumn,
  icons,
  Card,
  List,
  ListItem,
  Widget,
  WidgetGrid,
  WIDGET_LIMIT,
  type ChartTone,
} from '@reach/ui';
import { useMemo, useState, type JSX } from 'react';

import { Loaded } from './load';
import { JobConfirm, jobCommands, type Confirming, type JobRef } from './job-actions';
import { MoreMenu, Refusal, Search, StateBadge, To, day, useAct, when, whereFrom } from './shared';
import type { Category, HomeData, JobsData, ScreenProps } from './types';
import { t as tr } from './i18n';

/**
 * R1, the Recruiting overview: four figures, then two widgets side by side,
 * what is waiting on the viewer and the jobs they are on. Each widget shows
 * its top five as its filter and sort cut them (in the address), what they
 * add up to above the rows, and See all only when there are more.
 */

type Task = HomeData['tasks'][number];
type JobRow = HomeData['jobs'][number];

const TASK_ICON: Readonly<Record<string, JSX.Element>> = {
  approve_requisition: <icons.approve aria-hidden />,
  approve_offer: <icons.agreement aria-hidden />,
  scorecard: <icons.assessment aria-hidden />,
  interview: <icons.meeting aria-hidden />,
};

const TASK_TONE: Readonly<Record<string, ChartTone>> = {
  approve_requisition: 'chart-4',
  approve_offer: 'chart-3',
  scorecard: 'chart-1',
  interview: 'chart-2',
};

const TASK_KIND: Readonly<Record<string, () => string>> = {
  approve_requisition: () => tr('home.kind_requisition', 'Requisition'),
  approve_offer: () => tr('home.kind_offer', 'Offer'),
  scorecard: () => tr('home.kind_scorecard', 'Scorecard'),
  interview: () => tr('home.kind_interview', 'Interview'),
};

/** The task kinds a filter shows. */
const TASK_FILTERS = {
  all: () => true,
  approvals: (t: Task) => t.kind.startsWith('approve'),
  scorecards: (t: Task) => t.kind === 'scorecard',
  interviews: (t: Task) => t.kind === 'interview',
} as const;
type TaskFilter = keyof typeof TASK_FILTERS;
const TASK_FILTER_LABEL: Readonly<Record<TaskFilter, () => string>> = {
  all: () => tr('home.filter_all', 'All'),
  approvals: () => tr('home.filter_approvals', 'Approvals'),
  scorecards: () => tr('home.filter_scorecards', 'Scorecards'),
  interviews: () => tr('home.filter_interviews', 'Interviews'),
};
const TASK_ORDER = ['due', 'title'] as const;

/** The job states a filter shows. */
const JOB_FILTERS = {
  open: (j: JobRow) => j.state === 'open' || j.state === 'on_hold',
  drafts: (j: JobRow) => j.state === 'draft',
  closed: (j: JobRow) => j.state === 'closed' || j.state === 'filled',
  all: () => true,
} as const;
type JobFilter = keyof typeof JOB_FILTERS;
const JOB_FILTER_LABEL: Readonly<Record<JobFilter, () => string>> = {
  open: () => tr('home.filter_open', 'Open'),
  drafts: () => tr('home.filter_drafts', 'Drafts'),
  closed: () => tr('home.filter_closed', 'Closed'),
  all: () => tr('home.filter_all', 'All'),
};
const JOB_ORDER = ['newest', 'candidates', 'fresh', 'title'] as const;
type JobOrder = (typeof JOB_ORDER)[number];
const JOB_ORDER_LABEL: Readonly<Record<JobOrder, () => string>> = {
  newest: () => tr('home.sort_newest', 'Newest'),
  candidates: () => tr('home.sort_candidates', 'Most candidates'),
  fresh: () => tr('home.sort_fresh', 'Most new this week'),
  title: () => tr('home.sort_title', 'Title, A–Z'),
};

/** When a job became what it is: opened, else drafted. */
const since = (j: JobRow): string => j.openedAt ?? j.createdAt ?? '';

const JOB_SORT: Readonly<Record<JobOrder, (a: JobRow, b: JobRow) => number>> = {
  newest: (a, b) => since(b).localeCompare(since(a)),
  candidates: (a, b) => b.counts.active - a.counts.active,
  fresh: (a, b) => b.counts.newThisWeek - a.counts.newThisWeek,
  title: (a, b) => a.title.localeCompare(b.title),
};

/** Where a candidate is, in three: being screened, being interviewed, being offered. */
const PHASE: Readonly<Record<Category, 'screening' | 'interviewing' | 'offer' | null>> = {
  applied: 'screening',
  screening: 'screening',
  interview: 'interviewing',
  assessment: 'interviewing',
  works_council: 'offer',
  offer: 'offer',
  contract: 'offer',
  hired: null,
};

const pick = <T extends string>(all: readonly T[], value: string | undefined, fallback: T): T =>
  all.find((v) => v === value) ?? fallback;

function MiniPipeline({ counts }: { readonly counts: JobRow['counts'] }): JSX.Element {
  const max = Math.max(1, ...counts.byStage.map((s) => s.count));
  return (
    <span
      className="flex h-6 items-end gap-0.5"
      aria-label={counts.byStage
        .map((s) => tr('home.text', '{{name}} {{count}}', { name: s.name, count: String(s.count) }))
        .join(', ')}
    >
      {counts.byStage.map((s, i) => (
        <span
          key={s.stageId}
          title={tr('home.text_2', '{{name}}: {{count}}', { name: s.name, count: String(s.count) })}
          className="w-2 rounded-sm bg-accent"
          style={{ height: `${String(Math.max(3, (s.count / max) * 24))}px`, opacity: 1 - i * 0.1 }}
        />
      ))}
    </span>
  );
}

/** A widget's "See all", only when it holds more than it shows. */
function SeeAll({
  count,
  href,
  props,
}: {
  readonly count: number;
  readonly href: string;
  readonly props: ScreenProps<HomeData>;
}): JSX.Element | undefined {
  if (count <= WIDGET_LIMIT) return undefined;
  return (
    <Button asChild size="sm" variant="ghost" endIcon={<icons.forward aria-hidden />}>
      <To href={href} onNavigate={props.onNavigate} className="">
        {tr('home.see_all', 'See all {{count}}', { count: String(count) })}
      </To>
    </Button>
  );
}

function Tasks({
  data,
  props,
}: {
  readonly data: HomeData;
  readonly props: ScreenProps<HomeData>;
}): JSX.Element {
  const filter = pick(Object.keys(TASK_FILTERS) as TaskFilter[], props.search?.['tasks'], 'all');
  const order = pick(TASK_ORDER, props.search?.['order'], 'due');
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const link = (t: Task): string =>
    t.kind === 'approve_requisition'
      ? `/recruiting/requisitions/${t.id}/approve`
      : t.kind === 'approve_offer'
        ? `/recruiting/offers/${t.id}/approve`
        : `/recruiting/interviews/${t.id}`;
  const shown = data.tasks.filter(TASK_FILTERS[filter]).toSorted(
    order === 'title'
      ? (a, b) => a.title.localeCompare(b.title)
      : // Undated last: an approval waits, it is not late.
        (a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'),
  );
  const overdue = shown.filter((t) => t.due !== null && t.due < now).length;
  const dueToday = shown.filter(
    (t) => t.due !== null && t.due >= now && t.due.slice(0, 10) === today,
  ).length;
  const later = shown.length - overdue - dueToday;
  const dueLabel = (t: Task): string | undefined =>
    t.due === null
      ? undefined
      : t.due < now
        ? tr('home.overdue_since', 'Overdue · {{day}}', { day: day(t.due) })
        : when(t.due);
  return (
    <Widget
      title={tr('home.tasks', 'Tasks')}
      description={tr('home.from_the_inbox_for_recruiting', 'From the Inbox, for Recruiting')}
      icon={<icons.inbox aria-hidden />}
      tone="chart-1"
      {...(shown.length === 0 ? {} : { meta: shown.length })}
      action={<SeeAll count={shown.length} href={`/inbox?source=recruiting`} props={props} />}
      toolbar={
        data.tasks.length === 0 ? undefined : (
          <>
            <SegmentedControl
              size="sm"
              aria-label={tr('home.show_tasks', 'Show tasks')}
              value={filter}
              onValueChange={(v) => {
                if (v !== '') props.onFilter?.({ tasks: v === 'all' ? null : v });
              }}
            >
              {(Object.keys(TASK_FILTERS) as TaskFilter[]).map((f) => (
                <SegmentedControlItem key={f} value={f}>
                  {TASK_FILTER_LABEL[f]()}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            <Select
              value={order}
              onValueChange={(v) => props.onFilter?.({ order: v === 'due' ? null : v })}
            >
              <SelectTrigger
                size="sm"
                aria-label={tr('home.sort_tasks', 'Sort tasks')}
                className="ms-auto w-auto"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="due">{tr('home.sort_due', 'Due first')}</SelectItem>
                <SelectItem value="title">{tr('home.sort_title', 'Title, A–Z')}</SelectItem>
              </SelectContent>
            </Select>
          </>
        )
      }
      insight={
        shown.length === 0 ? undefined : (
          <Progress
            label={tr('home.tasks_by_when', 'Tasks by when they are due')}
            max={shown.length}
            showValue
            valueLabel={tr('home.tasks_waiting', '{{count}} waiting', {
              count: String(shown.length),
            })}
            segments={[
              {
                value: overdue,
                label: tr('home.overdue_count', '{{count}} overdue', { count: String(overdue) }),
                tone: 'chart-5',
              },
              {
                value: dueToday,
                label: tr('home.today_count', '{{count}} today', { count: String(dueToday) }),
                tone: 'chart-4',
              },
              {
                value: later,
                label: tr('home.later_count', '{{count}} later', { count: String(later) }),
                tone: 'chart-1',
              },
            ]}
          />
        )
      }
      span={2}
      flush={shown.length > 0}
    >
      {shown.length === 0 ? (
        <EmptyState
          icon={<icons.success aria-hidden />}
          title={
            data.tasks.length === 0
              ? tr('home.nothing_waiting_for_you', 'Nothing waiting for you')
              : tr('home.none_of_these', 'None of these')
          }
          description={tr(
            'home.approvals_scorecards_and_todays_interviews_land',
            'Approvals, scorecards and today’s interviews land here.',
          )}
        />
      ) : (
        <List aria-label={tr('home.tasks', 'Tasks')}>
          {shown.slice(0, WIDGET_LIMIT).map((t) => {
            const due = dueLabel(t);
            return (
              <ListItem
                key={`${t.kind}:${t.id}`}
                asChild
                chevron
                icon={TASK_ICON[t.kind] ?? <icons.pending aria-hidden />}
                iconTone={TASK_TONE[t.kind] ?? 'chart-6'}
                description={[TASK_KIND[t.kind]?.(), t.detail].filter(Boolean).join(' · ')}
                {...(due === undefined ? {} : { meta: due })}
                trailing={
                  t.due !== null && t.due < now ? (
                    <Badge size="sm" tone="danger">
                      {tr('home.late', 'Late')}
                    </Badge>
                  ) : undefined
                }
              >
                <To href={link(t)} onNavigate={props.onNavigate}>
                  {t.title}
                </To>
              </ListItem>
            );
          })}
        </List>
      )}
    </Widget>
  );
}

function Jobs5({
  data,
  props,
}: {
  readonly data: HomeData;
  readonly props: ScreenProps<HomeData>;
}): JSX.Element {
  const filter = pick(Object.keys(JOB_FILTERS) as JobFilter[], props.search?.['jobs'], 'open');
  const order = pick(JOB_ORDER, props.search?.['sort'], 'newest');
  const departments = [
    ...new Set(data.jobs.flatMap((j) => (j.department === null ? [] : [j.department]))),
  ].toSorted();
  const department = departments.find((d) => d === props.search?.['department']) ?? null;
  const shown = data.jobs
    .filter((j) => JOB_FILTERS[filter](j) && (department === null || j.department === department))
    .toSorted(JOB_SORT[order]);
  const active = shown.reduce((n, j) => n + j.counts.active, 0);
  const fresh = shown.reduce((n, j) => n + j.counts.newThisWeek, 0);
  const phase = (p: 'screening' | 'interviewing' | 'offer'): number =>
    shown.reduce(
      (n, j) =>
        n +
        j.counts.byStage.filter((s) => PHASE[s.category] === p).reduce((m, s) => m + s.count, 0),
      0,
    );
  const empty = data.jobs.length === 0;
  const newJob = data.requisitionsOn
    ? '/recruiting/requisitions/new'
    : '/recruiting/jobs/new/setup';
  return (
    <Widget
      title={tr('home.jobs', 'Jobs')}
      description={tr('home.jobs_youre_on', 'The jobs you are on, newest first')}
      icon={<icons.work aria-hidden />}
      tone="chart-2"
      {...(shown.length === 0 ? {} : { meta: shown.length })}
      action={
        <SeeAll
          count={shown.length}
          href={`/recruiting/jobs${filter === 'open' ? '' : `?show=${filter}`}`}
          props={props}
        />
      }
      toolbar={
        empty ? undefined : (
          <>
            <SegmentedControl
              size="sm"
              aria-label={tr('home.show_jobs', 'Show jobs')}
              value={filter}
              onValueChange={(v) => {
                if (v !== '') props.onFilter?.({ jobs: v === 'open' ? null : v });
              }}
            >
              {(Object.keys(JOB_FILTERS) as JobFilter[]).map((f) => (
                <SegmentedControlItem key={f} value={f}>
                  {JOB_FILTER_LABEL[f]()}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
            {departments.length < 2 ? null : (
              <Select
                value={department ?? 'all'}
                onValueChange={(v) => props.onFilter?.({ department: v === 'all' ? null : v })}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={tr('home.department', 'Department')}
                  className="w-auto"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {tr('home.all_departments', 'All departments')}
                  </SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={order}
              onValueChange={(v) => props.onFilter?.({ sort: v === 'newest' ? null : v })}
            >
              <SelectTrigger
                size="sm"
                aria-label={tr('home.sort_jobs', 'Sort jobs')}
                className="ms-auto w-auto"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JOB_ORDER.map((o) => (
                  <SelectItem key={o} value={o}>
                    {JOB_ORDER_LABEL[o]()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )
      }
      insight={
        shown.length === 0 ? undefined : active === 0 ? (
          <p className="text-fg-muted">
            {tr('home.no_active_candidates', 'No active candidates in these jobs yet.')}
          </p>
        ) : (
          <Progress
            label={tr('home.candidates_by_step', 'Candidates by step')}
            max={active}
            showValue
            valueLabel={tr(
              'home.active_and_new_week',
              '{{active}} active · {{fresh}} new this week',
              {
                active: String(active),
                fresh: String(fresh),
              },
            )}
            segments={[
              {
                value: phase('screening'),
                label: tr('home.screening_count', '{{count}} screening', {
                  count: String(phase('screening')),
                }),
                tone: 'chart-1',
              },
              {
                value: phase('interviewing'),
                label: tr('home.interviewing_count', '{{count}} interviewing', {
                  count: String(phase('interviewing')),
                }),
                tone: 'chart-2',
              },
              {
                value: phase('offer'),
                label: tr('home.offer_count', '{{count}} at offer', {
                  count: String(phase('offer')),
                }),
                tone: 'chart-3',
              },
            ]}
          />
        )
      }
      span={2}
      flush={shown.length > 0}
    >
      {empty ? (
        <EmptyState
          icon={<icons.work aria-hidden />}
          title={tr('home.no_jobs_yet', 'No jobs yet')}
          description={
            data.requisitionsOn
              ? tr('home.a_job_opens_from_an_approved', 'A job opens from an approved requisition.')
              : tr('home.open_a_job_to_start_hiring', 'Open a job to start hiring.')
          }
          action={
            <Button onClick={() => props.onNavigate?.(newJob)}>
              {data.requisitionsOn
                ? tr('home.new_requisition', 'New requisition')
                : tr('home.new_job', 'New job')}
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<icons.filter aria-hidden />}
          title={tr('home.no_jobs_here', 'No jobs here')}
          description={tr('home.try_another_filter', 'Try another state or department.')}
        />
      ) : (
        <List aria-label={tr('home.jobs', 'Jobs')}>
          {shown.slice(0, WIDGET_LIMIT).map((j) => (
            <ListItem
              key={j.id}
              asChild
              chevron
              leading={
                <Avatar
                  size="md"
                  shape="rounded"
                  name={j.hiringManager?.name ?? j.title}
                  fallback={<icons.work aria-hidden />}
                  {...(j.hiringManager?.name == null ? { tone: 'neutral' as const } : {})}
                />
              }
              description={[j.department, j.location, j.hiringManager?.name ?? null]
                .filter(Boolean)
                .join(' · ')}
              supporting={[
                tr('home.candidates_count', '{{count}} active', {
                  count: String(j.counts.active),
                }),
                j.counts.newThisWeek > 0
                  ? tr('home.new_count', '{{count}} new this week', {
                      count: String(j.counts.newThisWeek),
                    })
                  : null,
                j.openings > 0
                  ? tr('home.hired_of', '{{hired}} of {{openings}} hired', {
                      hired: String(j.hired),
                      openings: String(j.openings),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              {...(since(j) === ''
                ? {}
                : {
                    meta:
                      j.openedAt == null
                        ? tr('home.drafted_on', 'Drafted {{day}}', { day: day(since(j)) })
                        : tr('home.opened_on', 'Opened {{day}}', { day: day(since(j)) }),
                  })}
              trailing={
                <span className="flex items-center gap-3">
                  <MiniPipeline counts={j.counts} />
                  {j.state === 'open' ? null : <StateBadge state={j.state} />}
                </span>
              }
            >
              <To href={`/recruiting/jobs/${j.id}`} onNavigate={props.onNavigate}>
                {j.title}
              </To>
            </ListItem>
          ))}
        </List>
      )}
    </Widget>
  );
}

export function Home(props: ScreenProps<HomeData>): JSX.Element {
  return (
    <Loaded load={props.load} what={tr('home.recruiting', 'Recruiting')}>
      {(data) => {
        const now = new Date().toISOString();
        const open = data.jobs.filter(JOB_FILTERS.open);
        const openings = open.reduce((n, j) => n + j.openings, 0);
        const hired = open.reduce((n, j) => n + j.hired, 0);
        const candidates = data.jobs.reduce((n, j) => n + j.counts.active, 0);
        const fresh = data.jobs.reduce((n, j) => n + j.counts.newThisWeek, 0);
        const interviews = data.tasks
          .filter((t) => t.kind === 'interview' && t.due !== null)
          .toSorted((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
        const next = interviews.find((t) => (t.due ?? '') >= now);
        const scorecards = data.tasks.filter((t) => t.kind === 'scorecard');
        const late = scorecards.filter((t) => t.due !== null && t.due < now).length;
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={
                data.viewer.name === null
                  ? tr('home.recruiting', 'Recruiting')
                  : tr('home.hello', 'Hello, {{value}}', {
                      value: data.viewer.name.split(' ')[0] ?? '',
                    })
              }
              actions={
                <>
                  <Button
                    variant="primary"
                    startIcon={<icons.add aria-hidden />}
                    onClick={() => {
                      props.onNavigate?.(
                        data.requisitionsOn
                          ? '/recruiting/requisitions/new'
                          : '/recruiting/jobs/new/setup',
                      );
                    }}
                  >
                    {data.requisitionsOn
                      ? tr('home.new_requisition', 'New requisition')
                      : tr('home.new_job', 'New job')}
                  </Button>
                  <MoreMenu
                    label={tr('home.more', 'More')}
                    items={[
                      {
                        id: 'job',
                        label: tr('home.new_job', 'New job'),
                        icon: <icons.add aria-hidden />,
                        hidden: !data.requisitionsOn || !data.viewer.admin,
                        onSelect: () => props.onNavigate?.('/recruiting/jobs/new/setup'),
                      },
                    ]}
                  />
                </>
              }
            />
            {/* The figures: tiles of one size, never stretched to the row. */}
            <WidgetGrid size="sm">
              <Stat
                label={tr('home.open_jobs', 'Open jobs')}
                href="/recruiting/jobs"
                icon={<icons.work aria-hidden />}
                value={String(open.length)}
                description={tr(
                  'home.openings_hired',
                  '{{hired}} of {{openings}} openings filled',
                  {
                    hired: String(hired),
                    openings: String(openings),
                  },
                )}
              >
                {openings === 0 ? null : (
                  <Progress
                    size="sm"
                    label={tr('home.openings_filled', 'Openings filled')}
                    value={hired}
                    max={openings}
                  />
                )}
              </Stat>
              <Stat
                label={tr('home.active_candidates', 'Active candidates')}
                href="/recruiting/candidates"
                icon={<icons.people aria-hidden />}
                value={String(candidates)}
                delta={`+${String(fresh)}`}
                deltaLabel={tr('home.this_week', 'this week')}
                direction={fresh > 0 ? 'up' : 'flat'}
                sentiment={fresh > 0 ? 'positive' : 'neutral'}
              />
              <Stat
                label={tr('home.interviews_today', 'Interviews today')}
                href="/recruiting/interviews"
                icon={<icons.meeting aria-hidden />}
                value={String(interviews.length)}
                description={
                  next === undefined
                    ? interviews.length === 0
                      ? tr('home.none_booked_today', 'None booked today')
                      : tr('home.all_done_today', 'All done for today')
                    : tr('home.next_at', 'Next: {{when}}', { when: when(next.due ?? '') })
                }
              />
              <Stat
                label={tr('home.scorecards_owed', 'Scorecards owed')}
                href="/recruiting/interviews"
                icon={<icons.assessment aria-hidden />}
                value={String(scorecards.length)}
                description={
                  scorecards.length === 0
                    ? tr('home.all_submitted', 'All submitted')
                    : tr('home.late_count', '{{count}} late', { count: String(late) })
                }
              />
            </WidgetGrid>
            <WidgetGrid>
              <Tasks data={data} props={props} />
              <Jobs5 data={data} props={props} />
            </WidgetGrid>
          </div>
        );
      }}
    </Loaded>
  );
}

/** Which jobs the list shows: the state tab, in the address. */
const SHOWING = ['open', 'drafts', 'closed', 'archived', 'all'] as const;
type Showing = (typeof SHOWING)[number];
type JobsRow = JobsData['jobs'][number];

const shows = (j: JobsRow, showing: Showing): boolean =>
  showing === 'all'
    ? true
    : showing === 'archived'
      ? j.archivedAt !== null
      : j.archivedAt === null &&
        (showing === 'open'
          ? j.state === 'open' || j.state === 'on_hold'
          : showing === 'drafts'
            ? j.state === 'draft'
            : j.state === 'closed' || j.state === 'filled');

/**
 * The jobs list: every job the viewer is on, by state, searchable, each with
 * its pipeline at a glance and where it is live. A row opens its board; its
 * menu edits, archives or (nobody having applied) deletes it.
 */
export function Jobs(props: ScreenProps<JobsData>): JSX.Element {
  const act = useAct(props);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const showing: Showing = SHOWING.find((s) => s === props.search?.['show']) ?? 'open';
  const q = (props.search?.['q'] ?? '').trim().toLowerCase();
  const { onNavigate } = props;
  const columns = useMemo(() => jobsColumns(onNavigate), [onNavigate]);
  return (
    <Loaded load={props.load} what={tr('home.jobs_lower', 'jobs')}>
      {(data) => {
        const counted = (s: Showing): number => data.jobs.filter((j) => shows(j, s)).length;
        const rows = data.jobs.filter(
          (j) =>
            shows(j, showing) &&
            (q === '' ||
              [j.title, j.department ?? '', j.location ?? '', j.hiringManager?.name ?? '']
                .join(' ')
                .toLowerCase()
                .includes(q)),
        );
        const newRequisition = data.requisitionsOn && !data.admin;
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={tr('home.jobs', 'Jobs')}
              actions={
                <Button
                  variant="primary"
                  startIcon={<icons.add aria-hidden />}
                  onClick={() => {
                    props.onNavigate?.(
                      newRequisition
                        ? '/recruiting/requisitions/new'
                        : '/recruiting/jobs/new/setup',
                    );
                  }}
                >
                  {newRequisition
                    ? tr('home.new_requisition', 'New requisition')
                    : tr('home.new_job', 'New job')}
                </Button>
              }
            />
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                aria-label={tr('home.show', 'Show')}
                value={showing}
                onValueChange={(v) => props.onFilter?.({ show: v === 'open' ? null : v })}
              >
                {SHOWING.map((s) => (
                  <SegmentedControlItem key={s} value={s}>
                    {tr('home.showing', '{{label}} {{count}}', {
                      label: SHOWING_LABEL[s](),
                      count: String(counted(s)),
                    })}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
              <Search
                label={tr('home.search_jobs', 'Search jobs')}
                placeholder={tr(
                  'home.title_team_place_or_manager',
                  'Title, team, place or manager',
                )}
                initial={props.search?.['q'] ?? ''}
                onSearch={(v) => props.onFilter?.({ q: v === '' ? null : v })}
                className="w-72 max-w-full"
              />
            </div>
            <Refusal error={act.error} />
            <Card>
              <DataTable<JobsRow>
                label={tr('home.jobs', 'Jobs')}
                rows={rows}
                rowId={(j) => j.id}
                describeRow={(j) => j.title}
                fill
                columns={columns}
                onRowClick={(j) => props.onNavigate?.(`/recruiting/jobs/${j.id}`)}
                rowActions={(j) =>
                  jobCommands(refOf(j), { onNavigate, onConfirm: setConfirming, act })
                    .filter((c) => c.hidden !== true)
                    .map((c) => ({
                      id: c.id,
                      label: c.label,
                      ...(c.icon === undefined ? {} : { icon: c.icon }),
                      ...(c.destructive === undefined ? {} : { destructive: c.destructive }),
                      onSelect: c.onSelect,
                    }))
                }
                empty={
                  <EmptyState
                    icon={<icons.work aria-hidden />}
                    title={
                      q === ''
                        ? EMPTY_TITLE[showing]()
                        : tr('home.no_job_matches', 'No job matches “{{q}}”', { q })
                    }
                  />
                }
              />
            </Card>
            <JobConfirm
              confirming={confirming}
              onClose={() => {
                setConfirming(null);
              }}
              act={act}
            />
          </div>
        );
      }}
    </Loaded>
  );
}

const refOf = (j: JobsRow): JobRef => ({
  id: j.id,
  title: j.title,
  active: j.counts.active,
  archived: j.archivedAt !== null,
  may: j.may,
});

const SHOWING_LABEL: Readonly<Record<Showing, () => string>> = {
  open: () => tr('home.open_tab', 'Open'),
  drafts: () => tr('home.drafts', 'Drafts'),
  closed: () => tr('home.closed', 'Closed'),
  archived: () => tr('home.archived', 'Archived'),
  all: () => tr('home.all', 'All'),
};

const EMPTY_TITLE: Readonly<Record<Showing, () => string>> = {
  open: () => tr('home.no_open_jobs', 'No open jobs'),
  drafts: () => tr('home.no_drafts', 'No drafts'),
  closed: () => tr('home.no_closed_jobs', 'No closed jobs'),
  archived: () => tr('home.nothing_archived', 'Nothing archived'),
  all: () => tr('home.no_jobs_yet', 'No jobs yet'),
};

/** The jobs list's columns: the job, its pipeline, where it is live, who manages it, its state. */
function jobsColumns(
  onNavigate: ScreenProps<JobsData>['onNavigate'],
): readonly DataColumn<JobsRow>[] {
  return [
    {
      id: 'job',
      header: tr('home.job', 'Job'),
      sortBy: (j) => j.title,
      cell: (j) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <To
            href={`/recruiting/jobs/${j.id}`}
            onNavigate={onNavigate}
            className="font-semibold text-fg hover:underline [overflow-wrap:anywhere]"
          >
            {j.title}
          </To>
          <span className="text-sm text-fg-muted">
            {[j.department, j.location].filter(Boolean).join(' · ') ||
              tr('home.no_team_or_place_yet', 'No team or place yet')}
          </span>
        </span>
      ),
    },
    {
      id: 'pipeline',
      header: tr('home.candidates_header', 'Candidates'),
      sortBy: (j) => j.counts.active,
      cell: (j) => (
        <span className="flex items-center gap-3">
          <MiniPipeline counts={j.counts} />
          <span className="text-sm text-fg-muted tabular-nums">
            {tr('home.active_and_new', '{{active}} active · {{fresh}} new', {
              active: String(j.counts.active),
              fresh: String(j.counts.newThisWeek),
            })}
          </span>
        </span>
      ),
    },
    {
      id: 'live',
      header: tr('home.live_on', 'Live on'),
      hideOnCard: true,
      cell: (j) =>
        j.live.length === 0 ? (
          <span className="text-sm text-fg-muted">{tr('home.not_published', 'Not published')}</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {j.live.map((target) => (
              <Badge key={target} size="sm" variant="soft" tone="success">
                {whereFrom(target)}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      id: 'manager',
      header: tr('home.hiring_manager', 'Hiring manager'),
      hideOnCard: true,
      sortBy: (j) => j.hiringManager?.name ?? '',
      cell: (j) =>
        j.hiringManager === null ? (
          <span className="text-sm text-fg-muted">—</span>
        ) : (
          <span className="flex items-center gap-2">
            <Avatar name={j.hiringManager.name ?? ''} size="sm" />
            <span className="text-sm">{j.hiringManager.name}</span>
          </span>
        ),
    },
    {
      id: 'state',
      header: tr('home.state', 'State'),
      cardTrailing: true,
      sortBy: (j) => j.state,
      cell: (j) =>
        j.archivedAt === null ? (
          <StateBadge state={j.state} />
        ) : (
          <Badge size="sm" tone="neutral">
            {tr('home.archived', 'Archived')}
          </Badge>
        ),
    },
  ];
}
