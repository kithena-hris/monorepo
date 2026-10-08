import {
  Alert,
  Avatar,
  Badge,
  Button,
  Calendar,
  Field,
  FieldLabel,
  Icon,
  List,
  ListItem,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Stat,
  Text,
  Textarea,
  type CalendarMarker,
  type DateRange,
} from '@reach/ui-native';
import { ArrowRight, Baby, Send, Sparkles } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { askTimeOff } from './api';
import { todayHere } from './time';
import { leaveIcon } from './icons';
import { addDays, amount, days, longSpan, shortDate, spanLabel } from './words';

interface LeaveType {
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly colorToken: string;
  readonly icon: string;
  readonly left: string | null;
  readonly unit: 'day' | 'hour';
  readonly tracked: boolean;
  readonly requiresNoteAfterDays: number | null;
}

interface Short {
  readonly date: string;
  readonly in: number;
  readonly of: number;
  readonly required: number;
  readonly below: boolean;
}

interface Preview {
  readonly approver: { readonly displayName: string; readonly personId: string } | null;
  readonly approvers: readonly string[];
  readonly balance: { readonly before: string; readonly after: string } | null;
  readonly belowMinimum: readonly Short[];
  readonly blocked: boolean;
  readonly daysAway: { readonly days: string; readonly from: string; readonly to: string };
  readonly negative: {
    readonly kind: 'fits' | 'borrow' | 'refused';
    readonly days: string | null;
    readonly limit: string | null;
    readonly approvers: readonly string[];
    readonly nextYearStartsAt: string | null;
    readonly unpaid: { readonly days: string } | null;
    readonly shorten: {
      readonly days: string;
      readonly to: string;
      readonly endsHalfDay: boolean;
    } | null;
  };
  readonly span: {
    readonly from: string;
    readonly to: string;
    readonly endsHalfDay: boolean;
    readonly workingDays: string;
  };
}

interface Team {
  readonly entries: readonly {
    personId: string;
    leaveTypeKey: string | null;
    span: { from: string; to: string };
  }[];
  readonly people: readonly { personId: string; displayName: string }[];
  readonly coverage: readonly Short[];
  readonly holidays: readonly { date: string; name: string }[];
}

type Step = 'type' | 'dates' | 'review';

/** "Send to Marco", "Send to Marco and HR", or "Send" when nobody approves it. */
function sendTo(preview: Preview | null): string {
  if (preview === null) return 'Send request';
  const names = preview.approvers.map((r) =>
    r === 'manager' && preview.approver !== null
      ? (preview.approver.displayName.split(' ')[0] ?? preview.approver.displayName)
      : r === 'hr'
        ? 'HR'
        : 'your manager',
  );
  return names.length === 0 ? 'Send' : `Send to ${names.join(' and ')}`;
}

const leftOf = (t: LeaveType): string =>
  t.left === null
    ? t.category === 'sick_leave'
      ? 'Paid · tell your manager today'
      : 'Not taken from a balance'
    : t.unit === 'hour'
      ? `${amount(t.left)}h banked`
      : `${days(t.left)} left`;

/**
 * Asking for time off (design MT5–MT7, MT9): the type with the balance
 * beside each, the dates on a calendar with teammates' days off and the
 * team's short days on it before anything is chosen, then the review — how
 * much is left, who else is off, whether it causes a problem, and below
 * zero, the choice to borrow or shorten. Describe it instead asks Time Off
 * for the best dates.
 */
export function TimeOffRequest({
  navigation,
  route,
}: PeopleScreen<'TimeOffRequest'>): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct('timeoff');
  const [type, setType] = useState<string | null>(route.params?.leaveTypeKey ?? null);
  const [range, setRange] = useState<DateRange>({
    start: route.params?.from ?? null,
    end: route.params?.to ?? route.params?.from ?? null,
  });
  const [half, setHalf] = useState(false);
  const [step, setStep] = useState<Step>(
    route.params?.from !== undefined ? 'review' : type === null ? 'type' : 'dates',
  );
  const [month, setMonth] = useState((route.params?.from ?? todayHere()).slice(0, 7));
  const [types, setTypes] = useState<readonly LeaveType[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const today = todayHere();
  const dated = type !== null && range.start !== null && range.end !== null;

  // The panel: the types, and what the dates would cost.
  useEffect(() => {
    let live = true;
    setPreview(null);
    setProblem(null);
    void askTimeOff<{ leaveTypes: LeaveType[]; preview: Preview | null }>(
      signed,
      'TimeOffRequestPanel',
      dated
        ? { leaveTypeKey: type, from: range.start, to: range.end, endsHalfDay: half }
        : type === null
          ? {}
          : { leaveTypeKey: type },
    ).then((answer) => {
      if (!live) return;
      if (!answer.ok) {
        if (types === null) setFailed(answer.message);
        else setProblem(answer.message);
        return;
      }
      setTypes(answer.data.leaveTypes);
      setPreview(answer.data.preview);
    });
    return () => {
      live = false;
    };
  }, [signed, type, range.start, range.end, half]);

  // The team's month: who is off and the days already short.
  useEffect(() => {
    let live = true;
    void Promise.all([
      askTimeOff<Team>(signed, 'TimeOffCalendarMonth', { month, scope: 'team' }),
      askTimeOff<{ holidays: { date: string; name: string }[] }>(signed, 'TimeOffHolidays', {
        year: Number(month.slice(0, 4)),
      }),
      askTimeOff<{ member: { personId: string } | null }>(signed, 'TimeOffOverview'),
    ]).then(([t, h, o]) => {
      if (!live) return;
      setTeam(t.ok ? { ...t.data, holidays: h.ok ? h.data.holidays : [] } : null);
      setMe(o.ok ? (o.data.member?.personId ?? null) : null);
    });
    return () => {
      live = false;
    };
  }, [signed, month]);

  const back =
    step === 'type'
      ? { label: 'Time off', onPress: navigation.goBack }
      : {
          label: step === 'review' ? 'Dates' : 'Type',
          onPress: () => {
            setStep(step === 'review' ? 'dates' : 'type');
          },
        };
  if (failed !== null) {
    return (
      <Page title="Request time off" back={back}>
        <Failed
          message={failed}
          onRetry={() => {
            setFailed(null);
          }}
        />
      </Page>
    );
  }
  if (types === null) {
    return (
      <Page title="Request time off" back={back}>
        <Loading label="Loading your leave types" />
      </Page>
    );
  }
  const chosen = types.find((t) => t.key === type) ?? null;
  const name = (personId: string): string =>
    team?.people.find((p) => p.personId === personId)?.displayName ?? 'Someone';
  const typeName = (key: string | null): string | null =>
    types.find((t) => t.key === key)?.name ?? null;

  if (step === 'type') {
    return (
      <Page title="Request time off" back={back}>
        <Button
          variant="ghost"
          startIcon={<Icon icon={Sparkles} />}
          onPress={() => {
            navigation.navigate('TimeOffDescribe');
          }}
        >
          Describe it instead
        </Button>
        <RadioGroup
          accessibilityLabel="Type"
          value={type ?? undefined}
          onValueChange={(key) => {
            setType(key);
            setStep('dates');
          }}
        >
          {types
            .filter((t) => t.category !== 'parental_leave')
            .map((t) => (
              <RadioCard key={t.key} value={t.key} icon={leaveIcon(t.icon)} description={leftOf(t)}>
                {t.name}
              </RadioCard>
            ))}
        </RadioGroup>
        {types.some((t) => t.category === 'parental_leave') ? (
          <List>
            <ListItem
              icon={Baby}
              description="Opens the planner"
              chevron
              onPress={() => {
                navigation.navigate('TimeOffParental');
              }}
            >
              Parental leave
            </ListItem>
          </List>
        ) : null}
      </Page>
    );
  }

  if (step === 'dates') {
    const markers: Record<string, CalendarMarker> = {};
    for (const e of team?.entries ?? []) {
      if (e.personId === me) continue;
      for (let d = e.span.from; d <= e.span.to; d = addDays(d, 1))
        markers[d] = { tone: 'info', label: `${name(e.personId)} off` };
    }
    for (const h of team?.holidays ?? []) markers[h.date] = { tone: 'neutral', label: h.name };
    for (const c of [
      ...(team?.coverage ?? []).filter((x) => x.below),
      ...(preview?.belowMinimum ?? []),
    ]) {
      markers[c.date] = {
        tone: 'danger',
        label: `${String(c.in)} of ${String(c.of)} in, below the team minimum`,
      };
    }
    return (
      <Page
        title={chosen?.name ?? 'Dates'}
        back={back}
        foot={
          <>
            <View className="flex-1 justify-center">
              <Text weight="semibold">
                {range.start === null || range.end === null
                  ? 'No dates yet'
                  : spanLabel(range.start, range.end)}
              </Text>
              <Text variant="footnote" tone="muted">
                {preview === null
                  ? 'Pick the first and last day'
                  : [
                      days(preview.span.workingDays),
                      preview.balance === null
                        ? null
                        : `${amount(preview.balance.after)} left after`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </Text>
            </View>
            <Button
              variant="primary"
              endIcon={<Icon icon={ArrowRight} />}
              disabled={preview === null}
              onPress={() => {
                setStep('review');
              }}
            >
              Next
            </Button>
          </>
        }
      >
        <Calendar
          mode="range"
          label="Dates off"
          today={today}
          month={`${month}-01`}
          onMonthChange={(m) => {
            setMonth(m.slice(0, 7));
          }}
          selected={range}
          onSelect={setRange}
          markers={markers}
        />
        <SegmentedControl
          fullWidth
          size="sm"
          accessibilityLabel="Length"
          value={half ? 'half' : 'full'}
          onValueChange={(v) => {
            setHalf(v === 'half');
          }}
        >
          <SegmentedControlItem value="full">Full days</SegmentedControlItem>
          <SegmentedControlItem value="half">Half the last day</SegmentedControlItem>
        </SegmentedControl>
        <Text variant="footnote" tone="muted">
          Blue dots are teammates who are off, grey are holidays, red is a day already short.
        </Text>
        {problem === null ? null : (
          <Alert tone="danger" title="Those dates cannot be asked for">
            {problem}
          </Alert>
        )}
      </Page>
    );
  }

  // The review (MT7, MT9).
  const approver = preview?.approver?.displayName.split(' ')[0] ?? null;
  const refused = preview !== null && (preview.blocked || preview.negative.kind === 'refused');
  const others =
    preview === null
      ? []
      : (team?.entries ?? []).filter(
          (e) =>
            e.personId !== me && e.span.from <= preview.span.to && e.span.to >= preview.span.from,
        );
  return (
    <Page
      title="Review"
      back={back}
      foot={
        <Button
          className="flex-1"
          fullWidth
          variant="primary"
          startIcon={<Icon icon={Send} />}
          disabled={preview === null || refused || chosen === null}
          loading={busy === 'RequestTimeOff'}
          onPress={() => {
            if (preview === null || chosen === null) return;
            void act<{ requestId: string }>(
              'RequestTimeOff',
              {
                input: {
                  leaveTypeKey: chosen.key,
                  span: {
                    from: preview.span.from,
                    to: preview.span.to,
                    startsHalfDay: false,
                    endsHalfDay: half,
                  },
                  note: note.trim() === '' ? null : note.trim(),
                },
              },
              'Sent',
            ).then((sent) => {
              if (sent !== null)
                navigation.replace('TimeOffRequestDetail', { requestId: sent.requestId });
            });
          }}
        >
          {sendTo(preview)}
        </Button>
      }
    >
      {preview === null || chosen === null ? (
        problem === null ? (
          <Loading label="Working out what it costs" />
        ) : (
          <Alert tone="danger" title="Those dates cannot be asked for">
            {problem}
          </Alert>
        )
      ) : (
        <>
          <Stat
            label="You’ll be off"
            icon={<Icon icon={leaveIcon(chosen.icon)} />}
            value={longSpan(preview.span.from, preview.span.to)}
            description={`${chosen.name} · ${days(preview.span.workingDays)} · ${days(preview.daysAway.days)} away`}
          />
          {preview.balance === null ? null : (
            <Stat
              label={`${chosen.name} left`}
              from={amount(preview.balance.before)}
              value={amount(preview.balance.after).replace(/^-/, '−')}
              unit={chosen.unit === 'hour' ? 'hours' : 'days'}
            />
          )}
          {preview.negative.kind === 'fits' ? null : (
            <BelowZero
              preview={preview}
              approver={approver}
              onShorten={(to, endsHalfDay) => {
                setRange({ start: preview.span.from, end: to });
                setHalf(endsHalfDay);
              }}
            />
          )}
          {preview.belowMinimum.map((c) => (
            <Alert
              key={c.date}
              tone={preview.blocked ? 'danger' : 'warning'}
              title={`${shortDate(c.date)}: only ${String(c.in)} of ${String(c.of)} would be in`}
            >
              {`Your team asks for at least ${String(c.required)}. ${
                preview.blocked
                  ? 'Your team does not take requests below its minimum, so pick other dates.'
                  : approver === null
                    ? 'It can still be approved.'
                    : `${approver} can still approve it.`
              }`}
            </Alert>
          ))}
          {others.length === 0 ? null : (
            <>
              <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
                Who else is off
              </Text>
              <List>
                {others.map((o) => (
                  <ListItem
                    key={`${o.personId}${o.span.from}`}
                    leading={<Avatar name={name(o.personId)} size={36} />}
                    description={spanLabel(o.span.from, o.span.to)}
                    trailing={<Badge size="sm">{typeName(o.leaveTypeKey) ?? 'Off'}</Badge>}
                  >
                    {name(o.personId)}
                  </ListItem>
                ))}
              </List>
            </>
          )}
          {preview.approvers.length === 0 ? null : (
            <Field>
              <FieldLabel>
                {approver === null ? 'Note (optional)' : `Note for ${approver} (optional)`}
              </FieldLabel>
              <Textarea
                value={note}
                onChange={setNote}
                placeholder={`Anything ${approver ?? 'your approver'} should know`}
              />
            </Field>
          )}
        </>
      )}
    </Page>
  );
}

/** Below zero is a choice, not an error (MT9): borrow, go unpaid or shorten, each with its cost in one line. */
function BelowZero({
  preview,
  approver,
  onShorten,
}: {
  preview: Preview;
  approver: string | null;
  onShorten: (to: string, endsHalfDay: boolean) => void;
}): React.JSX.Element {
  const { negative, span } = preview;
  const below = preview.balance === null ? '' : amount(preview.balance.after).replace(/^-/, '');
  const nextYear = String(Number(span.from.slice(0, 4)) + 1);
  const who = negative.approvers
    .map((r) => (r === 'manager' ? (approver ?? 'Your manager') : 'HR'))
    .join(' and ');
  const [choice, setChoice] = useState(negative.kind === 'borrow' ? 'borrow' : '');
  return (
    <Stack gap={3}>
      {negative.kind === 'borrow' ? (
        <Alert tone="warning" title={`This takes you ${below} days below zero`}>
          {`You can borrow up to the company’s limit from next year’s allowance. ${who} need to approve it.`}
        </Alert>
      ) : (
        <Alert
          tone="danger"
          title={`This goes past the ${amount(negative.limit ?? '0')} days you can go below zero`}
        >
          Shorten it to dates that fit, or ask HR.
        </Alert>
      )}
      <RadioGroup
        accessibilityLabel="What to do"
        value={choice}
        onValueChange={(v) => {
          setChoice(v);
          if (v === 'shorten' && negative.shorten !== null)
            onShorten(negative.shorten.to, negative.shorten.endsHalfDay);
        }}
      >
        {negative.kind === 'borrow' ? (
          <RadioCard
            value="borrow"
            badge={
              <Badge size="sm" tone="accent">
                Suggested
              </Badge>
            }
            description={`You keep all ${amount(span.workingDays)} days as paid time off.`}
            impact={`${nextYear} starts at ${amount(negative.nextYearStartsAt ?? '0')}`}
          >
            {`Borrow ${amount(negative.days ?? '0')} days from ${nextYear}`}
          </RadioCard>
        ) : null}
        {negative.unpaid === null ? null : (
          <RadioCard
            value="unpaid"
            disabled
            description="Not offered here yet: Time Off cannot split one request into paid and unpaid days. Ask HR."
          >
            {`Make ${amount(negative.unpaid.days)} days unpaid`}
          </RadioCard>
        )}
        {negative.shorten === null ? null : (
          <RadioCard
            value="shorten"
            description={`${days(negative.shorten.days)} fits your balance.`}
            impact="Nothing borrowed"
          >
            {`Shorten to ${spanLabel(span.from, negative.shorten.to)}${negative.shorten.endsHalfDay ? ', half the last day' : ''}`}
          </RadioCard>
        )}
      </RadioGroup>
    </Stack>
  );
}
