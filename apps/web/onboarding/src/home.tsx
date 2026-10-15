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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>Starts</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Late</TableHead>
                      <TableHead>State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <To href={`/onboarding/plans/${r.id}`} onNavigate={props.onNavigate}>
                            {r.name}
                          </To>
                          <span className="block text-sm text-fg-muted">
                            {[r.department, r.manager === null ? null : `with ${r.manager}`]
                              .filter(Boolean)
                              .join(' · ') || r.country}
                          </span>
                        </TableCell>
                        <TableCell>{day(r.startDate)}</TableCell>
                        <TableCell className="min-w-40">
                          <Progress
                            value={r.total === 0 ? 0 : Math.round((r.done / r.total) * 100)}
                            label={`${String(r.done)} of ${String(r.total)} tasks`}
                          />
                        </TableCell>
                        <TableCell>
                          {r.late === 0 ? (
                            '—'
                          ) : (
                            <Badge size="sm" tone="danger">{`${String(r.late)} late`}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <StateBadge state={r.state} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Loaded>
  );
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>For</TableHead>
                      <TableHead>As</TableHead>
                      <TableHead>Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.taskId}>
                        <TableCell>
                          <To href={`/onboarding/plans/${r.planId}`} onNavigate={props.onNavigate}>
                            {r.title}
                          </To>
                        </TableCell>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="text-sm text-fg-muted">
                          {r.ownerRole === 'it'
                            ? 'IT'
                            : r.ownerRole === 'hr'
                              ? 'HR'
                              : words(r.ownerRole)}
                        </TableCell>
                        <TableCell>
                          {r.late ? (
                            <Badge size="sm" tone="danger">{`Late · ${day(r.dueOn)}`}</Badge>
                          ) : (
                            day(r.dueOn)
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Loaded>
  );
}
