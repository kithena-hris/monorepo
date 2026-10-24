import {
  Alert,
  Badge,
  Button,
  formatList,
  icons,
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
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { amount } from '../words';
import { MonthNav } from './month-nav';
import { duration, monthName, shortDate } from './time';
import { t as tr } from '../i18n';

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
  comp: tr('attendance.pay-period.comp_time', 'Comp time'),
  paid: tr('attendance.pay-period.paid', 'Paid'),
  mixed: tr('attendance.pay-period.paid_and_comp_time', 'Paid and comp time'),
};
const people = (n: number): string =>
  tr(
    'attendance.pay-period.people',
    { one: '{{count}} person', other: '{{count}} people' },
    { count: n },
  );
const daysOf = (d: string): string =>
  tr(
    'attendance.pay-period.count_days',
    { one: '{{count}} day', other: '{{count}} days' },
    { count: Number(amount(d)) },
  );
const hoursOf = (minutes: number): string => (minutes === 0 ? '0h' : duration(minutes));
const teamOf = (name: string | null): string =>
  name ?? tr('attendance.pay-period.no_team', 'No team');

export function PayPeriod(props: PayPeriodProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <PayPeriodSkeleton />;
  return (
    <div className="@container/period flex flex-col gap-6">
      {load.status === 'error' ? (
        <PageHeader title={tr('attendance.pay-period.attendance', 'Attendance')} />
      ) : null}
      <Loaded load={load} what={tr('attendance.pay-period.the_pay_period', 'the pay period')}>
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
        title={tr('attendance.pay-period.attendance', 'Attendance')}
        description={
          data.closedAt === null
            ? over
              ? tr(
                  'attendance.pay-period.ready_to_send_to_payroll',
                  '{{monthName}} · ready to send to Payroll',
                  {
                    monthName: monthName(data.from),
                  },
                )
              : tr(
                  'attendance.pay-period.closes_for_payroll_after',
                  '{{monthName}} · closes for Payroll after {{date}}',
                  {
                    monthName: monthName(data.from),
                    date: shortDate(data.to),
                  },
                )
            : tr(
                'attendance.pay-period.sent_to_payroll_on',
                '{{monthName}} · sent to Payroll on {{date}}',
                {
                  monthName: monthName(data.from),
                  date: shortDate(data.closedAt.slice(0, 10)),
                },
              )
        }
      />
      <MonthNav month={data.month} path="/time-off/attendance/pay-period" />
      {refused === null ? null : (
        <Alert tone="danger" title={tr('attendance.pay-period.not_done', 'Not done')}>
          {refused}
        </Alert>
      )}
      {told === null ? null : <Alert tone="success" title={told} />}
      <div className={body}>
        <Table aria-label={tr('attendance.pay-period.teams', 'Teams')}>
          <TableHeader>
            <TableRow>
              <TableHead>{tr('attendance.pay-period.team', 'Team')}</TableHead>
              <TableHead className={`${deskOnly} text-end`}>
                {tr('attendance.pay-period.people_2', 'People')}
              </TableHead>
              <TableHead>{tr('attendance.pay-period.timesheets', 'Timesheets')}</TableHead>
              <TableHead className="text-end">
                {tr('attendance.pay-period.overtime', 'Overtime')}
              </TableHead>
              <TableHead className={deskOnly}>
                {tr('attendance.pay-period.paid_as', 'Paid as')}
              </TableHead>
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
                      {tr('attendance.pay-period.ready', 'Ready')}
                    </Badge>
                  ) : (
                    <Badge size="sm" tone="warning" dot>
                      {tr('attendance.pay-period.waiting', '{{waiting}} waiting', {
                        waiting: String(team.waiting),
                      })}
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
          title={tr('attendance.pay-period.send_to_payroll', 'Send to Payroll')}
          actions={
            <Badge size="sm" variant="outline">
              {tr('attendance.pay-period.payroll_module', 'Payroll module')}
            </Badge>
          }
          surface
        >
          <div className="flex flex-col gap-4">
            <KeyValues
              layout="split"
              items={[
                {
                  label: tr('attendance.pay-period.overtime_paid', 'Overtime paid'),
                  value: hoursOf(t.paidMinutes),
                },
                {
                  label: tr('attendance.pay-period.comp_time_banked', 'Comp time banked'),
                  value: hoursOf(t.compMinutes),
                },
                {
                  label: tr('attendance.pay-period.unpaid_leave', 'Unpaid leave'),
                  value:
                    t.unpaidPeople === 0
                      ? 'None'
                      : `${daysOf(t.unpaidDays)}, ${people(t.unpaidPeople)}`,
                },
                {
                  label: tr('attendance.pay-period.negative_balances', 'Negative balances'),
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
                title={tr(
                  'attendance.pay-period.waiting_2',
                  {
                    one: '{{join}} has {{people}} waiting',
                    other: '{{join}} have {{people}} waiting',
                  },
                  {
                    count: lateTeams.length,
                    join: lateTeams.map((team) => teamOf(team.teamName)).join(', '),
                    people: people(data.late.length),
                  },
                )}
                action={
                  onRemind === undefined ? undefined : (
                    <Button
                      size="xs"
                      variant="secondary"
                      loading={busy === 'remind'}
                      loadingLabel={tr('attendance.pay-period.reminding', 'Reminding')}
                      onClick={() => {
                        run(
                          'remind',
                          () => onRemind(data.month, null),
                          `Reminded ${people(data.late.length)} and their managers`,
                        );
                      }}
                    >
                      {tr('attendance.pay-period.remind_them', 'Remind them')}
                    </Button>
                  )
                }
              >
                {tr(
                  'attendance.pay-period.send_now_and_what_they_fix',
                  '{{join}}. Send now and what they fix goes in next month’s payroll instead.',
                  {
                    join: data.late
                      .map((l) =>
                        tr('attendance.pay-period.text_named', '{{displayName}}: {{join}}', {
                          displayName: l.displayName,
                          join: formatList(
                            [
                              l.openDays === 0
                                ? null
                                : tr(
                                    'attendance.pay-period.missing_clock_outs',
                                    {
                                      one: '{{count}} missing clock-out',
                                      other: '{{count}} missing clock-outs',
                                    },
                                    { count: l.openDays },
                                  ),
                              l.overtimeWaitingMinutes === 0
                                ? null
                                : tr(
                                    'attendance.pay-period.overtime_to_decide',
                                    '{{duration}} overtime to decide',
                                    {
                                      duration: duration(l.overtimeWaitingMinutes),
                                    },
                                  ),
                            ].filter((x): x is string => x !== null),
                            'unit',
                          ),
                        }),
                      )
                      .join('. '),
                  },
                )}
              </Alert>
            ) : null}
            {data.closedAt !== null ? (
              <Alert
                tone="success"
                title={tr('attendance.pay-period.is_with_payroll', '{{name}} is with Payroll', {
                  name,
                })}
              >
                {tr(
                  'attendance.pay-period.sent_on_a_later_fix_goes',
                  'Sent on {{slice}}. A later fix goes to the next open month, beside what it corrects.',
                  { slice: shortDate(data.closedAt.slice(0, 10)) },
                )}
              </Alert>
            ) : onClose === undefined ? null : (
              <Button
                variant="primary"
                className="w-full"
                startIcon={<icons.send aria-hidden />}
                disabled={!over}
                loading={busy === 'close'}
                loadingLabel={tr('attendance.pay-period.sending', 'Sending')}
                onClick={() => {
                  run('close', () => onClose(data.month), null);
                }}
              >
                {tr('attendance.pay-period.send_to_payroll_2', 'Send {{name}} to Payroll', {
                  name,
                })}
              </Button>
            )}
            <p className="flex gap-2 text-xs text-fg-muted [&_svg]:size-3.5 [&_svg]:shrink-0">
              <icons.hidden aria-hidden />
              {over || data.closedAt !== null
                ? tr(
                    'attendance.pay-period.payroll_gets_hours_and_amounts_once',
                    'Payroll gets hours, and amounts once pay rates are known, never punch times or locations.',
                  )
                : tr(
                    'attendance.pay-period.payroll_gets_hours_sent_once_over',
                    'Payroll gets hours, and amounts once pay rates are known, never punch times or locations. It can be sent once {{name}} is over.',
                    { name },
                  )}
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
      <PageHeader title={tr('attendance.pay-period.attendance', 'Attendance')} description={' '} />
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">
          {tr('attendance.pay-period.loading_the_pay_period', 'Loading the pay period')}
        </span>
        <Skeleton className="h-9 w-80 rounded-sm" />
        <div className={body}>
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
