import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Stat,
  DataTable,
  type DataColumn,
  icons,
} from '@reach/ui';
import { useMemo, type JSX } from 'react';

import { Loaded } from './load';
import { StateBadge, To, day } from './shared';
import type { HomeData, ScreenProps } from './types';
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
          className="w-3 rounded-sm bg-[var(--reach-chart-1)]"
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
    <Card>
      <CardHeader>
        <CardTitle level={2}>{tr('home.my_tasks', 'My tasks')}</CardTitle>
        <CardDescription>
          {tr('home.from_the_inbox_for_recruiting', 'From the Inbox, for Recruiting')}
        </CardDescription>
      </CardHeader>
      <CardContent>
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
          <ul className="flex flex-col divide-y divide-[var(--reach-line)]">
            {data.tasks.map((t) => (
              <li key={`${t.kind}:${t.id}`} className="flex items-center gap-3 py-3">
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
                <span className="min-w-0 flex-1">
                  <To href={link(t)} onNavigate={props.onNavigate}>
                    {t.title}
                  </To>
                </span>
                {t.due === null ? null : (
                  <Badge size="sm" tone="warning">
                    {day(t.due)}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
      label={tr('home.my_jobs', 'My jobs')}
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
              description={tr(
                'home.tasks_first_then_your_jobs_everything',
                'Tasks first, then your jobs. Everything here also lands in the Inbox.',
              )}
              actions={
                <>
                  {data.requisitionsOn ? (
                    <Button
                      variant="secondary"
                      startIcon={<icons.add aria-hidden />}
                      onClick={() => {
                        props.onNavigate?.('/recruiting/requisitions/new');
                      }}
                    >
                      {tr('home.new_requisition', 'New requisition')}
                    </Button>
                  ) : null}
                  {!data.requisitionsOn || data.viewer.admin ? (
                    <Button
                      startIcon={<icons.add aria-hidden />}
                      onClick={() => {
                        props.onNavigate?.('/recruiting/jobs/new/setup');
                      }}
                    >
                      {tr('home.new_job', 'New job')}
                    </Button>
                  ) : null}
                </>
              }
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card padded>
                <Stat
                  label={tr('home.open_jobs', 'Open jobs')}
                  value={String(open.length)}
                  description={tr('home.in_all', '{{length}} in all', {
                    length: String(data.jobs.length),
                  })}
                />
              </Card>
              <Card padded>
                <Stat
                  label={tr('home.active_candidates', 'Active candidates')}
                  value={String(candidates)}
                  description={tr('home.new_this_week', '{{fresh}} new this week', {
                    fresh: String(fresh),
                  })}
                />
              </Card>
              <Card padded>
                <Stat
                  label={tr('home.interviews_today', 'Interviews today')}
                  value={String(interviews)}
                />
              </Card>
              <Card padded>
                <Stat
                  label={tr('home.scorecards_owed', 'Scorecards owed')}
                  value={String(scorecards)}
                />
              </Card>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Tasks data={data} props={props} />
              <Card>
                <CardHeader>
                  <CardTitle level={2}>{tr('home.my_jobs', 'My jobs')}</CardTitle>
                  <CardDescription>
                    {tr('home.open', '{{length}} open', { length: String(open.length) })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <JobsTable data={data} props={props} />
                </CardContent>
              </Card>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}

/** The jobs list: every job the viewer is on, with its state and pipeline. */
export function Jobs(props: ScreenProps<HomeData>): JSX.Element {
  return (
    <Loaded load={props.load} what="jobs">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={tr('home.jobs', 'Jobs')}
            description={tr(
              'home.every_job_you_hire_for_published',
              'Every job you hire for. Published is each target’s state, not the job’s.',
            )}
            actions={
              <Button
                startIcon={<icons.add aria-hidden />}
                onClick={() => {
                  props.onNavigate?.('/recruiting/jobs/new/setup');
                }}
              >
                {tr('home.new_job', 'New job')}
              </Button>
            }
          />
          <Card>
            <CardContent>
              <JobsTable data={data} props={props} />
            </CardContent>
          </Card>
        </div>
      )}
    </Loaded>
  );
}
