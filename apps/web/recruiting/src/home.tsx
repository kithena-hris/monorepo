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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  icons,
} from '@reach/ui';
import type { JSX } from 'react';

import { Loaded } from './load';
import { StateBadge, To, day } from './shared';
import type { HomeData, ScreenProps } from './types';

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
      aria-label={counts.byStage.map((s) => `${s.name} ${String(s.count)}`).join(', ')}
    >
      {counts.byStage.map((s, i) => (
        <span
          key={s.stageId}
          title={`${s.name}: ${String(s.count)}`}
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
        <CardTitle level={2}>My tasks</CardTitle>
        <CardDescription>From the Inbox, for Recruiting</CardDescription>
      </CardHeader>
      <CardContent>
        {data.tasks.length === 0 ? (
          <EmptyState
            icon={<icons.success aria-hidden />}
            title="Nothing waiting for you"
            description="Approvals, scorecards and today’s interviews land here."
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
  if (data.jobs.length === 0) {
    return (
      <EmptyState
        icon={<icons.work aria-hidden />}
        title="No jobs yet"
        description={
          data.requisitionsOn
            ? 'A job opens from an approved requisition.'
            : 'Open a job to start hiring.'
        }
        action={
          <Button
            onClick={() => {
              props.onNavigate?.(
                data.requisitionsOn ? '/recruiting/requisitions/new' : '/recruiting/jobs/new/setup',
              );
            }}
          >
            {data.requisitionsOn ? 'New requisition' : 'New job'}
          </Button>
        }
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Job</TableHead>
          <TableHead>Pipeline</TableHead>
          <TableHead>State</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.jobs.map((j) => (
          <TableRow key={j.id}>
            <TableCell>
              <span className="flex flex-col">
                <To href={`/recruiting/jobs/${j.id}`} onNavigate={props.onNavigate}>
                  {j.title}
                </To>
                <span className="text-sm text-fg-muted">
                  {[
                    j.department,
                    `${String(j.counts.active)} candidates`,
                    `${String(j.counts.newThisWeek)} new`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </TableCell>
            <TableCell>
              <MiniPipeline counts={j.counts} />
            </TableCell>
            <TableCell>
              <StateBadge state={j.state} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function Home(props: ScreenProps<HomeData>): JSX.Element {
  return (
    <Loaded load={props.load} what="Recruiting">
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
                  ? 'Recruiting'
                  : `Hello, ${data.viewer.name.split(' ')[0] ?? ''}`
              }
              description="Tasks first, then your jobs. Everything here also lands in the Inbox."
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
                      New requisition
                    </Button>
                  ) : null}
                  {!data.requisitionsOn || data.viewer.admin ? (
                    <Button
                      startIcon={<icons.add aria-hidden />}
                      onClick={() => {
                        props.onNavigate?.('/recruiting/jobs/new/setup');
                      }}
                    >
                      New job
                    </Button>
                  ) : null}
                </>
              }
            />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card padded>
                <Stat
                  label="Open jobs"
                  value={String(open.length)}
                  description={`${String(data.jobs.length)} in all`}
                />
              </Card>
              <Card padded>
                <Stat
                  label="Active candidates"
                  value={String(candidates)}
                  description={`${String(fresh)} new this week`}
                />
              </Card>
              <Card padded>
                <Stat label="Interviews today" value={String(interviews)} />
              </Card>
              <Card padded>
                <Stat label="Scorecards owed" value={String(scorecards)} />
              </Card>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Tasks data={data} props={props} />
              <Card>
                <CardHeader>
                  <CardTitle level={2}>My jobs</CardTitle>
                  <CardDescription>{`${String(open.length)} open`}</CardDescription>
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
            title="Jobs"
            description="Every job you hire for. Published is each target’s state, not the job’s."
            actions={
              <Button
                startIcon={<icons.add aria-hidden />}
                onClick={() => {
                  props.onNavigate?.('/recruiting/jobs/new/setup');
                }}
              >
                New job
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
