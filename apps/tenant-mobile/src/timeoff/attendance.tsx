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
  type RangeBarSegment,
  Stack,
  Stat,
  Text,
  TimePicker,
} from '@reach/ui-native';
import { dateFormat } from '@reach/ui-native/words';
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
import { t as tr } from '../i18n';

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

const SEGMENT = (): Record<string, Omit<RangeBarSegment, 'start' | 'end'>> => ({
  worked: { label: tr('timeoff.attendance.worked', 'Worked'), tone: 'success' },
  live: {
    label: tr('timeoff.attendance.working_now', 'Working now'),
    tone: 'success',
    pattern: 'hatched',
  },
  break: { label: tr('timeoff.attendance.break', 'Break'), tone: 'warning', size: 'thin' },
  overtime: { label: tr('timeoff.attendance.overtime', 'Overtime'), tone: 'chart-4' },
  missing: {
    label: tr('timeoff.attendance.missing', 'Missing'),
    tone: 'danger',
    pattern: 'hatched',
  },
  planned: { label: tr('timeoff.attendance.planned', 'Planned'), tone: 'neutral' },
});
const DAY: readonly [number, number] = [420, 1140];

const mondayOf = (date: string): string => {
  const day = asDate(date).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
};
const weekday = (date: string): string =>
  dateFormat({ weekday: 'long', timeZone: 'UTC' }).format(asDate(date));

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
      ...(SEGMENT()[s.kind] ?? { label: s.kind }),
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
  const back = { label: tr('timeoff.attendance.time_off', 'Time off'), onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={tr('timeoff.attendance.timesheet', 'Timesheet')} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={tr('timeoff.attendance.loading_your_week', 'Loading your week')} />
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
    <Page title={tr('timeoff.attendance.timesheet', 'Timesheet')} back={back}>
      <View className="flex-row items-center gap-2">
        <Button
          size="sm"
          startIcon={<Icon icon={ChevronLeft} />}
          accessibilityLabel={tr('timeoff.attendance.the_week_before', 'The week before')}
          onPress={() => {
            setMonday(addDays(monday, -7));
          }}
        />
        <Text weight="semibold" className="flex-1 text-center">
          {tr('timeoff.attendance.week_of', 'Week of {{shortDate}}', {
            shortDate: shortDate(monday),
          })}
        </Text>
        <Button
          size="sm"
          startIcon={<Icon icon={ChevronRight} />}
          accessibilityLabel={tr('timeoff.attendance.the_week_after', 'The week after')}
          onPress={() => {
            setMonday(addDays(monday, 7));
          }}
        />
      </View>
      {week === undefined ? null : (
        <Card>
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text variant="title2" weight="bold">
                {tr('timeoff.attendance.of', '{{duration}} of {{duration2}}', {
                  duration: duration(week.workedMinutes),
                  duration2: duration(week.plannedMinutes),
                })}
              </Text>
              <Text variant="footnote" tone="muted">
                {week.overtimeMinutes > 0
                  ? tr('timeoff.attendance.overtime_2', '{{duration}} overtime', {
                      duration: duration(week.overtimeMinutes),
                    })
                  : tr('timeoff.attendance.no_overtime', 'No overtime')}
              </Text>
            </View>
            <CircularProgress
              label={tr('timeoff.attendance.worked_of_planned', 'Worked of planned')}
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
                      {tr('timeoff.attendance.fix', 'Fix')}
                    </Button>
                  ) : live ? (
                    <Badge size="sm" tone="success" dot>
                      {tr('timeoff.attendance.now', 'Now')}
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
        <Alert
          key={r.date}
          tone="warning"
          title={tr('timeoff.attendance.short_rest_before', 'Short rest before {{shortDate}}', {
            shortDate: shortDate(r.date),
          })}
        >
          {tr(
            'timeoff.attendance.only_between_the_end_of_one',
            'Only {{duration}} between the end of one day and the start of the next.',
            { duration: duration(r.restMinutes) },
          )}
        </Alert>
      ))}
      <Text variant="footnote" tone="muted">
        {tr(
          'timeoff.attendance.kept_as_the_law_requires_only',
          'Kept as the law requires. Only you, your manager and HR see it.',
        )}
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
  const [choice, setChoice] = useState(open.suggestion === null ? 'other' : 'picked');
  const [time, setTime] = useState<string | null>(open.suggestion?.time ?? null);
  const [note, setNote] = useState('');
  const after = minuteOfDay(open.lastPunchAt, zone);
  const lastKind = punches.find((p) => p.at === open.lastPunchAt)?.kind;
  const before = day.segments
    .filter((s) => ['worked', 'overtime', 'live'].includes(s.kind))
    .reduce((n, s) => n + (s.to - s.from), 0);
  const at = time;
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
          <DialogTitle>
            {tr(
              'timeoff.attendance.when_did_you_finish_on',
              'When did you finish on {{weekday}}?',
              { weekday: weekday(day.date) },
            )}
          </DialogTitle>
          <DialogDescription>
            {tr(
              'timeoff.attendance.you_at_and_didnt_clock_out',
              'You {{value}} at {{clockTime}} and didn’t clock out. Nothing is overwritten.',
              {
                value: lastKind === 'in' ? 'clocked in' : 'last punched',
                clockTime: clockTime(after),
              },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {open.suggestion === null ? null : (
            // From your day (v3 T5): the likely time, and the signals it came from.
            <Card variant="assistant">
              <View className="flex-row items-center gap-2">
                <AssistantMark size={18} />
                <Text weight="semibold" className="flex-1">
                  {tr('timeoff.attendance.from_your_day', 'From your day')}
                </Text>
              </View>
              {open.suggestion.evidence.map((e) => (
                <Text key={`${e.source}${e.at}`} variant="subhead" tone="muted">
                  {tr('timeoff.attendance.at', '{{value}} at {{clockTime}} · {{what}}', {
                    value:
                      e.source === 'calendar'
                        ? 'Your meeting ended'
                        : 'Your last action in Kithena was',
                    clockTime: clockTime(minuteOfDay(e.at, zone)),
                    what: e.what,
                  })}
                </Text>
              ))}
            </Card>
          )}
          <View className="flex-row flex-wrap gap-2.5">
            {[
              ...new Set(
                [
                  open.suggestion?.time ?? null,
                  ...(open.suggestion?.evidence ?? []).map((e) =>
                    clockTime(minuteOfDay(e.at, zone)),
                  ),
                ].filter((t): t is string => t !== null),
              ),
            ]
              .slice(0, 3)
              .map((t) => {
                const on = choice !== 'other' && time === t;
                return (
                  <Button
                    key={t}
                    className="min-w-[46%] flex-1"
                    variant={on ? 'tinted' : 'secondary'}
                    accessibilityLabel={
                      t === open.suggestion?.time
                        ? tr('timeoff.attendance.suggested', '{{t}}, suggested', { t })
                        : t
                    }
                    onPress={() => {
                      setChoice('picked');
                      setTime(t);
                    }}
                  >
                    {t === open.suggestion?.time
                      ? tr('timeoff.attendance.suggested_2', '{{t}} · Suggested', { t })
                      : t}
                  </Button>
                );
              })}
            <Button
              className="min-w-[46%] flex-1"
              variant={choice === 'other' ? 'tinted' : 'secondary'}
              onPress={() => {
                setChoice('other');
              }}
            >
              {tr('timeoff.attendance.another_time', 'Another time')}
            </Button>
          </View>
          {worked === null ? null : (
            <Text variant="footnote" tone="muted">
              {tr('timeoff.attendance.worked_2', '{{duration}} worked{{value}}', {
                duration: duration(worked),
                value: overtime > 0 ? ` · ${duration(overtime)} overtime` : '',
              })}
            </Text>
          )}
          {choice === 'other' ? (
            <TimePicker
              label={tr('timeoff.attendance.finished_at', 'Finished at')}
              size="sm"
              step={5}
              value={time}
              onChange={setTime}
            />
          ) : null}
          <Field>
            <FieldLabel>{tr('timeoff.attendance.note_optional', 'Note (optional)')}</FieldLabel>
            <Input value={note} onChange={setNote} size="sm" maxLength={300} />
            <FieldDescription>
              {tr('timeoff.attendance.kept_with_the_correction', 'Kept with the correction.')}
            </FieldDescription>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {tr('timeoff.attendance.cancel', 'Cancel')}
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
            {at === null
              ? tr('timeoff.attendance.save', 'Save')
              : tr('timeoff.attendance.save_2', 'Save {{at}}', { at })}
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

const WHERE = (): Record<string, string> => ({
  office: tr('timeoff.attendance.office', 'Office'),
  remote: tr('timeoff.attendance.remote', 'Remote'),
  client: tr('timeoff.attendance.at_a_client', 'At a client'),
});

/** Team, right now (design MT19): who is in, on a break or away, and what needs you. */
export function TimeOffTeamNow({ navigation }: PeopleScreen<'TimeOffTeamNow'>): React.JSX.Element {
  const { load, reload } = useTimeOff<TeamNow>('TimeOffTeamRightNow');
  const back = { label: tr('timeoff.attendance.time_off', 'Time off'), onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={tr('timeoff.attendance.team_now', 'Team now')} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={tr('timeoff.attendance.loading_your_team', 'Loading your team')} />
        )}
      </Page>
    );
  }
  const d = load.data;
  const count = (s: string): number => d.people.filter((p) => p.state === s).length;
  return (
    <Page title={tr('timeoff.attendance.team_now', 'Team now')} back={back}>
      <View className="flex-row gap-2">
        <Stat className="flex-1" label={tr('timeoff.attendance.in', 'In')} value={count('in')} />
        <Stat
          className="flex-1"
          label={tr('timeoff.attendance.break', 'Break')}
          value={count('on_break')}
        />
        <Stat
          className="flex-1"
          label={tr('timeoff.attendance.away', 'Away')}
          value={count('out')}
        />
      </View>
      {d.sentence === null ? null : <Text tone="muted">{d.sentence.text}</Text>}
      <List>
        {d.people.map((p) => (
          <ListItem
            key={p.personId}
            leading={<Avatar name={p.displayName} size={40} />}
            description={
              p.state === 'out'
                ? tr('timeoff.attendance.away', 'Away')
                : (WHERE()[p.workModel ?? ''] ?? '')
            }
            trailing={
              <Badge
                size="sm"
                tone={p.state === 'in' ? 'success' : p.state === 'on_break' ? 'warning' : 'neutral'}
                dot
              >
                {p.state === 'in'
                  ? duration(p.today.workedMinutes ?? 0)
                  : p.state === 'on_break'
                    ? tr('timeoff.attendance.break', 'Break')
                    : tr('timeoff.attendance.away', 'Away')}
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
          {tr(
            'timeoff.attendance.you',
            { one: '{{count}} thing needs you', other: '{{count}} things need you' },
            { count: d.needsYou.length },
          )}
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

const MINE = (): Record<
  string,
  { label: string; tone: 'warning' | 'success' | 'neutral' | 'danger' }
> => ({
  waiting: { label: tr('timeoff.attendance.waiting', 'Waiting'), tone: 'warning' },
  comp: { label: tr('timeoff.attendance.comp_time', 'Comp time'), tone: 'success' },
  paid: { label: tr('timeoff.attendance.paid', 'Paid'), tone: 'success' },
  declined: { label: tr('timeoff.attendance.declined', 'Declined'), tone: 'danger' },
});

/** Overtime to decide and late corrections for a manager, and your own overtime as it was decided. */
export function TimeOffAttendanceRequests({
  navigation,
}: PeopleScreen<'TimeOffAttendanceRequests'>): React.JSX.Element {
  const { load, reload } = useTimeOff<AttendanceRequests>('TimeOffAttendanceRequests');
  const [deciding, setDeciding] = useState<Needs | null>(null);
  const back = { label: tr('timeoff.attendance.back', 'Back'), onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page
        title={tr('timeoff.attendance.overtime_and_corrections', 'Overtime and corrections')}
        back={back}
      >
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={tr('timeoff.attendance.loading', 'Loading')} />
        )}
      </Page>
    );
  }
  const d = load.data;
  const overtime = d.needsYou.filter((n) => n.kind === 'overtime');
  const corrections = d.needsYou.filter((n) => n.kind === 'correction');
  return (
    <Page
      title={tr('timeoff.attendance.overtime_and_corrections', 'Overtime and corrections')}
      back={back}
    >
      {overtime.length === 0 ? null : (
        <List>
          {overtime.map((n) => (
            <ListItem
              key={`${n.personId}${n.date}`}
              icon={Timer}
              description={tr(
                'timeoff.attendance.over_the_plan',
                '{{shortDate}} · {{duration}} over the plan',
                { shortDate: shortDate(n.date), duration: duration(n.minutes ?? 0) },
              )}
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
              description={tr(
                'timeoff.attendance.added_more_than_a_day_afterwards',
                '{{shortDate}} · added more than a day afterwards',
                { shortDate: shortDate(n.date) },
              )}
            >
              {`${n.displayName} · ${weekday(n.date)} ${n.punch?.kind === 'in' ? 'clock-in' : 'clock-out'}`}
            </ListItem>
          ))}
        </List>
      )}
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        {tr('timeoff.attendance.your_overtime', 'Your overtime')}
      </Text>
      {d.mine.length === 0 ? (
        <Text tone="muted">
          {tr('timeoff.attendance.no_overtime_in_the_last_month', 'No overtime in the last month.')}
        </Text>
      ) : (
        <List>
          {d.mine.map((m) => (
            <ListItem
              key={m.date}
              icon={Clock3}
              description={tr('timeoff.attendance.over_the_plan_2', '{{duration}} over the plan', {
                duration: duration(m.minutes),
              })}
              trailing={
                <Badge size="sm" tone={MINE()[m.status]?.tone ?? 'neutral'}>
                  {MINE()[m.status]?.label ?? m.status}
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
          <DialogTitle>
            {tr('timeoff.attendance.s_overtime', '{{displayName}}’s overtime', {
              displayName: item.displayName,
            })}
          </DialogTitle>
          <DialogDescription>
            {tr('timeoff.attendance.over_the_plan', '{{shortDate}} · {{duration}} over the plan', {
              shortDate: shortDate(item.date),
              duration: duration(minutes),
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <RadioGroup
            accessibilityLabel={tr('timeoff.attendance.what_it_becomes', 'What it becomes')}
            value={choice}
            onValueChange={setChoice}
          >
            {offered.map((o) => (
              <RadioCard
                key={o}
                value={o}
                description={
                  o === 'comp'
                    ? tr(
                        'timeoff.attendance.banked_to_take_as_time_off',
                        '{{duration}} banked to take as time off.',
                        { duration: duration(minutes) },
                      )
                    : o === 'paid'
                      ? tr(
                          'timeoff.attendance.at_sent_to_payroll_with_the',
                          '{{duration}} at {{multiplier}}×, sent to Payroll with the month.',
                          { duration: duration(minutes), multiplier: overtime.multiplier },
                        )
                      : tr('timeoff.attendance.not_counted', 'Not counted.')
                }
              >
                {o === 'comp'
                  ? tr('timeoff.attendance.comp_time', 'Comp time')
                  : o === 'paid'
                    ? tr('timeoff.attendance.paid', 'Paid')
                    : tr('timeoff.attendance.decline', 'Decline')}
              </RadioCard>
            ))}
          </RadioGroup>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {tr('timeoff.attendance.cancel', 'Cancel')}
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
            {choice === 'declined'
              ? tr('timeoff.attendance.decline', 'Decline')
              : tr('timeoff.attendance.approve', 'Approve')}
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
  dateFormat({ month: 'long', year: 'numeric', timeZone: 'UTC' }).format(asDate(`${m}-01`));

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
    missing_out: tr('timeoff.attendance.clock_out_missing', 'Clock-out missing'),
    short_rest: tr('timeoff.attendance.short_rest', 'Short rest'),
    long_day: tr('timeoff.attendance.over_the_daily_limit', 'Over the daily limit'),
    overtime: 'Overtime',
    holiday_worked: tr('timeoff.attendance.worked_a_holiday', 'Worked a holiday'),
  };
  const signed = useSigned();
  const [record, setRecord] = useState<string | null>(null);
  return (
    <Page
      title={tr('timeoff.attendance.exceptions', 'Exceptions')}
      back={{ label: tr('timeoff.attendance.back', 'Back'), onPress: navigation.goBack }}
    >
      <View className="flex-row items-center gap-2">
        <Button
          size="sm"
          startIcon={<Icon icon={ChevronLeft} />}
          accessibilityLabel={tr('timeoff.attendance.month_before', 'Month before')}
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
          accessibilityLabel={tr('timeoff.attendance.month_after', 'Month after')}
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
            {tr('timeoff.attendance.inspector_record', 'Inspector record · {{toUpperCase}}', {
              toUpperCase: format.toUpperCase(),
            })}
          </Button>
        ))}
      </View>
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading
          label={tr('timeoff.attendance.loading_the_exceptions', 'Loading the exceptions')}
        />
      ) : load.data.items.length === 0 ? (
        <EmptyState
          icon={Clock3}
          title={tr('timeoff.attendance.nothing_to_look_at', 'Nothing to look at')}
          description={tr(
            'timeoff.attendance.no_exceptions_this_month',
            'No exceptions this month.',
          )}
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
    <Page
      title={tr('timeoff.attendance.pay_period', 'Pay period')}
      back={{ label: tr('timeoff.attendance.back', 'Back'), onPress: navigation.goBack }}
    >
      <View className="flex-row items-center gap-2">
        <Button
          size="sm"
          startIcon={<Icon icon={ChevronLeft} />}
          accessibilityLabel={tr('timeoff.attendance.month_before', 'Month before')}
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
          accessibilityLabel={tr('timeoff.attendance.month_after', 'Month after')}
          onPress={() => {
            setMonth(addDays(`${month}-28`, 7).slice(0, 7));
          }}
        />
      </View>
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label={tr('timeoff.attendance.loading_the_period', 'Loading the period')} />
      ) : (
        <>
          <Text tone="muted">{`${spanLabel(load.data.from, load.data.to)}${load.data.closedAt === null ? '' : ` · closed ${shortDate(load.data.closedAt.slice(0, 10))}`}`}</Text>
          <View className="flex-row gap-2">
            <Stat
              className="flex-1"
              label={tr('timeoff.attendance.overtime_paid', 'Overtime paid')}
              value={duration(load.data.totals.paidMinutes)}
            />
            <Stat
              className="flex-1"
              label={tr('timeoff.attendance.comp_banked', 'Comp banked')}
              value={duration(load.data.totals.compMinutes)}
            />
          </View>
          <View className="flex-row gap-2">
            <Stat
              className="flex-1"
              label={tr('timeoff.attendance.unpaid_days', 'Unpaid days')}
              value={load.data.totals.unpaidDays}
              description={tr('timeoff.attendance.people', '{{String}} people', {
                String: String(load.data.totals.unpaidPeople),
              })}
            />
            <Stat
              className="flex-1"
              label={tr('timeoff.attendance.below_zero', 'Below zero')}
              value={load.data.totals.negativeBalanceDays}
              description={tr('timeoff.attendance.people', '{{String}} people', {
                String: String(load.data.totals.negativePeople),
              })}
            />
          </View>
          <List>
            {load.data.teams.map((t) => (
              <ListItem
                key={t.team ?? 'none'}
                description={tr(
                  'timeoff.attendance.people_paid_comp',
                  '{{String}} people · {{duration}} paid · {{duration2}} comp{{value}}',
                  {
                    String: String(t.people),
                    duration: duration(t.paidMinutes),
                    duration2: duration(t.compMinutes),
                    value: t.waiting > 0 ? ` · ${String(t.waiting)} waiting` : '',
                  },
                )}
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
                          {tr('timeoff.attendance.remind', 'Remind')}
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
                {tr('timeoff.attendance.still_open', 'Still open')}
              </Text>
              <List>
                {load.data.late.map((l) => (
                  <ListItem
                    key={l.personId}
                    leading={<Avatar name={l.displayName} size={36} />}
                    description={[
                      l.openDays > 0
                        ? tr(
                            'timeoff.attendance.open_days',
                            { one: '{{count}} open day', other: '{{count}} open days' },
                            { count: l.openDays },
                          )
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
              {tr('timeoff.attendance.close', 'Close {{monthName}}', {
                monthName: monthName(month),
              })}
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
      path += tr(
        'timeoff.attendance.m_h_v1h_z',
        'M{{String}} {{String2}}h{{String3}}v1h-{{String3}}z',
        { String: String(start), String2: String(y), String3: String(x - start) },
      );
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
    <Page
      title={tr('timeoff.attendance.my_kiosk_code', 'My kiosk code')}
      back={{ label: tr('timeoff.attendance.time_off', 'Time off'), onPress: navigation.goBack }}
    >
      {failed !== null ? (
        <Failed
          message={failed}
          onRetry={() => {
            setFailed(null);
          }}
        />
      ) : qr === null ? (
        <Loading label={tr('timeoff.attendance.making_your_code', 'Making your code')} />
      ) : (
        <Card>
          <View className="items-center gap-2">
            <View className="rounded-m-card bg-white p-2">
              <Svg
                width={240}
                height={240}
                viewBox={`0 0 ${String(qr.size)} ${String(qr.size)}`}
                accessibilityLabel={tr('timeoff.attendance.your_kiosk_code', 'Your kiosk code')}
              >
                <Path d={qr.path} fill="#000" />
              </Svg>
            </View>
            <Text variant="footnote" tone="muted">
              {tr(
                'timeoff.attendance.show_it_to_the_kiosk_at',
                'Show it to the kiosk at the door. It changes every minute.',
              )}
            </Text>
          </View>
        </Card>
      )}
      {code === null ? null : (
        <Card>
          <Stack gap={2}>
            <Text weight="semibold">{tr('timeoff.attendance.your_pin', 'Your PIN')}</Text>
            <PinInput
              label={tr(
                'timeoff.attendance.six_digits_to_type_at_the',
                'Six digits to type at the kiosk instead',
              )}
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
                  tr('timeoff.attendance.pin_saved', 'PIN saved'),
                ).then(() => {
                  setPin('');
                });
              }}
            >
              {tr('timeoff.attendance.save_pin', 'Save PIN')}
            </Button>
          </Stack>
        </Card>
      )}
    </Page>
  );
}
