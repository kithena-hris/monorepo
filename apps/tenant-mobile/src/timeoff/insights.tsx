import {
  AssistantMark,
  Avatar,
  Badge,
  BarChart,
  Button,
  Card,
  ChartCard,
  ChipGroup,
  ChipGroupItem,
  dateFormat,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  List,
  ListItem,
  Stack,
  StackedBarChart,
  Switch,
  Text,
} from '@reach/ui-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import { useSigned } from '../people/api';
import { shareBase64 } from '../people/media';
import type { PeopleScreen } from '../people/routes';
import { askTimeOff, useTimeOff } from './api';
import { duration } from './time';
import { amount, asDate, shortDate } from './words';
import { t as tr } from '../i18n';

interface Insights {
  readonly asOf: string;
  readonly cohortMinimum: number;
  readonly hiddenTeams: number;
  readonly months: readonly {
    month: string;
    vacation: string;
    sick: string;
    personal: string;
    overtimeMinutes: number;
    missedClockOuts: number;
  }[];
  readonly people: readonly {
    personId: string;
    displayName: string;
    teamName: string | null;
    left: string;
    losesAtYearEnd: string;
    lastDayOff: string | null;
  }[];
  readonly points: readonly {
    kind: string;
    figure: string;
    text: string;
    ai: boolean;
    personIds: readonly string[];
  }[];
  readonly teams: readonly {
    team: string;
    teamName: string;
    people: number;
    daysTaken: string;
    left: string;
    overtimeMinutes: number;
  }[];
}

const TABS = () =>
  [
    ['what-changed', tr('timeoff.insights.what_changed', 'What changed')],
    ['time-off', tr('timeoff.insights.time_off', 'Time off')],
    ['attendance', tr('timeoff.insights.attendance', 'Attendance')],
    ['balances', tr('timeoff.insights.balances', 'Balances')],
  ] as const;

const monthShort = (m: string): string =>
  dateFormat({ month: 'short', timeZone: 'UTC' }).format(asDate(`${m}-01`));

/**
 * Time Off's insights, for HR: the month in a few points (each opening the
 * people behind it), time off and attendance by month, teams and balances,
 * and a nudge to the people who have not had a day off in a while.
 */
export function TimeOffInsights({
  navigation,
}: PeopleScreen<'TimeOffInsights'>): React.JSX.Element {
  const { load, reload } = useTimeOff<Insights>('TimeOffInsights');
  const [tab, setTab] = useState<string>('what-changed');
  const [open, setOpen] = useState<string | null>(null);
  const [nudging, setNudging] = useState(false);
  const back = { label: tr('timeoff.insights.time_off', 'Time off'), onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={tr('timeoff.insights.insights', 'Insights')} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={tr('timeoff.insights.loading_the_figures', 'Loading the figures')} />
        )}
      </Page>
    );
  }
  const d = load.data;
  const point = d.points.find((p) => p.kind === open);
  const months = d.months.map((m) => monthShort(m.month));
  return (
    <Page title={tr('timeoff.insights.insights', 'Insights')} back={back}>
      <View>
        <ChipGroup
          type="single"
          scroll
          value={tab}
          onValueChange={setTab}
          accessibilityLabel={tr('timeoff.insights.insights', 'Insights')}
        >
          {TABS().map(([v, l]) => (
            <ChipGroupItem key={v} value={v} variant="view">
              {l}
            </ChipGroupItem>
          ))}
        </ChipGroup>
      </View>
      <Text variant="footnote" tone="muted">
        {tr(
          'timeoff.insights.as_of_groups_under_people_are',
          'As of {{shortDate}} · groups under {{String}} people are hidden{{value}}.',
          {
            shortDate: shortDate(d.asOf.slice(0, 10)),
            String: String(d.cohortMinimum),
            value: d.hiddenTeams > 0 ? ` (${String(d.hiddenTeams)} teams)` : '',
          },
        )}
      </Text>
      {tab === 'what-changed' ? (
        <>
          <Card>
            <Stack gap={1}>
              <View className="flex-row items-center gap-2">
                <AssistantMark size={20} />
                <Text variant="headline" className="flex-1">
                  {tr(
                    'timeoff.insights.the_month_in',
                    { one: 'The month in {{count}} point', other: 'The month in {{count}} points' },
                    { count: d.points.length },
                  )}
                </Text>
                <Badge size="sm">
                  {d.points.some((p) => p.ai)
                    ? tr('timeoff.insights.ai', 'AI')
                    : tr('timeoff.insights.templated', 'Templated')}
                </Badge>
              </View>
              {d.points.length === 0 ? (
                <Text tone="muted">
                  {tr(
                    'timeoff.insights.nothing_worth_saying_changed_this_month',
                    'Nothing worth saying changed this month.',
                  )}
                </Text>
              ) : (
                d.points.map((p) => (
                  <ListItem
                    key={p.kind}
                    listitem={false}
                    leading={<Badge tone="neutral">{p.figure}</Badge>}
                    {...(p.personIds.length === 0
                      ? {}
                      : {
                          chevron: true,
                          onPress: () => {
                            setOpen(p.kind);
                          },
                        })}
                  >
                    {p.text}
                  </ListItem>
                ))
              )}
            </Stack>
          </Card>
          <Button
            onPress={() => {
              setNudging(true);
            }}
          >
            {tr('timeoff.insights.nudge_people_to_take_time_off', 'Nudge people to take time off')}
          </Button>
        </>
      ) : tab === 'time-off' ? (
        <ChartCard
          title={tr('timeoff.insights.days_taken', 'Days taken')}
          description={tr(
            'timeoff.insights.vacation_sick_and_personal_by_month',
            'Vacation, sick and personal, by month',
          )}
        >
          <StackedBarChart
            label={tr('timeoff.insights.days_taken_by_month', 'Days taken by month')}
            categories={months}
            series={[
              {
                label: tr('timeoff.insights.vacation', 'Vacation'),
                values: d.months.map((m) => Number(m.vacation)),
              },
              {
                label: tr('timeoff.insights.sick', 'Sick'),
                values: d.months.map((m) => Number(m.sick)),
              },
              {
                label: tr('timeoff.insights.personal', 'Personal'),
                values: d.months.map((m) => Number(m.personal)),
              },
            ]}
          />
        </ChartCard>
      ) : tab === 'attendance' ? (
        <>
          <ChartCard
            title={tr('timeoff.insights.overtime', 'Overtime')}
            description={tr('timeoff.insights.hours_by_month', 'Hours by month')}
          >
            <BarChart
              label={tr('timeoff.insights.overtime_by_month', 'Overtime by month')}
              data={d.months.map((m) => ({
                label: monthShort(m.month),
                value: Math.round(m.overtimeMinutes / 6) / 10,
              }))}
              showValues
            />
          </ChartCard>
          <ChartCard
            title={tr('timeoff.insights.missed_clock_outs', 'Missed clock-outs')}
            description={tr('timeoff.insights.by_month', 'By month')}
          >
            <BarChart
              label={tr(
                'timeoff.insights.missed_clock_outs_by_month',
                'Missed clock-outs by month',
              )}
              data={d.months.map((m) => ({ label: monthShort(m.month), value: m.missedClockOuts }))}
              showValues
            />
          </ChartCard>
        </>
      ) : (
        <>
          <List>
            {d.teams.map((t) => (
              <ListItem
                key={t.team}
                description={tr(
                  'timeoff.insights.people_taken_left_overtime',
                  '{{String}} people · {{amount}} taken · {{amount2}} left · {{duration}} overtime',
                  {
                    String: String(t.people),
                    amount: amount(t.daysTaken),
                    amount2: amount(t.left),
                    duration: duration(t.overtimeMinutes),
                  },
                )}
              >
                {t.teamName}
              </ListItem>
            ))}
          </List>
          <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
            {tr('timeoff.insights.people', 'People')}
          </Text>
          <List>
            {d.people.map((p) => (
              <ListItem
                key={p.personId}
                leading={<Avatar name={p.displayName} size={36} />}
                description={[
                  `${amount(p.left)} left`,
                  Number(p.losesAtYearEnd) > 0
                    ? `loses ${amount(p.losesAtYearEnd)} at year end`
                    : null,
                  p.lastDayOff === null ? 'no day off yet' : `last off ${shortDate(p.lastDayOff)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                {p.displayName}
              </ListItem>
            ))}
          </List>
        </>
      )}
      {point === undefined ? null : (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setOpen(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {point.kind === 'unbooked'
                  ? tr('timeoff.insights.who_would_lose_days', 'Who would lose days')
                  : tr('timeoff.insights.who_it_is', 'Who it is')}
              </DialogTitle>
              <DialogDescription>{point.text}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <List>
                {point.personIds.map((id) => {
                  const p = d.people.find((x) => x.personId === id);
                  return (
                    <ListItem
                      key={id}
                      leading={<Avatar name={p?.displayName ?? 'Someone'} size={36} />}
                      description={p?.teamName ?? ''}
                    >
                      {p?.displayName ?? tr('timeoff.insights.someone', 'Someone')}
                    </ListItem>
                  );
                })}
              </List>
            </DialogBody>
            <DialogFooter>
              <Button
                className="flex-1"
                onPress={() => {
                  setOpen(null);
                }}
              >
                {tr('timeoff.insights.close', 'Close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {nudging ? (
        <Nudge
          onClose={() => {
            setNudging(false);
          }}
        />
      ) : null}
    </Page>
  );
}

/** A nudge to take time off: what goes in it, to whom, and how it reads, then sent. */
function Nudge({ onClose }: { onClose: () => void }): React.JSX.Element {
  const signed = useSigned();
  const [include, setInclude] = useState({ balance: true, bridge: true, losing: false });
  const { load } = useTimeOff<{
    recipients: { personId: string; displayName: string; reachable: boolean }[];
    preview: { heading: string; lede: string; ai: boolean } | null;
    since: string | null;
  }>('TimeOffNudge', include);
  const { act, busy } = useAct('timeoff');
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr('timeoff.insights.nudge_to_take_time_off', 'Nudge to take time off')}
          </DialogTitle>
          <DialogDescription>
            {tr(
              'timeoff.insights.an_email_to_each_person_who',
              'An email to each person who has not had a day off in a while.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {(
            [
              ['balance', tr('timeoff.insights.their_balance', 'Their balance')],
              [
                'bridge',
                tr(
                  'timeoff.insights.a_bridge_day_that_makes_it',
                  'A bridge day that makes it go further',
                ),
              ],
              [
                'losing',
                tr(
                  'timeoff.insights.days_they_would_lose_at_year',
                  'Days they would lose at year end',
                ),
              ],
            ] as const
          ).map(([k, label]) => (
            <ListItem
              key={k}
              listitem={false}
              trailing={
                <Switch
                  checked={include[k]}
                  accessibilityLabel={label}
                  onCheckedChange={(on) => {
                    setInclude((i) => ({ ...i, [k]: on }));
                  }}
                />
              }
            >
              {label}
            </ListItem>
          ))}
          {load.status !== 'ready' ? (
            <Loading label={tr('timeoff.insights.writing_it', 'Writing it')} />
          ) : (
            <>
              {load.data.preview === null ? null : (
                <Card variant="fill">
                  <Stack gap={1}>
                    <Text weight="semibold">{load.data.preview.heading}</Text>
                    <Text variant="subhead">{load.data.preview.lede}</Text>
                  </Stack>
                </Card>
              )}
              <Text variant="footnote" tone="muted">
                {tr(
                  'timeoff.insights.of_can_be_reached_by_email',
                  '{{String}} of {{String2}} can be reached by email.',
                  {
                    String: String(load.data.recipients.filter((r) => r.reachable).length),
                    String2: String(load.data.recipients.length),
                  },
                )}
              </Text>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {tr('timeoff.insights.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy === 'SendTimeOffNudges'}
            onPress={() => {
              void act<{ sent: number; unreachable: number; failed: number }>(
                'SendTimeOffNudges',
                {
                  input: {
                    include,
                    companyName: signed.company.displayName ?? signed.company.slug,
                    appOrigin: signed.company.origin,
                  },
                },
                (r) =>
                  tr('timeoff.insights.sent_to', 'Sent to {{String}}{{value}}', {
                    String: String(r.sent),
                    value: r.failed > 0 ? `, ${String(r.failed)} failed` : '',
                  }),
              ).then((done) => {
                if (done !== null) onClose();
              });
            }}
          >
            {tr('timeoff.insights.send', 'Send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The labour inspector's daily record for a month, as a PDF or CSV to share. */
export async function inspectorRecord(
  signed: ReturnType<typeof useSigned>,
  from: string,
  to: string,
  format: 'pdf' | 'csv',
): Promise<string | null> {
  const answer = await askTimeOff<{ base64: string; contentType: string; name: string }>(
    signed,
    'TimeOffInspectorRecord',
    { from, to, format },
  );
  if (!answer.ok) return answer.message;
  await shareBase64(answer.data.base64, answer.data.name, answer.data.contentType);
  return null;
}
