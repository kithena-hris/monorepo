import {
  Alert,
  Badge,
  Button,
  KeyValues,
  PageHeader,
  PageSection,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { amount } from '../words';
import { MonthNav } from './month-nav';
import { duration, monthName, shortDate } from './time';

/**
 * Closing the month for Payroll (T24, PRD §11.8): one step at month end. Per
 * team, its people, whether their timesheets are ready or waiting, the
 * overtime and how it is paid; in total, overtime paid, comp time banked,
 * unpaid leave and negative balances. Whoever is late is flagged with a
 * reminder; "Send September to Payroll" locks the month and hands Payroll
 * hours and amounts, never punch times or locations.
 *
 * The month is the address (`?month=`, last month by default). Two columns at
 * a desk; under 60rem of its own width the teams, then the send.
 */

export interface PayPeriodData {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly from: string;
  readonly to: string;
  readonly today: string;
  readonly closedAt: string | null;
  readonly teams: readonly {
    readonly team: string;
    readonly teamName: string | null;
    readonly people: number;
    readonly waiting: number;
    readonly paidMinutes: number;
    readonly compMinutes: number;
    readonly paidAs: 'comp' | 'paid' | 'mixed' | null;
  }[];
  readonly totals: {
    readonly paidMinutes: number;
    readonly compMinutes: number;
    readonly unpaidDays: string;
    readonly unpaidPeople: number;
    readonly negativePeople: number;
    readonly negativeBalanceDays: string;
  };
  readonly late: readonly {
    readonly personId: string;
    readonly displayName: string;
    readonly team: string;
    readonly openDays: number;
    readonly overtimeWaitingMinutes: number;
  }[];
}

export interface PayPeriodProps {
  readonly load: Loadable<PayPeriodData>;
  readonly onClose?: (month: string) => Promise<Outcome>;
  /** A team's late members, or everyone's with `null`. */
  readonly onRemind?: (month: string, teamKey: string | null) => Promise<Outcome>;
}

const PAID_AS: Record<'comp' | 'paid' | 'mixed', string> = {
  comp: 'Comp time',
  paid: 'Paid',
  mixed: 'Paid and comp time',
};
const people = (n: number): string => (n === 1 ? '1 person' : `${String(n)} people`);
const daysOf = (d: string): string => `${amount(d)} ${amount(d) === '1' ? 'day' : 'days'}`;
const hoursOf = (minutes: number): string => (minutes === 0 ? '0h' : duration(minutes));
const teamOf = (name: string | null): string => name ?? 'No team';

export function PayPeriod(props: PayPeriodProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <PayPeriodSkeleton />;
  return (
    <div className="@container/period flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Attendance" /> : null}
      <Loaded load={load} what="the pay period">
        {(data) => <Ready {...props} data={data} />}
      </Loaded>
    </div>
  );
}

const body =
  'flex flex-col gap-6 @min-[60rem]/period:grid @min-[60rem]/period:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] @min-[60rem]/period:items-start';
const deskOnly = '@max-[40rem]/period:hidden';

function Ready({
  data,
  onClose,
  onRemind,
}: PayPeriodProps & { readonly data: PayPeriodData }): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [told, setTold] = useState<string | null>(null);
  const run = (key: string, act: () => Promise<Outcome>, done: string | null): void => {
    setBusy(key);
    setRefused(null);
    setTold(null);
    void act().then((outcome) => {
      setBusy(null);
      if (!outcome.ok) setRefused(outcome.message);
      else if (done !== null) setTold(done);
    });
  };
  const name = monthName(data.from).split(' ')[0] ?? data.month;
  const over = data.today > data.to;
  const t = data.totals;
  const lateTeams = data.teams.filter((team) => team.waiting > 0);

  return (
    <>
      <PageHeader
        title="Attendance"
        description={`${monthName(data.from)} · ${
          data.closedAt === null
            ? over
              ? 'ready to send to Payroll'
              : `closes for Payroll after ${shortDate(data.to)}`
            : `sent to Payroll on ${shortDate(data.closedAt.slice(0, 10))}`
        }`}
      />
      <MonthNav month={data.month} path="/time-off/attendance/pay-period" />
      {refused === null ? null : (
        <Alert tone="danger" title="Not done">
          {refused}
        </Alert>
      )}
      {told === null ? null : <Alert tone="success" title={told} />}
      <div className={body}>
        <Table aria-label="Teams">
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead className={`${deskOnly} text-end`}>People</TableHead>
              <TableHead>Timesheets</TableHead>
              <TableHead className="text-end">Overtime</TableHead>
              <TableHead className={deskOnly}>Paid as</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.teams.map((team) => (
              <TableRow key={team.team}>
                <TableCell className="font-semibold">{teamOf(team.teamName)}</TableCell>
                <TableCell className={`${deskOnly} text-end tabular-nums`}>{team.people}</TableCell>
                <TableCell>
                  {team.waiting === 0 ? (
                    <Badge size="sm" tone="success">
                      Ready
                    </Badge>
                  ) : (
                    <Badge size="sm" tone="warning" dot>
                      {`${String(team.waiting)} waiting`}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {hoursOf(team.paidMinutes + team.compMinutes)}
                </TableCell>
                <TableCell className={deskOnly}>
                  {team.paidAs === null ? '—' : PAID_AS[team.paidAs]}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PageSection
          title="Send to Payroll"
          actions={
            <Badge size="sm" variant="outline">
              Payroll module
            </Badge>
          }
          surface
        >
          <div className="flex flex-col gap-4">
            <KeyValues
              layout="split"
              items={[
                { label: 'Overtime paid', value: hoursOf(t.paidMinutes) },
                { label: 'Comp time banked', value: hoursOf(t.compMinutes) },
                {
                  label: 'Unpaid leave',
                  value:
                    t.unpaidPeople === 0
                      ? 'None'
                      : `${daysOf(t.unpaidDays)}, ${people(t.unpaidPeople)}`,
                },
                {
                  label: 'Negative balances',
                  value:
                    t.negativePeople === 0
                      ? 'None'
                      : `${people(t.negativePeople)}, ${daysOf(t.negativeBalanceDays)} below zero`,
                },
              ]}
            />
            {data.closedAt === null && lateTeams.length > 0 ? (
              <Alert
                tone="warning"
                title={`${lateTeams.map((team) => teamOf(team.teamName)).join(', ')} ${
                  lateTeams.length === 1 ? 'has' : 'have'
                } ${people(data.late.length)} waiting`}
                action={
                  onRemind === undefined ? undefined : (
                    <Button
                      size="xs"
                      variant="secondary"
                      loading={busy === 'remind'}
                      loadingLabel="Reminding"
                      onClick={() => {
                        run(
                          'remind',
                          () => onRemind(data.month, null),
                          `Reminded ${people(data.late.length)} and their managers`,
                        );
                      }}
                    >
                      Remind them
                    </Button>
                  )
                }
              >
                {`${data.late
                  .map(
                    (l) =>
                      `${l.displayName}: ${[
                        l.openDays === 0
                          ? null
                          : `${String(l.openDays)} missing ${l.openDays === 1 ? 'clock-out' : 'clock-outs'}`,
                        l.overtimeWaitingMinutes === 0
                          ? null
                          : `${duration(l.overtimeWaitingMinutes)} overtime to decide`,
                      ]
                        .filter(Boolean)
                        .join(', ')}`,
                  )
                  .join('. ')}. Send now and what they fix goes in next month’s payroll instead.`}
              </Alert>
            ) : null}
            {data.closedAt !== null ? (
              <Alert tone="success" title={`${name} is with Payroll`}>
                {`Sent on ${shortDate(data.closedAt.slice(0, 10))}. A later fix goes to the next open month, beside what it corrects.`}
              </Alert>
            ) : onClose === undefined ? null : (
              <Button
                variant="primary"
                className="w-full"
                startIcon={<icons.send aria-hidden />}
                disabled={!over}
                loading={busy === 'close'}
                loadingLabel="Sending"
                onClick={() => {
                  run('close', () => onClose(data.month), null);
                }}
              >
                {`Send ${name} to Payroll`}
              </Button>
            )}
            <p className="flex gap-2 text-xs text-fg-muted [&_svg]:size-3.5 [&_svg]:shrink-0">
              <icons.hidden aria-hidden />
              {`Payroll gets hours, and amounts once pay rates are known, never punch times or locations.${
                over || data.closedAt !== null ? '' : ` It can be sent once ${name} is over.`
              }`}
            </p>
          </div>
        </PageSection>
      </div>
    </>
  );
}

/** The page while it loads: the header, the month, the teams' table and the send beside it. */
export function PayPeriodSkeleton(): JSX.Element {
  return (
    <div className="@container/period flex flex-col gap-6">
      <PageHeader title="Attendance" description={' '} />
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">Loading the pay period</span>
        <Skeleton className="h-9 w-80 rounded-sm" />
        <div className={body}>
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
