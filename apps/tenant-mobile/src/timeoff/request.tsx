import {
  Alert,
  AssistantMark,
  Avatar,
  Badge,
  Button,
  Calendar,
  Chip,
  Field,
  FieldLabel,
  Icon,
  List,
  ListItem,
  RadioCard,
  RadioGroup,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Stat,
  Text,
  Textarea,
  type CalendarMarker,
  type DateRange,
} from '@reach/ui-native';
import { ArrowRight, Baby, Send } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import { keptAnswer, read, useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { useTimeOff } from './api';
import type { Described } from './describe';
import { todayHere } from './time';
import { leaveIcon } from './icons';
import { addDays, amount, days, longSpan, shortDate, spanLabel } from './words';
import { t as tr } from '../i18n';

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
  if (preview === null) return tr('timeoff.request.send_request', 'Send request');
  const names = preview.approvers.map((r) =>
    r === 'manager' && preview.approver !== null
      ? (preview.approver.displayName.split(' ')[0] ?? preview.approver.displayName)
      : r === 'hr'
        ? 'HR'
        : 'your manager',
  );
  return names.length === 0
    ? 'Send'
    : tr('timeoff.request.send_to', 'Send to {{join}}', { join: names.join(' and ') });
}

const leftOf = (t: LeaveType): string =>
  t.left === null
    ? t.category === 'sick_leave'
      ? tr('timeoff.request.paid_tell_your_manager_today', 'Paid · tell your manager today')
      : tr('timeoff.request.not_taken_from_a_balance', 'Not taken from a balance')
    : t.unit === 'hour'
      ? `${amount(t.left)}h banked`
      : `${days(t.left)} left`;

/**
 * The month's best dates for this type, as they come: one tap puts them on
 * the calendar. Time Off ranks them by what they cost and what the team can
 * spare; the assistant only words them.
 */
function DateSuggestions({
  leaveTypeKey,
  month,
  onPick,
}: {
  leaveTypeKey: string;
  month: string;
  onPick: (from: string, to: string) => void;
}): React.JSX.Element | null {
  const { load } = useTimeOff<Described>('TimeOffDescribe', { leaveTypeKey, month });
  if (load.status !== 'ready' || load.data.options.length === 0) return null;
  return (
    <Stack gap={2}>
      <View className="flex-row items-center gap-2">
        <AssistantMark size={16} />
        <Text variant="footnote" weight="semibold" tone="muted">
          {tr('timeoff.request.kithena_suggests', 'Kithena suggests')}
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {load.data.options.slice(0, 4).map((o) => (
          <Chip
            key={`${o.from}${o.to}`}
            onPress={() => {
              onPick(o.from, o.to);
            }}
          >
            {tr('timeoff.request.off', '{{spanLabel}} · {{String}} → {{String2}} off', {
              spanLabel: spanLabel(o.from, o.to),
              String: String(o.used),
              String2: String(o.away.days),
            })}
          </Chip>
        ))}
      </View>
    </Stack>
  );
}

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
  const [types, setTypes] = useState<readonly LeaveType[] | null>(
    () =>
      keptAnswer<{ leaveTypes: LeaveType[] }>(signed, 'TimeOffRequestPanel', {}, 'timeoff')?.data
        .leaveTypes ?? null,
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [described, setDescribed] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const today = todayHere();
  const dated = type !== null && range.start !== null && range.end !== null;

  // The panel: the types, and what the dates would cost.
  useEffect(() => {
    let live = true;
    setPreview(null);
    setProblem(null);
    void read<{ leaveTypes: LeaveType[]; preview: Preview | null }>(
      signed,
      'TimeOffRequestPanel',
      dated
        ? { leaveTypeKey: type, from: range.start, to: range.end, endsHalfDay: half }
        : type === null
          ? {}
          : { leaveTypeKey: type },
      'timeoff',
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
      read<Team>(signed, 'TimeOffCalendarMonth', { month, scope: 'team' }, 'timeoff'),
      read<{ holidays: { date: string; name: string }[] }>(
        signed,
        'TimeOffHolidays',
        { year: Number(month.slice(0, 4)) },
        'timeoff',
      ),
      read<{ member: { personId: string } | null }>(signed, 'TimeOffOverview', {}, 'timeoff'),
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
      ? { label: tr('timeoff.request.time_off', 'Time off'), onPress: navigation.goBack }
      : {
          label:
            step === 'review'
              ? tr('timeoff.request.dates', 'Dates')
              : tr('timeoff.request.type', 'Type'),
          onPress: () => {
            setStep(step === 'review' ? 'dates' : 'type');
          },
        };
  if (failed !== null) {
    return (
      <Page title={tr('timeoff.request.request_time_off', 'Request time off')} back={back}>
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
      <Page title={tr('timeoff.request.request_time_off', 'Request time off')} back={back}>
        <Loading
          label={tr('timeoff.request.loading_your_leave_types', 'Loading your leave types')}
        />
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
      <Page title={tr('timeoff.request.request_time_off', 'Request time off')} back={back}>
        <SearchField
          value={described}
          onValueChange={setDescribed}
          onSearch={(sentence) => {
            navigation.navigate(
              'TimeOffDescribe',
              sentence.trim() === '' ? undefined : { sentence: sentence.trim() },
            );
          }}
          placeholder={tr(
            'timeoff.request.or_describe_it_a_week_off',
            'Or describe it: a week off in March',
          )}
          label={tr('timeoff.request.describe_the_time_off', 'Describe the time off')}
        />
        <RadioGroup
          accessibilityLabel={tr('timeoff.request.type', 'Type')}
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
              description={tr('timeoff.request.opens_the_planner', 'Opens the planner')}
              chevron
              onPress={() => {
                navigation.navigate('TimeOffParental');
              }}
            >
              {tr('timeoff.request.parental_leave', 'Parental leave')}
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
        markers[d] = {
          tone: 'info',
          label: tr('timeoff.request.off_2', '{{name}} off', { name: name(e.personId) }),
        };
    }
    for (const h of team?.holidays ?? []) markers[h.date] = { tone: 'neutral', label: h.name };
    for (const c of [
      ...(team?.coverage ?? []).filter((x) => x.below),
      ...(preview?.belowMinimum ?? []),
    ]) {
      markers[c.date] = {
        tone: 'danger',
        label: tr(
          'timeoff.request.of_in_below_the_team_minimum',
          '{{String}} of {{String2}} in, below the team minimum',
          { String: String(c.in), String2: String(c.of) },
        ),
      };
    }
    return (
      <Page
        title={chosen?.name ?? tr('timeoff.request.dates', 'Dates')}
        back={back}
        foot={
          <>
            <View className="flex-1 justify-center">
              <Text weight="semibold">
                {range.start === null || range.end === null
                  ? tr('timeoff.request.no_dates_yet', 'No dates yet')
                  : spanLabel(range.start, range.end)}
              </Text>
              <Text variant="footnote" tone="muted">
                {preview === null
                  ? tr('timeoff.request.pick_the_first_and_last_day', 'Pick the first and last day')
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
              {tr('timeoff.request.next', 'Next')}
            </Button>
          </>
        }
      >
        {type === null ? null : (
          <DateSuggestions
            leaveTypeKey={type}
            month={month}
            onPick={(from, to) => {
              setRange({ start: from, end: to });
            }}
          />
        )}
        <Calendar
          mode="range"
          label={tr('timeoff.request.dates_off', 'Dates off')}
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
          accessibilityLabel={tr('timeoff.request.length', 'Length')}
          value={half ? 'half' : 'full'}
          onValueChange={(v) => {
            setHalf(v === 'half');
          }}
        >
          <SegmentedControlItem value="full">
            {tr('timeoff.request.full_days', 'Full days')}
          </SegmentedControlItem>
          <SegmentedControlItem value="half">
            {tr('timeoff.request.half_the_last_day', 'Half the last day')}
          </SegmentedControlItem>
        </SegmentedControl>
        <Text variant="footnote" tone="muted">
          {tr(
            'timeoff.request.blue_dots_are_teammates_who_are',
            'Blue dots are teammates who are off, grey are holidays, red is a day already short.',
          )}
        </Text>
        {problem === null ? null : (
          <Alert
            tone="danger"
            title={tr(
              'timeoff.request.those_dates_cannot_be_asked_for',
              'Those dates cannot be asked for',
            )}
          >
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
      title={tr('timeoff.request.review', 'Review')}
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
          <Loading
            label={tr('timeoff.request.working_out_what_it_costs', 'Working out what it costs')}
          />
        ) : (
          <Alert
            tone="danger"
            title={tr(
              'timeoff.request.those_dates_cannot_be_asked_for',
              'Those dates cannot be asked for',
            )}
          >
            {problem}
          </Alert>
        )
      ) : (
        <>
          <Stat
            label={tr('timeoff.request.youll_be_off', 'You’ll be off')}
            icon={<Icon icon={leaveIcon(chosen.icon)} />}
            value={longSpan(preview.span.from, preview.span.to)}
            description={tr('timeoff.request.away', '{{name}} · {{days}} · {{days2}} away', {
              name: chosen.name,
              days: days(preview.span.workingDays),
              days2: days(preview.daysAway.days),
            })}
          />
          {preview.balance === null ? null : (
            <Stat
              label={tr('timeoff.request.left', '{{name}} left', { name: chosen.name })}
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
              title={tr(
                'timeoff.request.only_of_would_be_in',
                '{{shortDate}}: only {{String}} of {{String2}} would be in',
                { shortDate: shortDate(c.date), String: String(c.in), String2: String(c.of) },
              )}
            >
              {tr(
                'timeoff.request.your_team_asks_for_at_least',
                'Your team asks for at least {{String}}. {{value}}',
                {
                  String: String(c.required),
                  value: preview.blocked
                    ? 'Your team does not take requests below its minimum, so pick other dates.'
                    : approver === null
                      ? 'It can still be approved.'
                      : `${approver} can still approve it.`,
                },
              )}
            </Alert>
          ))}
          {others.length === 0 ? null : (
            <>
              <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
                {tr('timeoff.request.who_else_is_off', 'Who else is off')}
              </Text>
              <List>
                {others.map((o) => (
                  <ListItem
                    key={`${o.personId}${o.span.from}`}
                    leading={<Avatar name={name(o.personId)} size={36} />}
                    description={spanLabel(o.span.from, o.span.to)}
                    trailing={
                      <Badge size="sm">
                        {typeName(o.leaveTypeKey) ?? tr('timeoff.request.off_3', 'Off')}
                      </Badge>
                    }
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
                {approver === null
                  ? tr('timeoff.request.note_optional', 'Note (optional)')
                  : tr('timeoff.request.note_for_optional', 'Note for {{approver}} (optional)', {
                      approver,
                    })}
              </FieldLabel>
              <Textarea
                value={note}
                onChange={setNote}
                placeholder={tr(
                  'timeoff.request.anything_should_know',
                  'Anything {{value}} should know',
                  { value: approver ?? 'your approver' },
                )}
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
    .map((r) =>
      r === 'manager' ? (approver ?? tr('timeoff.request.your_manager', 'Your manager')) : 'HR',
    )
    .join(' and ');
  const [choice, setChoice] = useState(negative.kind === 'borrow' ? 'borrow' : '');
  return (
    <Stack gap={3}>
      {negative.kind === 'borrow' ? (
        <Alert
          tone="warning"
          title={tr(
            'timeoff.request.this_takes_you_days_below_zero',
            'This takes you {{below}} days below zero',
            { below },
          )}
        >
          {tr(
            'timeoff.request.you_can_borrow_up_to_the',
            'You can borrow up to the company’s limit from next year’s allowance. {{who}} need to approve it.',
            { who },
          )}
        </Alert>
      ) : (
        <Alert
          tone="danger"
          title={tr(
            'timeoff.request.this_goes_past_the_days_you',
            'This goes past the {{amount}} days you can go below zero',
            { amount: amount(negative.limit ?? '0') },
          )}
        >
          {tr(
            'timeoff.request.shorten_it_to_dates_that_fit',
            'Shorten it to dates that fit, or ask HR.',
          )}
        </Alert>
      )}
      <RadioGroup
        accessibilityLabel={tr('timeoff.request.what_to_do', 'What to do')}
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
                {tr('timeoff.request.suggested', 'Suggested')}
              </Badge>
            }
            description={tr(
              'timeoff.request.you_keep_all_days_as_paid',
              'You keep all {{amount}} days as paid time off.',
              { amount: amount(span.workingDays) },
            )}
            impact={`${nextYear} starts at ${amount(negative.nextYearStartsAt ?? '0')}`}
          >
            {tr('timeoff.request.borrow_days_from', 'Borrow {{amount}} days from {{nextYear}}', {
              amount: amount(negative.days ?? '0'),
              nextYear,
            })}
          </RadioCard>
        ) : null}
        {negative.unpaid === null ? null : (
          <RadioCard
            value="unpaid"
            disabled
            description={tr(
              'timeoff.request.not_offered_here_yet_time_off',
              'Not offered here yet: Time Off cannot split one request into paid and unpaid days. Ask HR.',
            )}
          >
            {tr('timeoff.request.make_days_unpaid', 'Make {{amount}} days unpaid', {
              amount: amount(negative.unpaid.days),
            })}
          </RadioCard>
        )}
        {negative.shorten === null ? null : (
          <RadioCard
            value="shorten"
            description={tr('timeoff.request.fits_your_balance', '{{days}} fits your balance.', {
              days: days(negative.shorten.days),
            })}
            impact="Nothing borrowed"
          >
            {tr('timeoff.request.shorten_to', 'Shorten to {{spanLabel}}{{value}}', {
              spanLabel: spanLabel(span.from, negative.shorten.to),
              value: negative.shorten.endsHalfDay ? ', half the last day' : '',
            })}
          </RadioCard>
        )}
      </RadioGroup>
    </Stack>
  );
}
