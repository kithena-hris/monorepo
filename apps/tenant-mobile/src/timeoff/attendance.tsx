import {
  Alert,
  AssistantMark,
  Avatar,
  Badge,
  Button,
  Card,
  CircularProgress,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldDescription,
  FieldLabel,
  Icon,
  Input,
  List,
  ListItem,
  PinInput,
  RadioCard,
  RadioGroup,
  RangeBar,
  Stack,
  Stat,
  Text,
  TimePicker,
  type RangeBarSegment,
} from '@reach/ui-native';
import { ChevronLeft, ChevronRight, Clock3, History, Sparkles, Timer } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { encode } from 'uqr';

import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { askTimeOff, useTimeOff } from './api';
import { inspectorRecord } from './insights';
import { clockTime, duration, instantAt, minuteOfDay, todayHere } from './time';
import { addDays, asDate, shortDate, spanLabel } from './words';

interface Segment {
  readonly kind: string;
  readonly from: number;
  readonly to: number;
}

interface Day {
  readonly date: string;
  readonly status: string;
  readonly flags: readonly string[];
  readonly workedMinutes: number | null;
  readonly breakMinutes: number;
  readonly overtimeMinutes: number | null;
  readonly plannedMinutes: number;
  readonly segments: readonly Segment[];
}

interface Punch {
  readonly id: string;
  readonly at: string;
  readonly kind: 'in' | 'out' | 'break_start' | 'break_end';
  readonly source: string;
  readonly workModel: string | null;
  readonly reason: string | null;
}

interface Sheet {
  readonly member: { personId: string; displayName: string; timeZone: string };
  readonly days: readonly Day[];
  readonly weeks: readonly {
    monday: string;
    workedMinutes: number;
    plannedMinutes: number;
    overtimeMinutes: number;
  }[];
  readonly open: readonly {
    date: string;
    lastPunchAt: string;
    suggestion: {
      time: string;
      ai: boolean;
      evidence: readonly { at: string; source: string; what: string }[];
    } | null;
  }[];
  readonly punches: readonly Punch[];
  readonly overtime: readonly { date: string; minutes: number; outcome: string }[];
  readonly restBreaches: readonly { date: string; restMinutes: number }[];
}

const SEGMENT: Record<string, Omit<RangeBarSegment, 'start' | 'end'>> = {
  worked: { label: 'Worked', tone: 'success' },
  live: { label: 'Working now', tone: 'success', pattern: 'hatched' },
  break: { label: 'Break', tone: 'warning', size: 'thin' },
  overtime: { label: 'Overtime', tone: 'chart-4' },
  missing: { label: 'Missing', tone: 'danger', pattern: 'hatched' },
  planned: { label: 'Planned', tone: 'neutral' },
};
const DAY: readonly [number, number] = [420, 1140];

const mondayOf = (date: string): string => {
  const day = asDate(date).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
};
const weekday = (date: string): string =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(asDate(date));

const bar = (label: string, segments: readonly Segment[], now?: number, axis = false) => (
  <RangeBar
    label={label}
    domain={DAY}
    {...(axis ? { ticks: [420, 600, 780, 960, 1140] } : { ticks: [] })}
    format={clockTime}
    {...(now === undefined ? {} : { now })}
    segments={segments.map((s) => ({
      start: s.from,
      end: s.to,
      ...(SEGMENT[s.kind] ?? { label: s.kind }),
    }))}
  />
);

/**
 * My week (design MT17): the week's total against the plan, then each day
 * as a bar with its time; a day with a missed clock-out has Fix, which opens
 * the suggested finish with its evidence (MT18). Kept as the law requires,
 * seen by the person, their manager and HR.
 */
export function TimeOffTimesheet({
  navigation,
}: PeopleScreen<'TimeOffTimesheet'>): React.JSX.Element {
  const [monday, setMonday] = useState(mondayOf(todayHere()));
  const { load, reload } = useTimeOff<Sheet>('TimeOffTimesheet', {
    from: monday,
    to: addDays(monday, 6),
  });
  const [fixing, setFixing] = useState<string | null>(null);
  const today = todayHere();
  const back = { label: 'Time off', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title="Timesheet" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading your week" />
        )}
      </Page>
    );
  }
  const sheet = load.data;
  const week = sheet.weeks[0];
  const zone = sheet.member.timeZone;
  const now = minuteOfDay(Date.now(), zone);
  const open = sheet.open.find((o) => o.date === fixing);
  return (
    <Page title="Timesheet" back={back}>
      <View className="flex-row items-center gap-2">
        <Button
          size="sm"
          startIcon={<Icon icon={ChevronLeft} />}
          accessibilityLabel="The week before"
          onPress={() => {
            setMonday(addDays(monday, -7));
          }}
        />
        <Text
          weight="semibold"
          className="flex-1 text-center"
        >{`Week of ${shortDate(monday)}`}</Text>
        <Button
          size="sm"
          startIcon={<Icon icon={ChevronRight} />}
          accessibilityLabel="The week after"
          onPress={() => {
            setMonday(addDays(monday, 7));
          }}
        />
      </View>
      {week === undefined ? null : (
        <Card>
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text
                variant="title2"
                weight="bold"
              >{`${duration(week.workedMinutes)} of ${duration(week.plannedMinutes)}`}</Text>
              <Text variant="footnote" tone="muted">
                {week.overtimeMinutes > 0
                  ? `${duration(week.overtimeMinutes)} overtime`
                  : 'No overtime'}
              </Text>
            </View>
            <CircularProgress
              label="Worked of planned"
              value={
                week.plannedMinutes === 0
                  ? 0
                  : Math.min(100, Math.round((week.workedMinutes / week.plannedMinutes) * 100))
              }
              size={56}
            />
          </View>
        </Card>
      )}
      <Card>
        {sheet.days
          .filter((d) => d.plannedMinutes > 0 || d.segments.length > 0)
          .map((d, i, all) => {
            const missing = sheet.open.some((o) => o.date === d.date);
            const overtime = d.overtimeMinutes ?? 0;
            const live = d.date === today && d.segments.some((s) => s.kind === 'live');
            return (
              <View
                key={d.date}
                className={`gap-1.5 py-2.5${i < all.length - 1 ? ' border-b border-border' : ''}`}
              >
                <View className="min-h-8 flex-row items-center gap-2">
                  <Text weight="semibold" className="flex-1">
                    {shortDate(d.date)}
                  </Text>
                  {missing ? (
                    <Button
                      size="sm"
                      startIcon={<Icon icon={Sparkles} />}
                      onPress={() => {
                        setFixing(d.date);
                      }}
                    >
                      Fix
                    </Button>
                  ) : live ? (
                    <Badge size="sm" tone="success" dot>
                      Now
                    </Badge>
                  ) : overtime > 0 ? (
                    <Badge size="sm" tone="info">{`+${duration(overtime)}`}</Badge>
                  ) : null}
                  <Text tone="muted" className="tabular-nums">
                    {d.workedMinutes === null ? '—' : duration(d.workedMinutes)}
                  </Text>
                </View>
                {d.segments.length === 0
                  ? null
                  : bar(shortDate(d.date), d.segments, d.date === today ? now : undefined)}
              </View>
            );
          })}
      </Card>
      {sheet.restBreaches.map((r) => (
        <Alert key={r.date} tone="warning" title={`Short rest before ${shortDate(r.date)}`}>
          {`Only ${duration(r.restMinutes)} between the end of one day and the start of the next.`}
        </Alert>
      ))}
      <Text variant="footnote" tone="muted">
        Kept as the law requires. Only you, your manager and HR see it.
      </Text>
      {fixing === null || open === undefined ? null : (
        <FixDialog
          day={
            sheet.days.find((d) => d.date === fixing) ?? {
              date: fixing,
              status: '',
              flags: [],
              workedMinutes: null,
              breakMinutes: 0,
              overtimeMinutes: null,
              plannedMinutes: 0,
              segments: [],
            }
          }
          open={open}
          punches={sheet.punches}
          personId={sheet.member.personId}
          zone={zone}
          onClose={() => {
            setFixing(null);
          }}
          onSaved={() => {
            setFixing(null);
            reload();
          }}
        />
      )}
    </Page>
  );
}

/** A missed clock-out (MT18): the evidence, one suggested time, one tap. */
function FixDialog({
  day,
  open,
  punches,
  personId,
  zone,
  onClose,
  onSaved,
}: {
  day: Day;
  open: Sheet['open'][number];
  punches: readonly Punch[];
  personId: string;
  zone: string;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const [choice, setChoice] = useState(open.suggestion === null ? 'other' : 'suggested');
  const [time, setTime] = useState<string | null>(open.suggestion?.time ?? null);
  const [note, setNote] = useState('');
  const after = minuteOfDay(open.lastPunchAt, zone);
  const lastKind = punches.find((p) => p.at === open.lastPunchAt)?.kind;
  const before = day.segments
    .filter((s) => ['worked', 'overtime', 'live'].includes(s.kind))
    .reduce((n, s) => n + (s.to - s.from), 0);
  const at = choice === 'suggested' ? (open.suggestion?.time ?? null) : time;
  const chosen = at === null ? null : Number(at.slice(0, 2)) * 60 + Number(at.slice(3));
  const worked =
    chosen === null
      ? null
      : before + (lastKind === 'break_start' ? 0 : Math.max(0, chosen - after));
  const overtime = worked === null ? 0 : Math.max(0, worked - day.plannedMinutes);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`When did you finish on ${weekday(day.date)}?`}</DialogTitle>
          <DialogDescription>{`Your last punch was at ${clockTime(after)}. The clock-out you add goes beside the record; nothing is overwritten.`}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {open.suggestion === null ? null : (
            <Card variant="fill">
              <Stack gap={1}>
                <View className="flex-row items-center gap-2">
                  <AssistantMark size={18} />
                  <Text
                    weight="semibold"
                    className="flex-1"
                  >{`Around ${open.suggestion.time}`}</Text>
                  {open.suggestion.ai ? <Badge size="sm">AI</Badge> : null}
                </View>
                {open.suggestion.evidence.map((e) => (
                  <Text key={`${e.source}${e.at}`} variant="footnote" tone="muted">
                    {`${e.source === 'calendar' ? 'Your meeting ended' : 'Your last action in Kithena was'} at ${clockTime(minuteOfDay(e.at, zone))} · ${e.what}`}
                  </Text>
                ))}
              </Stack>
            </Card>
          )}
          <RadioGroup accessibilityLabel="Finished at" value={choice} onValueChange={setChoice}>
            {open.suggestion === null ? null : (
              <RadioCard
                value="suggested"
                description={
                  worked === null
                    ? ''
                    : `${duration(worked)}${overtime > 0 ? ` · ${duration(overtime)} overtime` : ''}`
                }
              >
                {open.suggestion.time}
              </RadioCard>
            )}
            <RadioCard value="other">Another time</RadioCard>
          </RadioGroup>
          {choice === 'other' ? (
            <TimePicker label="Finished at" size="sm" step={5} value={time} onChange={setTime} />
          ) : null}
          <Field>
            <FieldLabel>Note (optional)</FieldLabel>
            <Input value={note} onChange={setNote} size="sm" maxLength={300} />
            <FieldDescription>Kept with the correction.</FieldDescription>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={at === null}
            loading={busy === 'CorrectTimeOffPunch'}
            onPress={() => {
              if (at === null) return;
              void act<{ needsManager: boolean }>(
                'CorrectTimeOffPunch',
                {
                  input: {
                    personId,
                    supersedes: null,
                    at: instantAt(day.date, at, zone),
                    kind: 'out',
                    reason: note.trim() === '' ? null : note.trim(),
                  },
                },
                (d) => (d.needsManager ? 'Saved; it goes to your manager' : 'Saved'),
              ).then((done) => {
                if (done !== null) onSaved();
              });
            }}
          >
            {at === null ? 'Save' : `Save ${at}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Needs {
  readonly kind: 'correction' | 'overtime';
  readonly personId: string;
  readonly displayName: string;
  readonly date: string;
  readonly minutes: number | null;
  readonly punch: Punch | null;
}

interface TeamNow {
  readonly people: readonly {
    personId: string;
    displayName: string;
    state: 'in' | 'on_break' | 'out';
    workModel: string | null;
    today: { workedMinutes: number | null };
  }[];
  readonly needsYou: readonly Needs[];
  readonly sentence: { text: string; ai: boolean } | null;
}

const WHERE: Record<string, string> = { office: 'Office', remote: 'Remote', client: 'At a client' };

/** Team, right now (design MT19): who is in, on a break or away, and what needs you. */
export function TimeOffTeamNow({ navigation }: PeopleScreen<'TimeOffTeamNow'>): React.JSX.Element {
  const { load, reload } = useTimeOff<TeamNow>('TimeOffTeamRightNow');
  const back = { label: 'Time off', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title="Team now" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading your team" />
        )}
      </Page>
    );
  }
  const d = load.data;
  const count = (s: string): number => d.people.filter((p) => p.state === s).length;
  return (
    <Page title="Team now" back={back}>
      <View className="flex-row gap-2">
        <Stat className="flex-1" label="In" value={count('in')} />
        <Stat className="flex-1" label="Break" value={count('on_break')} />
        <Stat className="flex-1" label="Away" value={count('out')} />
      </View>
      {d.sentence === null ? null : <Text tone="muted">{d.sentence.text}</Text>}
      <List>
        {d.people.map((p) => (
          <ListItem
            key={p.personId}
            leading={<Avatar name={p.displayName} size={40} />}
            description={p.state === 'out' ? 'Away' : (WHERE[p.workModel ?? ''] ?? '')}
            trailing={
              <Badge
                size="sm"
                tone={p.state === 'in' ? 'success' : p.state === 'on_break' ? 'warning' : 'neutral'}
                dot
              >
                {p.state === 'in'
                  ? duration(p.today.workedMinutes ?? 0)
                  : p.state === 'on_break'
                    ? 'Break'
                    : 'Away'}
              </Badge>
            }
          >
            {p.displayName}
          </ListItem>
        ))}
      </List>
      {d.needsYou.length === 0 ? null : (
        <Button
          onPress={() => {
            navigation.navigate('TimeOffAttendanceRequests');
          }}
        >
          {`${String(d.needsYou.length)} ${d.needsYou.length === 1 ? 'thing needs' : 'things need'} you`}
        </Button>
      )}
    </Page>
  );
}

interface AttendanceRequests {
  readonly mine: readonly { date: string; minutes: number; status: string }[];
  readonly needsYou: readonly Needs[];
  readonly overtime: { becomes: 'comp' | 'paid' | 'choose'; multiplier: string };
}

const MINE: Record<string, { label: string; tone: 'warning' | 'success' | 'neutral' | 'danger' }> =
  {
    waiting: { label: 'Waiting', tone: 'warning' },
    comp: { label: 'Comp time', tone: 'success' },
    paid: { label: 'Paid', tone: 'success' },
    declined: { label: 'Declined', tone: 'danger' },
  };

/** Overtime to decide and late corrections for a manager, and your own overtime as it was decided. */
export function TimeOffAttendanceRequests({
  navigation,
}: PeopleScreen<'TimeOffAttendanceRequests'>): React.JSX.Element {
  const { load, reload } = useTimeOff<AttendanceRequests>('TimeOffAttendanceRequests');
  const [deciding, setDeciding] = useState<Needs | null>(null);
  const back = { label: 'Back', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title="Overtime and corrections" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading" />
        )}
      </Page>
    );
  }
  const d = load.data;
  const overtime = d.needsYou.filter((n) => n.kind === 'overtime');
  const corrections = d.needsYou.filter((n) => n.kind === 'correction');
  return (
    <Page title="Overtime and corrections" back={back}>
      {overtime.length === 0 ? null : (
        <List>
          {overtime.map((n) => (
            <ListItem
              key={`${n.personId}${n.date}`}
              icon={Timer}
              description={`${shortDate(n.date)} · ${duration(n.minutes ?? 0)} over the plan`}
              chevron
              onPress={() => {
                setDeciding(n);
              }}
            >
              {n.displayName}
            </ListItem>
          ))}
        </List>
      )}
      {corrections.length === 0 ? null : (
        <List>
          {corrections.map((n) => (
            <ListItem
              key={`${n.personId}${n.date}c`}
              icon={History}
              description={`${shortDate(n.date)} · added more than a day afterwards`}
            >
              {`${n.displayName} · ${weekday(n.date)} ${n.punch?.kind === 'in' ? 'clock-in' : 'clock-out'}`}
            </ListItem>
          ))}
        </List>
      )}
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        Your overtime
      </Text>
      {d.mine.length === 0 ? (
        <Text tone="muted">No overtime in the last month.</Text>
      ) : (
        <List>
          {d.mine.map((m) => (
            <ListItem
              key={m.date}
              icon={Clock3}
              description={`${duration(m.minutes)} over the plan`}
              trailing={
                <Badge size="sm" tone={MINE[m.status]?.tone ?? 'neutral'}>
                  {MINE[m.status]?.label ?? m.status}
                </Badge>
              }
            >
              {shortDate(m.date)}
            </ListItem>
          ))}
        </List>
      )}
      {deciding === null ? null : (
        <OvertimeDialog
          item={deciding}
          overtime={d.overtime}
          onClose={() => {
            setDeciding(null);
          }}
          onDone={() => {
            setDeciding(null);
            reload();
          }}
        />
      )}
    </Page>
  );
}

function OvertimeDialog({
  item,
  overtime,
  onClose,
  onDone,
}: {
  item: Needs;
  overtime: AttendanceRequests['overtime'];
  onClose: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const offered =
    overtime.becomes === 'choose' ? ['comp', 'paid', 'declined'] : [overtime.becomes, 'declined'];
  const [choice, setChoice] = useState(offered[0] ?? 'declined');
  const minutes = item.minutes ?? 0;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`${item.displayName}’s overtime`}</DialogTitle>
          <DialogDescription>{`${shortDate(item.date)} · ${duration(minutes)} over the plan`}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <RadioGroup accessibilityLabel="What it becomes" value={choice} onValueChange={setChoice}>
            {offered.map((o) => (
              <RadioCard
                key={o}
                value={o}
                description={
                  o === 'comp'
                    ? `${duration(minutes)} banked to take as time off.`
                    : o === 'paid'
                      ? `${duration(minutes)} at ${overtime.multiplier}×, sent to Payroll with the month.`
                      : 'Not counted.'
                }
              >
                {o === 'comp' ? 'Comp time' : o === 'paid' ? 'Paid' : 'Decline'}
              </RadioCard>
            ))}
          </RadioGroup>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant={choice === 'declined' ? 'danger' : 'primary'}
            loading={busy === 'DecideTimeOffOvertime'}
            onPress={() => {
              void act(
                'DecideTimeOffOvertime',
                {
                  input: {
                    personId: item.personId,
                    date: item.date,
                    approve: choice !== 'declined',
                    choice: choice === 'declined' ? null : choice,
                  },
                },
                choice === 'declined' ? 'Declined' : 'Approved',
              ).then((done) => {
                if (done !== null) onDone();
              });
            }}
          >
            {choice === 'declined' ? 'Decline' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const monthOf = (date: string): string => date.slice(0, 7);
const monthRange = (m: string): { from: string; to: string } => ({
  from: `${m}-01`,
  to: addDays(`${addDays(`${m}-01`, 31).slice(0, 7)}-01`, -1),
});
const monthName = (m: string): string =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    asDate(`${m}-01`),
  );

/** A month's attendance exceptions, for HR: missing clock-outs, short rests, overtime past the rules. */
export function TimeOffExceptions({
  navigation,
}: PeopleScreen<'TimeOffExceptions'>): React.JSX.Element {
  const [month, setMonth] = useState(monthOf(todayHere()));
  const { load, reload } = useTimeOff<{
    items: {
      personId: string;
      displayName: string;
      teamName: string | null;
      date: string;
      kind: string;
      minutes: number | null;
      holiday: string | null;
    }[];
  }>('TimeOffAttendanceExceptions', monthRange(month));
  const KIND: Record<string, string> = {
    missing_out: 'Clock-out missing',
    short_rest: 'Short rest',
    long_day: 'Over the daily limit',
    overtime: 'Overtime',
    holiday_worked: 'Worked a holiday',
  };
  const signed = useSigned();
  const [record, setRecord] = useState<string | null>(null);
  return (
    <Page title="Exceptions" back={{ label: 'Back', onPress: navigation.goBack }}>
      <View className="flex-row items-center gap-2">
        <Button
          size="sm"
          startIcon={<Icon icon={ChevronLeft} />}
          accessibilityLabel="Month before"
          onPress={() => {
            setMonth(addDays(`${month}-01`, -1).slice(0, 7));
          }}
        />
        <Text weight="semibold" className="flex-1 text-center">
          {monthName(month)}
        </Text>
        <Button
          size="sm"
          startIcon={<Icon icon={ChevronRight} />}
          accessibilityLabel="Month after"
          onPress={() => {
            setMonth(addDays(`${month}-28`, 7).slice(0, 7));
          }}
        />
      </View>
      <View className="flex-row gap-2">
        {(['pdf', 'csv'] as const).map((format) => (
          <Button
            key={format}
            className="flex-1"
            size="sm"
            loading={record === format}
            onPress={() => {
              setRecord(format);
              const { from, to } = monthRange(month);
              void inspectorRecord(signed, from, to, format).then(() => {
                setRecord(null);
              });
            }}
          >
            {`Inspector record · ${format.toUpperCase()}`}
          </Button>
        ))}
      </View>
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label="Loading the exceptions" />
      ) : load.data.items.length === 0 ? (
        <EmptyState
          icon={Clock3}
          title="Nothing to look at"
          description="No exceptions this month."
        />
      ) : (
        <List>
          {load.data.items.map((e, i) => (
            <ListItem
              key={`${e.personId}${e.date}${String(i)}`}
              leading={<Avatar name={e.displayName} size={36} />}
              description={[
                shortDate(e.date),
                KIND[e.kind] ?? e.kind,
                e.minutes === null ? null : duration(e.minutes),
                e.holiday,
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              {e.displayName}
            </ListItem>
          ))}
        </List>
      )}
    </Page>
  );
}

interface PayPeriod {
  readonly closedAt: string | null;
  readonly from: string;
  readonly to: string;
  readonly late: readonly {
    personId: string;
    displayName: string;
    team: string | null;
    openDays: number;
    overtimeWaitingMinutes: number;
  }[];
  readonly teams: readonly {
    team: string | null;
    teamName: string;
    people: number;
    waiting: number;
    paidMinutes: number;
    compMinutes: number;
    paidAs: string;
  }[];
  readonly totals: {
    paidMinutes: number;
    compMinutes: number;
    unpaidDays: string;
    unpaidPeople: number;
    negativeBalanceDays: string;
    negativePeople: number;
  };
}

/** A pay period, for HR: what goes to payroll, who is late, reminders, and closing it. */
export function TimeOffPayPeriod({
  navigation,
}: PeopleScreen<'TimeOffPayPeriod'>): React.JSX.Element {
  const [month, setMonth] = useState(addDays(`${todayHere().slice(0, 7)}-01`, -1).slice(0, 7));
  const { load, reload } = useTimeOff<PayPeriod>('TimeOffPayPeriod', { month });
  const { act, busy } = useAct('timeoff');
  return (
    <Page title="Pay period" back={{ label: 'Back', onPress: navigation.goBack }}>
      <View className="flex-row items-center gap-2">
        <Button
          size="sm"
          startIcon={<Icon icon={ChevronLeft} />}
          accessibilityLabel="Month before"
          onPress={() => {
            setMonth(addDays(`${month}-01`, -1).slice(0, 7));
          }}
        />
        <Text weight="semibold" className="flex-1 text-center">
          {monthName(month)}
        </Text>
        <Button
          size="sm"
          startIcon={<Icon icon={ChevronRight} />}
          accessibilityLabel="Month after"
          onPress={() => {
            setMonth(addDays(`${month}-28`, 7).slice(0, 7));
          }}
        />
      </View>
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label="Loading the period" />
      ) : (
        <>
          <Text tone="muted">{`${spanLabel(load.data.from, load.data.to)}${load.data.closedAt === null ? '' : ` · closed ${shortDate(load.data.closedAt.slice(0, 10))}`}`}</Text>
          <View className="flex-row gap-2">
            <Stat
              className="flex-1"
              label="Overtime paid"
              value={duration(load.data.totals.paidMinutes)}
            />
            <Stat
              className="flex-1"
              label="Comp banked"
              value={duration(load.data.totals.compMinutes)}
            />
          </View>
          <View className="flex-row gap-2">
            <Stat
              className="flex-1"
              label="Unpaid days"
              value={load.data.totals.unpaidDays}
              description={`${String(load.data.totals.unpaidPeople)} people`}
            />
            <Stat
              className="flex-1"
              label="Below zero"
              value={load.data.totals.negativeBalanceDays}
              description={`${String(load.data.totals.negativePeople)} people`}
            />
          </View>
          <List>
            {load.data.teams.map((t) => (
              <ListItem
                key={t.team ?? 'none'}
                description={`${String(t.people)} people · ${duration(t.paidMinutes)} paid · ${duration(t.compMinutes)} comp${t.waiting > 0 ? ` · ${String(t.waiting)} waiting` : ''}`}
                {...(t.waiting > 0
                  ? {
                      trailing: (
                        <Button
                          size="sm"
                          loading={busy === 'RemindTimeOffPayPeriod'}
                          onPress={() => {
                            void act(
                              'RemindTimeOffPayPeriod',
                              { month, input: { teamKey: t.team } },
                              'Reminded',
                            ).then(reload);
                          }}
                        >
                          Remind
                        </Button>
                      ),
                    }
                  : {})}
              >
                {t.teamName}
              </ListItem>
            ))}
          </List>
          {load.data.late.length === 0 ? null : (
            <>
              <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
                Still open
              </Text>
              <List>
                {load.data.late.map((l) => (
                  <ListItem
                    key={l.personId}
                    leading={<Avatar name={l.displayName} size={36} />}
                    description={[
                      l.openDays > 0
                        ? `${String(l.openDays)} open ${l.openDays === 1 ? 'day' : 'days'}`
                        : null,
                      l.overtimeWaitingMinutes > 0
                        ? `${duration(l.overtimeWaitingMinutes)} overtime waiting`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  >
                    {l.displayName}
                  </ListItem>
                ))}
              </List>
            </>
          )}
          {load.data.closedAt === null ? (
            <Button
              variant="primary"
              loading={busy === 'CloseTimeOffPayPeriod'}
              onPress={() => {
                void act('CloseTimeOffPayPeriod', { month }, `${monthName(month)} closed`).then(
                  reload,
                );
              }}
            >
              {`Close ${monthName(month)}`}
            </Button>
          ) : null}
        </>
      )}
    </Page>
  );
}

/** The QR as one SVG path: a rectangle per run of dark modules, with the standard quiet zone. */
function qrPath(text: string): { path: string; size: number } {
  const { data, size } = encode(text, { border: 4 });
  let path = '';
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (row[x] !== true) {
        x++;
        continue;
      }
      const start = x;
      while (row[x] === true) x++;
      path += `M${String(start)} ${String(y)}h${String(x - start)}v1h-${String(x - start)}z`;
    }
  });
  return { path, size };
}

/**
 * My kiosk code: the QR this phone shows the kiosk at the door, signed and
 * good for a minute and asked for again before it runs out, and the PIN to
 * type there instead.
 */
export function TimeOffKioskCode({
  navigation,
}: PeopleScreen<'TimeOffKioskCode'>): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct('timeoff');
  const [code, setCode] = useState<{ token: string; expiresAt: string; personId: string } | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (): Promise<void> => {
      const answer = await askTimeOff<{ token: string; expiresAt: string; personId: string }>(
        signed,
        'TimeOffKioskQr',
      );
      if (!live) return;
      if (!answer.ok) {
        setFailed(answer.message);
        return;
      }
      setCode(answer.data);
      timer = setTimeout(
        () => void read(),
        Math.max(5_000, Date.parse(answer.data.expiresAt) - Date.now() - 10_000),
      );
    };
    void read();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [signed]);
  const qr = useMemo(() => (code === null ? null : qrPath(code.token)), [code]);
  return (
    <Page title="My kiosk code" back={{ label: 'Time off', onPress: navigation.goBack }}>
      {failed !== null ? (
        <Failed
          message={failed}
          onRetry={() => {
            setFailed(null);
          }}
        />
      ) : qr === null ? (
        <Loading label="Making your code" />
      ) : (
        <Card>
          <View className="items-center gap-2">
            <View className="rounded-m-card bg-white p-2">
              <Svg
                width={240}
                height={240}
                viewBox={`0 0 ${String(qr.size)} ${String(qr.size)}`}
                accessibilityLabel="Your kiosk code"
              >
                <Path d={qr.path} fill="#000" />
              </Svg>
            </View>
            <Text variant="footnote" tone="muted">
              Show it to the kiosk at the door. It changes every minute.
            </Text>
          </View>
        </Card>
      )}
      {code === null ? null : (
        <Card>
          <Stack gap={2}>
            <Text weight="semibold">Your PIN</Text>
            <PinInput
              label="Six digits to type at the kiosk instead"
              length={6}
              type="numeric"
              masked
              value={pin}
              onChange={setPin}
            />
            <Button
              variant="primary"
              disabled={pin.length !== 6}
              loading={busy === 'SetTimeOffKioskCredential'}
              onPress={() => {
                void act(
                  'SetTimeOffKioskCredential',
                  { personId: code.personId, kind: 'pin', input: { value: pin } },
                  'PIN saved',
                ).then(() => {
                  setPin('');
                });
              }}
            >
              Save PIN
            </Button>
          </Stack>
        </Card>
      )}
    </Page>
  );
}
