import {
  Avatar,
  SegmentedControl,
  SegmentedControlItem,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Stat,
  DataTable,
  type DataColumn,
  icons,
  Card,
  List,
  ListItem,
  Widget,
  WidgetGrid,
} from '@reach/ui';
import { useMemo, useState, type JSX } from 'react';

import { Loaded } from './load';
import { JobConfirm, jobCommands, type Confirming, type JobRef } from './job-actions';
import { MoreMenu, Refusal, Search, StateBadge, To, day, useAct, whereFrom } from './shared';
import type { HomeData, JobsData, ScreenProps } from './types';
import { t as tr } from './i18n';

/**
 * R1, Recruiting home (design R1): tasks first, then the jobs the viewer is
 * on, each with its pipeline in miniature. Tasks are the same items the Inbox
 * shows; a job's bars are its candidates per stage.
 */

const TASK_ICON: Readonly<Record<string, JSX.Element>> = {
  approve_requisition: <icons.approve aria-hidden />,
  approve_offer: <icons.agreement aria-hidden />,
  scorecard: <icons.assessment aria-hidden />,
  interview: <icons.meeting aria-hidden />,
};

function MiniPipeline({
  counts,
}: {
  readonly counts: HomeData['jobs'][number]['counts'];
}): JSX.Element {
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
          className="w-2.5 rounded-sm bg-accent"
          style={{ height: `${String(Math.max(3, (s.count / max) * 24))}px`, opacity: 1 - i * 0.1 }}
        />
      ))}
    </span>
  );
}

function Tasks({
  data,
  props,
}: {
  readonly data: HomeData;
  readonly props: ScreenProps<HomeData>;
}): JSX.Element {
  const link = (t: HomeData['tasks'][number]): string =>
    t.kind === 'approve_requisition'
      ? `/recruiting/requisitions/${t.id}/approve`
      : t.kind === 'approve_offer'
        ? `/recruiting/offers/${t.id}/approve`
        : `/recruiting/interviews/${t.id}`;
  return (
    <Widget
      title={tr('home.tasks', 'Tasks')}
      description={tr('home.from_the_inbox_for_recruiting', 'From the Inbox, for Recruiting')}
      icon={<icons.inbox aria-hidden />}
      tone="accent"
      {...(data.tasks.length === 0 ? {} : { meta: data.tasks.length })}
      span={2}
      flush={data.tasks.length > 0}
    >
      {data.tasks.length === 0 ? (
        <EmptyState
          icon={<icons.success aria-hidden />}
          title={tr('home.nothing_waiting_for_you', 'Nothing waiting for you')}
          description={tr(
            'home.approvals_scorecards_and_todays_interviews_land',
            'Approvals, scorecards and today’s interviews land here.',
          )}
        />
      ) : (
        <List aria-label={tr('home.tasks', 'Tasks')}>
          {data.tasks.map((t) => (
            <ListItem
              key={`${t.kind}:${t.id}`}
              asChild
              chevron
              leading={
                <Avatar
                  shape="rounded"
                  size="md"
                  tone={
                    t.kind === 'scorecard'
                      ? 'accent'
                      : t.kind.startsWith('approve')
                        ? 'warning'
                        : 'neutral'
                  }
                  name={t.title}
                  fallback={TASK_ICON[t.kind] ?? <icons.pending aria-hidden />}
                />
              }
              trailing={
                t.due === null ? undefined : (
                  <Badge size="sm" tone="warning">
                    {day(t.due)}
                  </Badge>
                )
              }
            >
              <To href={link(t)} onNavigate={props.onNavigate}>
                {t.title}
              </To>
            </ListItem>
          ))}
        </List>
      )}
    </Widget>
  );
}

function JobsTable({
  data,
  props,
}: {
  readonly data: HomeData;
  readonly props: ScreenProps<HomeData>;
}): JSX.Element {
  const { onNavigate } = props;
  const columns = useMemo(() => jobColumns(onNavigate), [onNavigate]);
  if (data.jobs.length === 0) {
    return (
      <EmptyState
        icon={<icons.work aria-hidden />}
        title={tr('home.no_jobs_yet', 'No jobs yet')}
        description={
          data.requisitionsOn
            ? tr('home.a_job_opens_from_an_approved', 'A job opens from an approved requisition.')
            : tr('home.open_a_job_to_start_hiring', 'Open a job to start hiring.')
        }
        action={
          <Button
            onClick={() => {
              props.onNavigate?.(
                data.requisitionsOn ? '/recruiting/requisitions/new' : '/recruiting/jobs/new/setup',
              );
            }}
          >
            {data.requisitionsOn
              ? tr('home.new_requisition', 'New requisition')
              : tr('home.new_job', 'New job')}
          </Button>
        }
      />
    );
  }
  return (
    <DataTable<JobRow>
      label={tr('home.your_jobs', 'Your jobs')}
      rows={data.jobs}
      rowId={idOf}
      describeRow={titleOf}
      fill
      columns={columns}
    />
  );
}

type JobRow = HomeData['jobs'][number];
const idOf = (j: JobRow): string => j.id;
const titleOf = (j: JobRow): string => j.title;

/** R1's jobs: each with its pipeline in miniature. */
function jobColumns(
  onNavigate: ScreenProps<HomeData>['onNavigate'],
): readonly DataColumn<JobRow>[] {
  return [
    {
      id: 'job',
      header: tr('home.job', 'Job'),
      sortBy: (j) => j.title,
      cell: (j) => (
        <span className="flex flex-col">
          <To href={`/recruiting/jobs/${j.id}`} onNavigate={onNavigate}>
            {j.title}
          </To>
          <span className="text-sm text-fg-muted">
            {[
              j.department,
              tr('home.candidates', '{{active}} candidates', { active: String(j.counts.active) }),
              tr('home.new', '{{newThisWeek}} new', { newThisWeek: String(j.counts.newThisWeek) }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      ),
    },
    {
      id: 'pipeline',
      header: tr('home.pipeline', 'Pipeline'),
      hideOnCard: true,
      cell: (j) => <MiniPipeline counts={j.counts} />,
    },
    {
      id: 'state',
      header: tr('home.state', 'State'),
      cardTrailing: true,
      sortBy: (j) => j.state,
      cell: (j) => <StateBadge state={j.state} />,
    },
  ];
}

export function Home(props: ScreenProps<HomeData>): JSX.Element {
  return (
    <Loaded load={props.load} what={tr('home.recruiting', 'Recruiting')}>
      {(data) => {
        const open = data.jobs.filter((j) => j.state === 'open');
        const candidates = data.jobs.reduce((n, j) => n + j.counts.active, 0);
        const fresh = data.jobs.reduce((n, j) => n + j.counts.newThisWeek, 0);
        const interviews = data.tasks.filter((t) => t.kind === 'interview').length;
        const scorecards = data.tasks.filter((t) => t.kind === 'scorecard').length;
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
                icon={<icons.work aria-hidden />}
                value={String(open.length)}
                description={tr('home.in_all', '{{length}} in all', {
                  length: String(data.jobs.length),
                })}
              />
              <Stat
                label={tr('home.active_candidates', 'Active candidates')}
                icon={<icons.people aria-hidden />}
                value={String(candidates)}
                description={tr('home.new_this_week', '{{fresh}} new this week', {
                  fresh: String(fresh),
                })}
              />
              <Stat
                label={tr('home.interviews_today', 'Interviews today')}
                icon={<icons.meeting aria-hidden />}
                value={String(interviews)}
              />
              <Stat
                label={tr('home.scorecards_owed', 'Scorecards owed')}
                icon={<icons.assessment aria-hidden />}
                value={String(scorecards)}
              />
            </WidgetGrid>
            <WidgetGrid>
              <Tasks data={data} props={props} />
              <Widget
                title={tr('home.your_jobs', 'Your jobs')}
                description={tr('home.open', '{{length}} open', { length: String(open.length) })}
                icon={<icons.work aria-hidden />}
                tone="chart-2"
                span={4}
                flush={data.jobs.length > 0}
              >
                <JobsTable data={data} props={props} />
              </Widget>
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
