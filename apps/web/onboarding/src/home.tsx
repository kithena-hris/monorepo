import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Progress,
  Stat,
  DataTable,
  type DataColumn,
  icons,
  Widget,
  WidgetGrid,
} from '@reach/ui';
import type { JSX } from 'react';

import { Loaded } from './load';
import { StateBadge, To, day, words } from './shared';
import type { BoardData, ScreenProps, TasksData } from './types';
import { t } from './i18n';

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
            title={t('home.onboarding', 'Onboarding')}
            description={t(
              'home.from_a_signed_contract_to_the',
              'From a signed contract to the end of probation. Hires arrive from Recruiting, People, or another system.',
            )}
          />
          {/* The figures: tiles of one size, never stretched to the row. */}
          <WidgetGrid size="sm">
            <Stat
              label={t('home.plans_in_flight', 'Plans in flight')}
              href="/onboarding/analytics"
              icon={<icons.hire aria-hidden />}
              value={String(data.rows.length)}
            />
            <Stat
              label={t('home.starting_this_month', 'Starting this month')}
              value={String(data.rows.filter((r) => thisMonth(r.startDate)).length)}
            />
            <Stat
              label={t('home.tasks_late', 'Tasks late')}
              href="/onboarding/tasks"
              value={String(data.rows.reduce((n, r) => n + r.late, 0))}
            />
            <Stat
              label={t('home.on_track', 'On track')}
              href="/onboarding/analytics"
              value={String(data.rows.filter((r) => r.late === 0).length)}
            />
          </WidgetGrid>
          <WidgetGrid>
            <Widget
              title={t('home.arriving', 'Arriving')}
              icon={<icons.calendar aria-hidden />}
              tone="chart-1"
              {...(data.rows.length === 0 ? {} : { meta: data.rows.length })}
              action={
                <Button asChild size="sm" variant="ghost" endIcon={<icons.forward aria-hidden />}>
                  <a href="/onboarding/tasks">{t('home.all_tasks', 'All tasks')}</a>
                </Button>
              }
              span={4}
              flush={data.rows.length > 0}
            >
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.hire aria-hidden />}
                  title={t('home.nobody_is_arriving', 'Nobody is arriving')}
                  description={t(
                    'home.a_plan_starts_when_a_hire',
                    'A plan starts when a hire arrives from Recruiting, People or another system.',
                  )}
                />
              ) : (
                <DataTable<PlanRow>
                  label={t('home.arriving', 'Arriving')}
                  rows={data.rows}
                  rowId={planId}
                  describeRow={planName}
                  fill
                  columns={planColumns(props.onNavigate)}
                />
              )}
            </Widget>
          </WidgetGrid>
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
      header: t('home.person', 'Person'),
      sortBy: (r) => r.name,
      cell: (r) => (
        <>
          <To href={`/onboarding/plans/${r.id}`} onNavigate={onNavigate}>
            {r.name}
          </To>
          <span className="block text-sm text-fg-muted">
            {[
              r.department,
              r.manager === null
                ? null
                : t('home.with', 'with {{manager}}', { manager: r.manager }),
            ]
              .filter(Boolean)
              .join(' · ') || r.country}
          </span>
        </>
      ),
    },
    {
      id: 'starts',
      header: t('home.starts', 'Starts'),
      sortBy: (r) => r.startDate,
      cell: (r) => day(r.startDate),
    },
    {
      id: 'progress',
      header: t('home.progress', 'Progress'),
      width: '11rem',
      sortBy: (r) => (r.total === 0 ? 0 : r.done / r.total),
      cell: (r) => (
        <Progress
          value={r.total === 0 ? 0 : Math.round((r.done / r.total) * 100)}
          label={t('home.of_tasks', '{{done}} of {{total}} tasks', {
            done: String(r.done),
            total: String(r.total),
          })}
        />
      ),
    },
    {
      id: 'late',
      header: t('home.late', 'Late'),
      numeric: true,
      sortBy: (r) => r.late,
      cell: (r) =>
        r.late === 0 ? (
          '—'
        ) : (
          <Badge size="sm" tone="danger">
            {t('home.late_2', '{{late}} late', { late: String(r.late) })}
          </Badge>
        ),
    },
    {
      id: 'state',
      header: t('home.state', 'State'),
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
      header: t('home.task', 'Task'),
      sortBy: (r) => r.title,
      cell: (r) => (
        <To href={`/onboarding/plans/${r.planId}`} onNavigate={onNavigate}>
          {r.title}
        </To>
      ),
    },
    { id: 'for', header: t('home.for', 'For'), sortBy: (r) => r.name, cell: (r) => r.name },
    {
      id: 'as',
      header: t('home.as', 'As'),
      hideOnCard: true,
      sortBy: (r) => r.ownerRole,
      cell: (r) => (
        <span className="text-sm text-fg-muted">
          {r.ownerRole === 'it'
            ? t('home.it', 'IT')
            : r.ownerRole === 'hr'
              ? t('home.hr', 'HR')
              : words(r.ownerRole)}
        </span>
      ),
    },
    {
      id: 'due',
      header: t('home.due', 'Due'),
      cardTrailing: true,
      sortBy: (r) => r.dueOn,
      cell: (r) =>
        r.late ? (
          <Badge size="sm" tone="danger">
            {t('home.late_3', 'Late · {{dueOn}}', { dueOn: day(r.dueOn) })}
          </Badge>
        ) : (
          day(r.dueOn)
        ),
    },
  ];
}

/** O4: every open task that is mine, across plans, by date. */
export function Tasks(props: ScreenProps<TasksData>): JSX.Element {
  return (
    <Loaded load={props.load} what={t('home.your_onboarding_tasks', 'your onboarding tasks')}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <PageHeader
            title={t('home.onboarding_tasks', 'Onboarding tasks')}
            description={t(
              'home.as_a_manager_a_buddy_it',
              'As a manager, a buddy, IT or HR. They are in your Inbox too.',
            )}
          />
          <Card>
            <CardContent>
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={<icons.success aria-hidden />}
                  title={t('home.nothing_to_do', 'Nothing to do')}
                />
              ) : (
                <DataTable<TaskRow>
                  label={t('home.onboarding_tasks', 'Onboarding tasks')}
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
