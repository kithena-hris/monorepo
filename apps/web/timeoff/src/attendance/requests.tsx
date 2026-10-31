import {
  Alert,
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  List,
  ListItem,
  PageHeader,
  PageSection,
  RadioCard,
  RadioGroup,
  Skeleton,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { duration, shortDate, weekdayName } from './time';
import { t } from '../i18n';

/**
 * The attendance Requests tab (TOF-099; T22's "Needs you", PRD §11.5,
 * §11.6): for a manager, the overtime their reports worked that nobody has
 * decided — approved as comp time hour for hour, paid at the multiplier, or
 * declined, as the attendance rules allow — and corrections made more than a
 * day late, shown beside the original. For everyone, their own overtime of
 * the last month and where each day stands.
 *
 * One component at every width: a row per day, its decision in a dialog.
 */

type Outcome3 = 'comp' | 'paid' | 'declined';

export interface AttendanceRequestsData {
  readonly overtime: { readonly becomes: 'comp' | 'paid' | 'choose'; readonly multiplier: string };
  readonly needsYou: readonly {
    readonly kind: 'correction' | 'overtime';
    readonly personId: string;
    readonly displayName: string;
    readonly date: string;
    readonly minutes: number | null;
    readonly punch: { readonly kind: string } | null;
  }[];
  readonly mine: readonly {
    readonly date: string;
    readonly minutes: number;
    readonly status: 'waiting' | Outcome3;
  }[];
}

export interface AttendanceRequestsProps {
  readonly load: Loadable<AttendanceRequestsData>;
  readonly onDecide?: (input: {
    readonly personId: string;
    readonly date: string;
    readonly approve: boolean;
    readonly choice: 'comp' | 'paid' | null;
  }) => Promise<Outcome>;
}

const STATUS: Record<
  'waiting' | Outcome3,
  { label: string; tone: 'warning' | 'success' | 'neutral' }
> = {
  waiting: {
    get label(): string {
      return t('attendance.requests.waiting', 'Waiting');
    },
    tone: 'warning',
  },
  comp: {
    get label(): string {
      return t('attendance.requests.comp_time', 'Comp time');
    },
    tone: 'success',
  },
  paid: {
    get label(): string {
      return t('attendance.requests.paid', 'Paid');
    },
    tone: 'success',
  },
  declined: {
    get label(): string {
      return t('attendance.requests.declined', 'Declined');
    },
    tone: 'neutral',
  },
};

export function AttendanceRequests(props: AttendanceRequestsProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <AttendanceRequestsSkeleton />;
  return (
    <div className="flex flex-col gap-6">
      {load.status === 'error' ? (
        <PageHeader
          title={t('attendance.requests.overtime_and_corrections', 'Overtime and corrections')}
        />
      ) : null}
      <Loaded
        load={load}
        what={t('attendance.requests.your_attendance_requests', 'your attendance requests')}
      >
        {(data) => <Ready data={data} onDecide={props.onDecide} />}
      </Loaded>
    </div>
  );
}

type Item = AttendanceRequestsData['needsYou'][number];

function Ready({
  data,
  onDecide,
}: {
  readonly data: AttendanceRequestsData;
  readonly onDecide: AttendanceRequestsProps['onDecide'];
}): JSX.Element {
  const [deciding, setDeciding] = useState<Item | null>(null);
  const overtime = data.needsYou.filter((n) => n.kind === 'overtime');
  const corrections = data.needsYou.filter((n) => n.kind === 'correction');
  const manages = data.needsYou.length > 0;
  return (
    <>
      <PageHeader
        title={t('attendance.requests.overtime_and_corrections', 'Overtime and corrections')}
        description={
          manages
            ? t(
                'attendance.requests.overtime_to_decide_late',
                {
                  one: '{{length}} overtime to decide, {{count}} late correction',
                  other: '{{length}} overtime to decide, {{count}} late corrections',
                },
                { count: corrections.length, length: String(overtime.length) },
              )
            : t(
                'attendance.requests.your_overtime_and_where_it_stands',
                'Your overtime and where it stands',
              )
        }
      />
      {manages ? (
        <PageSection title={t('attendance.requests.needs_you', 'Needs you')}>
          <List aria-label={t('attendance.requests.needs_you', 'Needs you')}>
            {overtime.map((n) => (
              <ListItem
                key={`${n.personId} ${n.date}`}
                leading={<Avatar name={n.displayName} />}
                description={t(
                  'attendance.requests.over_the_plan',
                  '{{date}} · {{duration}} over the plan',
                  { date: shortDate(n.date), duration: duration(n.minutes ?? 0) },
                )}
                trailing={
                  onDecide === undefined ? undefined : (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={t(
                        'attendance.requests.decide_s_overtime_on',
                        'Decide {{displayName}}’s overtime on {{date}}',
                        { displayName: n.displayName, date: shortDate(n.date) },
                      )}
                      onClick={() => {
                        setDeciding(n);
                      }}
                    >
                      {t('attendance.requests.decide', 'Decide')}
                    </Button>
                  )
                }
              >
                {t('attendance.requests.overtime', '{{displayName}} · {{duration}} overtime', {
                  displayName: n.displayName,
                  duration: duration(n.minutes ?? 0),
                })}
              </ListItem>
            ))}
            {corrections.map((n) => (
              <ListItem
                key={`${n.personId} ${n.date} correction`}
                icon={<icons.history aria-hidden />}
                iconTone="danger"
                description={t(
                  'attendance.requests.added_more_than_a_day_afterwards',
                  '{{date}} · added more than a day afterwards',
                  { date: shortDate(n.date) },
                )}
              >
                {n.punch?.kind === 'in'
                  ? t(
                      'attendance.requests.name_weekday_clock_in',
                      '{{displayName}} · {{weekdayName}} clock-in',
                      {
                        displayName: n.displayName,
                        weekdayName: weekdayName(n.date),
                      },
                    )
                  : t(
                      'attendance.requests.name_weekday_clock_out',
                      '{{displayName}} · {{weekdayName}} clock-out',
                      {
                        displayName: n.displayName,
                        weekdayName: weekdayName(n.date),
                      },
                    )}
              </ListItem>
            ))}
          </List>
        </PageSection>
      ) : null}
      <PageSection
        title={t('attendance.requests.your_overtime', 'Your overtime')}
        description={t(
          'attendance.requests.the_last_month_your_manager_decides',
          'The last month. Your manager decides each day as comp time or pay.',
        )}
      >
        {data.mine.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {t(
              'attendance.requests.no_overtime_in_the_last_month',
              'No overtime in the last month.',
            )}
          </p>
        ) : (
          <List aria-label={t('attendance.requests.your_overtime', 'Your overtime')}>
            {data.mine.map((m) => (
              <ListItem
                key={m.date}
                icon={<icons.overtime aria-hidden />}
                iconTone="info"
                description={t('attendance.requests.over_the_plan_2', '{{minutes}} over the plan', {
                  minutes: duration(m.minutes),
                })}
                trailing={
                  <Badge size="sm" tone={STATUS[m.status].tone} dot={m.status === 'waiting'}>
                    {STATUS[m.status].label}
                  </Badge>
                }
              >
                {shortDate(m.date)}
              </ListItem>
            ))}
          </List>
        )}
      </PageSection>
      {deciding === null || onDecide === undefined ? null : (
        <Decide
          item={deciding}
          overtime={data.overtime}
          onDecide={onDecide}
          onClose={() => {
            setDeciding(null);
          }}
        />
      )}
    </>
  );
}

/** One day's overtime: comp time, pay or decline, as the rules allow. */
function Decide({
  item,
  overtime,
  onDecide,
  onClose,
}: {
  readonly item: Item;
  readonly overtime: AttendanceRequestsData['overtime'];
  readonly onDecide: NonNullable<AttendanceRequestsProps['onDecide']>;
  readonly onClose: () => void;
}): JSX.Element {
  const offered: Outcome3[] =
    overtime.becomes === 'choose' ? ['comp', 'paid', 'declined'] : [overtime.becomes, 'declined'];
  const [choice, setChoice] = useState<Outcome3>(offered[0] ?? 'declined');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const minutes = item.minutes ?? 0;
  const text: Record<Outcome3, { label: string; description: string }> = {
    comp: {
      label: t('attendance.requests.comp_time', 'Comp time'),
      description: t(
        'attendance.requests.banked_hour_for_hour_to_take',
        '{{minutes}} banked, hour for hour, to take as time off.',
        { minutes: duration(minutes) },
      ),
    },
    paid: {
      label: t('attendance.requests.pay_it', 'Pay it'),
      description: t(
        'attendance.requests.at_sent_to_payroll_with_the',
        '{{minutes}} at {{multiplier}}×, sent to Payroll with the month.',
        { minutes: duration(minutes), multiplier: overtime.multiplier },
      ),
    },
    declined: {
      label: t('attendance.requests.decline', 'Decline'),
      description: t(
        'attendance.requests.not_counted_as_overtime_they_can',
        'Not counted as overtime. They can ask you why.',
      ),
    },
  };
  const save = (): void => {
    setBusy(true);
    setRefused(null);
    void onDecide({
      personId: item.personId,
      date: item.date,
      approve: choice !== 'declined',
      choice: choice === 'declined' ? null : choice,
    }).then((outcome) => {
      setBusy(false);
      if (outcome.ok) onClose();
      else setRefused(outcome.message);
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(
              'attendance.requests.s_overtime_on',
              '{{displayName}}’s overtime on {{weekdayName}}',
              { displayName: item.displayName, weekdayName: weekdayName(item.date) },
            )}
          </DialogTitle>
          <DialogDescription>
            {t('attendance.requests.over_the_plan_on', '{{minutes}} over the plan on {{date}}.', {
              minutes: duration(minutes),
              date: shortDate(item.date),
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <RadioGroup
            aria-label={t('attendance.requests.what_it_becomes', 'What it becomes')}
            value={choice}
            onValueChange={(v) => {
              setChoice(v as Outcome3);
            }}
          >
            {offered.map((o) => (
              <RadioCard key={o} value={o} description={text[o].description}>
                {text[o].label}
              </RadioCard>
            ))}
          </RadioGroup>
          {refused === null ? null : (
            <Alert tone="danger" title={t('attendance.requests.not_decided', 'Not decided')}>
              {refused}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{t('attendance.requests.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            startIcon={<icons.confirm aria-hidden />}
            loading={busy}
            loadingLabel={t('attendance.requests.saving', 'Saving')}
            onClick={save}
          >
            {choice === 'declined'
              ? t('attendance.requests.decline', 'Decline')
              : t('attendance.requests.approve', 'Approve')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The tab while it loads: the header, what needs you and your own overtime. */
export function AttendanceRequestsSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('attendance.requests.overtime_and_corrections', 'Overtime and corrections')}
        description={' '}
      />
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">
          {t(
            'attendance.requests.loading_your_attendance_requests',
            'Loading your attendance requests',
          )}
        </span>
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-16 rounded-sm" />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-16 rounded-sm" />
          ))}
        </div>
      </div>
    </div>
  );
}
