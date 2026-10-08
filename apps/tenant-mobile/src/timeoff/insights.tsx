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

const TABS = [
  ['what-changed', 'What changed'],
  ['time-off', 'Time off'],
  ['attendance', 'Attendance'],
  ['balances', 'Balances'],
] as const;

const monthShort = (m: string): string =>
  new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(asDate(`${m}-01`));

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
  const back = { label: 'Time off', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title="Insights" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the figures" />
        )}
      </Page>
    );
  }
  const d = load.data;
  const point = d.points.find((p) => p.kind === open);
  const months = d.months.map((m) => monthShort(m.month));
  return (
    <Page title="Insights" back={back}>
      <View>
        <ChipGroup
          type="single"
          scroll
          value={tab}
          onValueChange={setTab}
          accessibilityLabel="Insights"
        >
          {TABS.map(([v, l]) => (
            <ChipGroupItem key={v} value={v} variant="view">
              {l}
            </ChipGroupItem>
          ))}
        </ChipGroup>
      </View>
      <Text
        variant="footnote"
        tone="muted"
      >{`As of ${shortDate(d.asOf.slice(0, 10))} · groups under ${String(d.cohortMinimum)} people are hidden${d.hiddenTeams > 0 ? ` (${String(d.hiddenTeams)} teams)` : ''}.`}</Text>
      {tab === 'what-changed' ? (
        <>
          <Card>
            <Stack gap={1}>
              <View className="flex-row items-center gap-2">
                <AssistantMark size={20} />
                <Text variant="headline" className="flex-1">
                  {`The month in ${String(d.points.length)} ${d.points.length === 1 ? 'point' : 'points'}`}
                </Text>
                <Badge size="sm">{d.points.some((p) => p.ai) ? 'AI' : 'Templated'}</Badge>
              </View>
              {d.points.length === 0 ? (
                <Text tone="muted">Nothing worth saying changed this month.</Text>
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
            Nudge people to take time off
          </Button>
        </>
      ) : tab === 'time-off' ? (
        <ChartCard title="Days taken" description="Vacation, sick and personal, by month">
          <StackedBarChart
            label="Days taken by month"
            categories={months}
            series={[
              { label: 'Vacation', values: d.months.map((m) => Number(m.vacation)) },
              { label: 'Sick', values: d.months.map((m) => Number(m.sick)) },
              { label: 'Personal', values: d.months.map((m) => Number(m.personal)) },
            ]}
          />
        </ChartCard>
      ) : tab === 'attendance' ? (
        <>
          <ChartCard title="Overtime" description="Hours by month">
            <BarChart
              label="Overtime by month"
              data={d.months.map((m) => ({
                label: monthShort(m.month),
                value: Math.round(m.overtimeMinutes / 6) / 10,
              }))}
              showValues
            />
          </ChartCard>
          <ChartCard title="Missed clock-outs" description="By month">
            <BarChart
              label="Missed clock-outs by month"
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
                description={`${String(t.people)} people · ${amount(t.daysTaken)} taken · ${amount(t.left)} left · ${duration(t.overtimeMinutes)} overtime`}
              >
                {t.teamName}
              </ListItem>
            ))}
          </List>
          <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
            People
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
                {point.kind === 'unbooked' ? 'Who would lose days' : 'Who it is'}
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
                      {p?.displayName ?? 'Someone'}
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
                Close
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
          <DialogTitle>Nudge to take time off</DialogTitle>
          <DialogDescription>
            An email to each person who has not had a day off in a while.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {(
            [
              ['balance', 'Their balance'],
              ['bridge', 'A bridge day that makes it go further'],
              ['losing', 'Days they would lose at year end'],
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
            <Loading label="Writing it" />
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
                {`${String(load.data.recipients.filter((r) => r.reachable).length)} of ${String(load.data.recipients.length)} can be reached by email.`}
              </Text>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
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
                  `Sent to ${String(r.sent)}${r.failed > 0 ? `, ${String(r.failed)} failed` : ''}`,
              ).then((done) => {
                if (done !== null) onClose();
              });
            }}
          >
            Send
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
