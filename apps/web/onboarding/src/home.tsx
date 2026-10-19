import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Progress,
  Stat,
  DataTable,
  type DataColumn,
  icons,
} from '@reach/ui';
import type { JSX } from 'react';

import { Loaded } from './load';
import { StateBadge, To, day, words } from './shared';
import type { BoardData, ScreenProps, TasksData } from './types';

/**
 * O1 and O6: who is arriving and how far along each plan is; O4: the tasks
 * that are mine. Every plan is drawn from Onboarding's answer; nothing is
 * counted here that Onboarding did not count.
 */

const thisMonth = (iso: string) => iso.slice(0, 7) === new Date().toISOString().slice(0, 7);

export function Home(props: ScreenProps<BoardData>): JSX.Element {
  return (
    <Loaded load={props.load} what="onboarding">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Onboarding"
            description="From a signed contract to the end of probation. Hires arrive from Recruiting, People, or another system."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Plans in flight" value={String(data.rows.length)} />
            <Stat
              label="Starting this month"
              value={String(data.rows.filter((r) => thisMonth(r.startDate)).length)}
            />
            <Stat label="Tasks late" value={String(data.rows.reduce((n, r) => n + r.late, 0))} />
            <Stat label="On track" value={String(data.rows.filter((r) => r.late === 0).length)} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle level={2}>Arriving</CardTitle>
            </CardHeader>
            <CardContent>
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.hire aria-hidden />}
                  title="Nobody is arriving"
                  description="A plan starts when a hire arrives from Recruiting, People or another system."
                />
              ) : (
                <DataTable<PlanRow>
                  label="Arriving"
                  rows={data.rows}
                  rowId={planId}
                  describeRow={planName}
                  fill
                  columns={planColumns(props.onNavigate)}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Loaded>
  );
}

type PlanRow = BoardData['rows'][number];
const planId = (r: PlanRow): string => r.id;
const planName = (r: PlanRow): string => r.name;

/** O1's board: who is arriving, when, and how their plan is going. Virtualised: a company of thousands hires in waves. */
function planColumns(
  onNavigate: ScreenProps<BoardData>['onNavigate'],
): readonly DataColumn<PlanRow>[] {
  return [
    {
      id: 'person',
      header: 'Person',
      sortBy: (r) => r.name,
      cell: (r) => (
        <>
          <To href={`/onboarding/plans/${r.id}`} onNavigate={onNavigate}>
            {r.name}
          </To>
          <span className="block text-sm text-fg-muted">
            {[r.department, r.manager === null ? null : `with ${r.manager}`]
              .filter(Boolean)
              .join(' · ') || r.country}
          </span>
        </>
      ),
    },
    { id: 'starts', header: 'Starts', sortBy: (r) => r.startDate, cell: (r) => day(r.startDate) },
    {
      id: 'progress',
      header: 'Progress',
      width: '11rem',
      sortBy: (r) => (r.total === 0 ? 0 : r.done / r.total),
      cell: (r) => (
        <Progress
          value={r.total === 0 ? 0 : Math.round((r.done / r.total) * 100)}
          label={`${String(r.done)} of ${String(r.total)} tasks`}
        />
      ),
    },
    {
      id: 'late',
      header: 'Late',
      numeric: true,
      sortBy: (r) => r.late,
      cell: (r) =>
        r.late === 0 ? '—' : <Badge size="sm" tone="danger">{`${String(r.late)} late`}</Badge>,
    },
    {
      id: 'state',
      header: 'State',
      cardTrailing: true,
      sortBy: (r) => r.state,
      cell: (r) => <StateBadge state={r.state} />,
    },
  ];
}

type TaskRow = TasksData['rows'][number];
const taskId = (r: TaskRow): string => r.taskId;
const taskTitle = (r: TaskRow): string => r.title;

function taskColumns(
  onNavigate: ScreenProps<TasksData>['onNavigate'],
): readonly DataColumn<TaskRow>[] {
  return [
    {
      id: 'task',
      header: 'Task',
      sortBy: (r) => r.title,
      cell: (r) => (
        <To href={`/onboarding/plans/${r.planId}`} onNavigate={onNavigate}>
          {r.title}
        </To>
      ),
    },
    { id: 'for', header: 'For', sortBy: (r) => r.name, cell: (r) => r.name },
    {
      id: 'as',
      header: 'As',
      hideOnCard: true,
      sortBy: (r) => r.ownerRole,
      cell: (r) => (
        <span className="text-sm text-fg-muted">
          {r.ownerRole === 'it' ? 'IT' : r.ownerRole === 'hr' ? 'HR' : words(r.ownerRole)}
        </span>
      ),
    },
    {
      id: 'due',
      header: 'Due',
      cardTrailing: true,
      sortBy: (r) => r.dueOn,
      cell: (r) =>
        r.late ? <Badge size="sm" tone="danger">{`Late · ${day(r.dueOn)}`}</Badge> : day(r.dueOn),
    },
  ];
}

/** O4: every open task that is mine, across plans, by date. */
export function Tasks(props: ScreenProps<TasksData>): JSX.Element {
  return (
    <Loaded load={props.load} what="your onboarding tasks">
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="My onboarding tasks"
            description="As a manager, a buddy, IT or HR. They are in your Inbox too."
          />
          <Card>
            <CardContent>
              {data.rows.length === 0 ? (
                <EmptyState icon={<icons.success aria-hidden />} title="Nothing to do" />
              ) : (
                <DataTable<TaskRow>
                  label="My onboarding tasks"
                  rows={data.rows}
                  rowId={taskId}
                  describeRow={taskTitle}
                  fill
                  columns={taskColumns(props.onNavigate)}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Loaded>
  );
}
