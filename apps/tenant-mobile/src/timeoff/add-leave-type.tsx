import {
  Alert,
  AssistantMark,
  Button,
  Card,
  CardTitle,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Icon,
  Input,
  List,
  ListItem,
  NumberField,
  Progress,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Stat,
  StepperProgress,
  Switch,
  Text,
  Textarea,
} from '@reach/ui-native';
import { ArrowLeft, ArrowRight, Send, Sparkles } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Loading, Page } from '../frame';
import { useAct } from '../people/act';
import { read, useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { useTimeOff } from './api';
import { leaveIcon } from './icons';
import { CATEGORIES, keyOf } from './leave-kinds';
import { todayHere } from './time';
import { amount, shortDate } from './words';
import { t } from '../i18n';

type Step = 'what' | 'balance' | 'rules' | 'preview';

interface Preview {
  readonly members: readonly {
    personId: string;
    displayName: string;
    allowance: { current: string; draft: string };
    left: { current: string; draft: string };
  }[];
}

const days = (n: number): string => n.toFixed(3);

/** A policy as Time Off's reader understood it (T32): only what the steps use, and the rest kept. */
interface ReadPolicy {
  readonly allowance: readonly { fromYears: number; days: string }[];
  readonly earning: string;
  readonly proRata: boolean;
  readonly probationMonths: number;
  readonly carryOver: { maxDays: string; useBy: { day: number; month: number } } | null;
  readonly [more: string]: unknown;
}

interface PolicyRead {
  readonly definition: ReadPolicy | null;
  readonly problems: readonly { path: string; message: string }[];
  readonly question: {
    key: string;
    title: string;
    body: { text: string; ai: boolean };
    options: readonly { label: string; value: string }[];
  } | null;
}

/**
 * Adding a leave type, a step at a time (T29–T31 in one flow): what it is,
 * the balance it comes from, its rules, and last an example — how it shows
 * on a phone and what it gives each person — before it is published. Nothing
 * reaches anyone until Publish; leaving halfway keeps a draft to come back to.
 */
export function TimeOffAddLeaveType({
  navigation,
}: PeopleScreen<'TimeOffAddLeaveType'>): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const [step, setStep] = useState<Step>('what');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [paid, setPaid] = useState('paid');
  const [hidden, setHidden] = useState(false);
  const [tracked, setTracked] = useState(true);
  const [hours, setHours] = useState(false);
  const [allowance, setAllowance] = useState(12);
  const [earning, setEarning] = useState<'upfront' | 'monthly'>('upfront');
  const [proRata, setProRata] = useState(true);
  const [carry, setCarry] = useState(0);
  const [probation, setProbation] = useState(0);
  const [from, setFrom] = useState<string | null>(todayHere());
  // Written once the preview is asked for: the type, then its draft policy.
  const [defined, setDefined] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState<string | null>(null);
  // Kithena filling the steps in from a description: what it read, and what it asks.
  const signed = useSigned();
  const [described, setDescribed] = useState('');
  const [reading, setReading] = useState(false);
  const [unread, setUnread] = useState<string | null>(null);
  const [question, setQuestion] = useState<{
    asked: Record<string, unknown>;
    is: NonNullable<PolicyRead['question']>;
  } | null>(null);
  const [understood, setUnderstood] = useState<ReadPolicy | null>(null);

  const key = defined ?? keyOf(name);
  const sick = category === 'sick_leave';
  const steps: readonly Step[] = tracked
    ? ['what', 'balance', 'rules', 'preview']
    : ['what', 'balance', 'preview'];
  const at = steps.indexOf(step);
  const policyOf = (
    base: ReadPolicy | null,
    v: { allowance: number; earning: string; proRata: boolean; probation: number; carry: number },
  ) => ({
    // What the reader understood beyond the steps (tenure bands, going below
    // zero, the leave year) stays, unless a step changed it.
    ...base,
    leaveTypeKey: key,
    allowance:
      base !== null && Number(base.allowance[0]?.days ?? NaN) === v.allowance
        ? base.allowance
        : [{ fromYears: 0, days: days(v.allowance) }],
    earning: v.earning,
    proRata: v.proRata,
    probationMonths: v.probation,
    carryOver:
      v.carry === 0
        ? null
        : { maxDays: days(v.carry), useBy: base?.carryOver?.useBy ?? { month: 3, day: 31 } },
  });
  const definition = policyOf(understood, { allowance, earning, proRata, probation, carry });

  /** The type and its draft, written or brought up to date, before the example is shown. */
  const prepare = async (policy: ReturnType<typeof policyOf> = definition): Promise<boolean> => {
    if (defined === null) {
      const done = await act<{ key: string }>('DefineTimeOffLeaveType', {
        input: {
          key,
          name: { default: name.trim() },
          category,
          colorToken: sick ? 'chart-3' : 'chart-4',
          icon: CATEGORIES().find(([c]) => c === category)?.[2] ?? 'flag',
          unit: hours ? 'hour' : 'day',
          tracked,
          paid,
          visibility: hidden || sick ? 'off_only' : 'type',
        },
      });
      if (done === null) return false;
      setDefined(done.key);
    }
    if (!tracked) return true;
    const drafted =
      policyId === null
        ? await act<{ policyId: string }>('DraftTimeOffPolicy', {
            input: { ...policy, leaveTypeKey: defined ?? key },
          })
        : await act('ReviseTimeOffPolicy', { policyId, input: policy }).then((d) =>
            d === null ? null : { policyId },
          );
    if (drafted === null) return false;
    setPolicyId(drafted.policyId);
    return true;
  };

  /**
   * Read the description, answer what it asks one question at a time, then
   * fill every step from it and go straight to the example. Time Off reads;
   * the model only says what it understood (T32), and nothing is saved until
   * the draft is written for the example.
   */
  const readIt = async (asked: Record<string, unknown>): Promise<void> => {
    setReading(true);
    setUnread(null);
    const answer = await read<PolicyRead>(signed, 'TimeOffPolicyRead', asked, 'timeoff');
    setReading(false);
    if (!answer.ok) {
      setUnread(answer.message);
      return;
    }
    const r = answer.data;
    if (r.question !== null) {
      setQuestion({ asked, is: r.question });
      return;
    }
    setQuestion(null);
    if (r.definition === null) {
      setUnread(
        r.problems[0]?.message ??
          t(
            'timeoff.add-leave-type.kithena_could_not_read_that_say',
            'Kithena could not read that. Say how many days a year, say.',
          ),
      );
      return;
    }
    const d = r.definition;
    const filled = {
      allowance: Number(d.allowance[0]?.days ?? '0'),
      earning: d.earning === 'monthly' ? 'monthly' : 'upfront',
      proRata: d.proRata,
      probation: d.probationMonths,
      carry: Number(d.carryOver?.maxDays ?? '0'),
    } as const;
    setUnderstood(d);
    setTracked(true);
    setAllowance(filled.allowance);
    setEarning(filled.earning);
    setProRata(filled.proRata);
    setProbation(filled.probation);
    setCarry(filled.carry);
    if (await prepare(policyOf(d, filled))) setStep('preview');
  };

  const next = (): void => {
    const following = steps[at + 1];
    if (following === undefined) return;
    if (following !== 'preview') {
      setStep(following);
      return;
    }
    void prepare().then((ok) => {
      if (ok) setStep('preview');
    });
  };
  const back =
    at === 0
      ? {
          label: t('timeoff.add-leave-type.leave_types', 'Leave types'),
          onPress: navigation.goBack,
        }
      : {
          label: t('timeoff.add-leave-type.back', 'Back'),
          onPress: () => {
            setStep(steps[at - 1] ?? 'what');
          },
        };
  const ready = step !== 'what' || (keyOf(name) !== '' && name.trim().length <= 60);

  return (
    <Page
      title={t('timeoff.add-leave-type.add_a_leave_type', 'Add a leave type')}
      back={back}
      foot={
        step === 'preview' ? (
          <Button
            variant="primary"
            fullWidth
            startIcon={<Icon icon={Send} />}
            disabled={tracked && from === null}
            loading={busy === 'PublishTimeOffPolicy'}
            onPress={() => {
              if (!tracked || policyId === null) {
                navigation.goBack();
                return;
              }
              if (from === null) return;
              void act(
                'PublishTimeOffPolicy',
                { policyId, input: { effectiveFrom: from } },
                `${name.trim()} is published`,
              ).then((done) => {
                if (done !== null) navigation.goBack();
              });
            }}
          >
            {tracked
              ? t('timeoff.add-leave-type.publish', 'Publish')
              : t('timeoff.add-leave-type.done', 'Done')}
          </Button>
        ) : (
          <>
            {at === 0 ? null : (
              <Button
                startIcon={<Icon icon={ArrowLeft} />}
                onPress={back.onPress}
                accessibilityLabel={t('timeoff.add-leave-type.back', 'Back')}
              />
            )}
            <Button
              variant="primary"
              className="flex-1"
              endIcon={<Icon icon={ArrowRight} />}
              disabled={!ready}
              loading={busy === 'DefineTimeOffLeaveType' || busy === 'DraftTimeOffPolicy'}
              onPress={next}
            >
              {steps[at + 1] === 'preview'
                ? t('timeoff.add-leave-type.see_an_example', 'See an example')
                : t('timeoff.add-leave-type.next', 'Next')}
            </Button>
          </>
        )
      }
    >
      <StepperProgress
        step={at + 1}
        count={steps.length}
        label={t('timeoff.add-leave-type.add_a_leave_type', 'Add a leave type')}
      />
      {step === 'what' ? (
        <Stack gap={3}>
          <Text variant="title2" accessibilityRole="header">
            {t('timeoff.add-leave-type.what_is_it', 'What is it?')}
          </Text>
          <Field required>
            <FieldLabel>{t('timeoff.add-leave-type.name', 'Name')}</FieldLabel>
            <Input
              value={name}
              onChange={setName}
              maxLength={60}
              readOnly={defined !== null}
              placeholder={t('timeoff.add-leave-type.personal_leave', 'Personal leave')}
            />
            <FieldDescription>
              {defined !== null
                ? t(
                    'timeoff.add-leave-type.already_added_rename_it_from_the',
                    'Already added; rename it from the leave type.',
                  )
                : name.trim() === ''
                  ? t(
                      'timeoff.add-leave-type.what_people_see_when_they_ask',
                      'What people see when they ask for it.',
                    )
                  : t('timeoff.add-leave-type.key', 'Key: {{keyOf}}', { keyOf: keyOf(name) })}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{t('timeoff.add-leave-type.kind', 'Kind')}</FieldLabel>
            <Select value={category} onValueChange={setCategory} disabled={defined !== null}>
              <SelectTrigger accessibilityLabel={t('timeoff.add-leave-type.kind', 'Kind')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES().map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {defined === null ? (
            <SegmentedControl
              fullWidth
              value={paid}
              accessibilityLabel={t('timeoff.add-leave-type.pay', 'Pay')}
              onValueChange={setPaid}
            >
              <SegmentedControlItem value="paid">
                {t('timeoff.add-leave-type.paid', 'Paid')}
              </SegmentedControlItem>
              <SegmentedControlItem value="unpaid">
                {t('timeoff.add-leave-type.unpaid', 'Unpaid')}
              </SegmentedControlItem>
            </SegmentedControl>
          ) : (
            <Text tone="muted">
              {paid === 'paid'
                ? t('timeoff.add-leave-type.paid', 'Paid')
                : t('timeoff.add-leave-type.unpaid', 'Unpaid')}
            </Text>
          )}
          <ListItem
            listitem={false}
            description={t(
              'timeoff.add-leave-type.teammates_see_only_off_sick_leave',
              'Teammates see only “Off”. Sick leave always is.',
            )}
            trailing={
              <Switch
                checked={hidden || sick}
                disabled={sick || defined !== null}
                accessibilityLabel={t('timeoff.add-leave-type.private', 'Private')}
                onCheckedChange={setHidden}
              />
            }
          >
            {t('timeoff.add-leave-type.private', 'Private')}
          </ListItem>
          {defined !== null ? null : (
            <Card>
              <Stack gap={2}>
                <View className="flex-row items-center gap-2">
                  <AssistantMark size={18} />
                  <Text variant="headline" className="flex-1">
                    {t(
                      'timeoff.add-leave-type.or_describe_it_and_kithena_fills',
                      'Or describe it, and Kithena fills in the rest',
                    )}
                  </Text>
                </View>
                <Textarea
                  value={described}
                  onChange={setDescribed}
                  placeholder={t(
                    'timeoff.add-leave-type.12_days_a_year_earned_monthly',
                    '12 days a year, earned monthly and pro rata. Up to 3 carried over to March. Not in the first 3 months.',
                  )}
                  accessibilityLabel={t(
                    'timeoff.add-leave-type.the_rules_as_you_would_explain',
                    'The rules, as you would explain them',
                  )}
                />
                {unread === null ? null : <Alert tone="warning">{unread}</Alert>}
                <Button
                  startIcon={<Icon icon={Sparkles} />}
                  disabled={!ready || described.trim() === ''}
                  loading={reading || busy !== null}
                  loadingLabel={t(
                    'timeoff.add-leave-type.kithena_is_reading_it',
                    'Kithena is reading it',
                  )}
                  onPress={() => {
                    void readIt({ text: described.trim() });
                  }}
                >
                  {t('timeoff.add-leave-type.fill_it_in_and_review', 'Fill it in and review')}
                </Button>
              </Stack>
            </Card>
          )}
        </Stack>
      ) : step === 'balance' ? (
        <Stack gap={3}>
          <Text variant="title2" accessibilityRole="header">
            {t('timeoff.add-leave-type.how_much_can_people_take', 'How much can people take?')}
          </Text>
          <ListItem
            listitem={false}
            description={t(
              'timeoff.add-leave-type.taken_from_an_allowance_that_time',
              'Taken from an allowance that Time Off keeps.',
            )}
            trailing={
              <Switch
                checked={tracked}
                disabled={defined !== null}
                accessibilityLabel={t('timeoff.add-leave-type.from_a_balance', 'From a balance')}
                onCheckedChange={setTracked}
              />
            }
          >
            {t('timeoff.add-leave-type.from_a_balance', 'From a balance')}
          </ListItem>
          {tracked ? (
            <>
              <ListItem
                listitem={false}
                description={t(
                  'timeoff.add-leave-type.counted_in_hours_not_days',
                  'Counted in hours, not days.',
                )}
                trailing={
                  <Switch
                    checked={hours}
                    disabled={defined !== null}
                    accessibilityLabel={t('timeoff.add-leave-type.in_hours', 'In hours')}
                    onCheckedChange={setHours}
                  />
                }
              >
                {t('timeoff.add-leave-type.in_hours', 'In hours')}
              </ListItem>
              <NumberField
                label={
                  hours
                    ? t('timeoff.add-leave-type.hours_a_year', 'Hours a year')
                    : t('timeoff.add-leave-type.days_a_year', 'Days a year')
                }
                min={0}
                max={365}
                step={0.5}
                value={allowance}
                onChange={(v) => {
                  setAllowance(v ?? 0);
                }}
              />
              <Field>
                <FieldLabel>{t('timeoff.add-leave-type.given', 'Given')}</FieldLabel>
                <SegmentedControl
                  fullWidth
                  value={earning}
                  accessibilityLabel={t('timeoff.add-leave-type.given', 'Given')}
                  onValueChange={(v) => {
                    setEarning(v === 'monthly' ? 'monthly' : 'upfront');
                  }}
                >
                  <SegmentedControlItem value="upfront">
                    {t('timeoff.add-leave-type.all_at_once', 'All at once')}
                  </SegmentedControlItem>
                  <SegmentedControlItem value="monthly">
                    {t('timeoff.add-leave-type.month_by_month', 'Month by month')}
                  </SegmentedControlItem>
                </SegmentedControl>
              </Field>
              <ListItem
                listitem={false}
                description={t(
                  'timeoff.add-leave-type.someone_joining_or_leaving_mid_year',
                  'Someone joining or leaving mid-year gets a share, rounded up to the half day.',
                )}
                trailing={
                  <Switch
                    checked={proRata}
                    accessibilityLabel={t('timeoff.add-leave-type.pro_rata', 'Pro rata')}
                    onCheckedChange={setProRata}
                  />
                }
              >
                {t('timeoff.add-leave-type.pro_rata', 'Pro rata')}
              </ListItem>
            </>
          ) : (
            <Text tone="muted">
              {t(
                'timeoff.add-leave-type.people_ask_for_it_and_their',
                'People ask for it and their manager decides; nothing is counted down.',
              )}
            </Text>
          )}
        </Stack>
      ) : step === 'rules' ? (
        <Stack gap={3}>
          <Text variant="title2" accessibilityRole="header">
            {t('timeoff.add-leave-type.any_rules', 'Any rules?')}
          </Text>
          <NumberField
            label={t(
              'timeoff.add-leave-type.carried_into_next_year_at_most',
              'Carried into next year, at most',
            )}
            min={0}
            max={365}
            step={0.5}
            value={carry}
            onChange={(v) => {
              setCarry(v ?? 0);
            }}
          />
          <Text variant="footnote" tone="muted">
            {t(
              'timeoff.add-leave-type.used_by_31_march_or_lost',
              'Used by 31 March, or lost. 0 carries nothing.',
            )}
          </Text>
          <NumberField
            label={t('timeoff.add-leave-type.probation_months', 'Probation, months')}
            min={0}
            max={24}
            value={probation}
            onChange={(v) => {
              setProbation(v ?? 0);
            }}
          />
          <Text variant="footnote" tone="muted">
            {t(
              'timeoff.add-leave-type.how_long_after_joining_before_it',
              'How long after joining before it can be booked.',
            )}
          </Text>
        </Stack>
      ) : (
        <Example
          name={name.trim()}
          category={category}
          hours={hours}
          tracked={tracked}
          allowance={allowance}
          earning={earning}
          proRata={proRata}
          carry={carry}
          probation={probation}
          policyId={policyId}
          from={from}
          onFrom={setFrom}
        />
      )}
      {question === null ? null : (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setQuestion(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{question.is.title}</DialogTitle>
              <DialogDescription>{question.is.body.text}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              {question.is.options.map((o) => (
                <Button
                  key={o.value}
                  fullWidth
                  loading={reading}
                  onPress={() => {
                    void readIt({ ...question.asked, [question.is.key]: o.value });
                  }}
                >
                  {o.label}
                </Button>
              ))}
            </DialogBody>
            <DialogFooter>
              <Button
                variant="ghost"
                onPress={() => {
                  setQuestion(null);
                }}
              >
                {t('timeoff.add-leave-type.fill_it_in_myself', 'Fill it in myself')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Page>
  );
}

/** The last step: the type as a person will see it, and what it gives each one. */
function Example({
  name,
  category,
  hours,
  tracked,
  allowance,
  earning,
  proRata,
  carry,
  probation,
  policyId,
  from,
  onFrom,
}: {
  name: string;
  category: string;
  hours: boolean;
  tracked: boolean;
  allowance: number;
  earning: 'upfront' | 'monthly';
  proRata: boolean;
  carry: number;
  probation: number;
  policyId: string | null;
  from: string | null;
  onFrom: (date: string | null) => void;
}): React.JSX.Element {
  const unit = hours ? 'hours' : 'days';
  const icon = CATEGORIES().find(([c]) => c === category)?.[2] ?? 'flag';
  return (
    <Stack gap={3}>
      <Text variant="title2" accessibilityRole="header">
        {t('timeoff.add-leave-type.how_it_will_look', 'How it will look')}
      </Text>
      <Card>
        <Stack gap={2}>
          <Text variant="footnote" weight="semibold" tone="muted">
            {t('timeoff.add-leave-type.on_someones_phone', 'On someone’s phone')}
          </Text>
          <Stat
            label={name}
            icon={<Icon icon={leaveIcon(icon)} />}
            value={
              tracked ? (hours ? `${amount(days(allowance))}h` : amount(days(allowance))) : '—'
            }
            unit={tracked ? (hours ? 'banked' : `${unit} left`) : 'not counted'}
            {...(tracked
              ? {
                  chart: (
                    <Progress
                      label={t('timeoff.add-leave-type.none_used_yet', '{{name}}: none used yet', {
                        name,
                      })}
                      value={0}
                      max={allowance}
                    />
                  ),
                  description: t('timeoff.add-leave-type.0_used_0_booked', '0 used · 0 booked'),
                }
              : {})}
          />
        </Stack>
      </Card>
      <List>
        {(tracked
          ? [
              `${amount(days(allowance))} ${unit} a year, ${earning === 'monthly' ? `about ${amount(days(allowance / 12))} each month` : 'all on the first day of the year'}`,
              proRata
                ? t(
                    'timeoff.add-leave-type.joining_or_leaving_mid_year_gets',
                    'Joining or leaving mid-year gets a share, rounded up to the half day',
                  )
                : t(
                    'timeoff.add-leave-type.joining_mid_year_still_gets_the',
                    'Joining mid-year still gets the whole year',
                  ),
              carry === 0
                ? t(
                    'timeoff.add-leave-type.nothing_carries_into_next_year',
                    'Nothing carries into next year',
                  )
                : t(
                    'timeoff.add-leave-type.up_to_carry_over_used_by',
                    'Up to {{amount}} {{unit}} carry over, used by 31 March',
                    { amount: amount(days(carry)), unit },
                  ),
              probation === 0
                ? t(
                    'timeoff.add-leave-type.can_be_booked_from_day_one',
                    'Can be booked from day one',
                  )
                : t(
                    'timeoff.add-leave-type.can_be_booked_after',
                    {
                      one: 'Can be booked after {{count}} month',
                      other: 'Can be booked after {{count}} months',
                    },
                    { count: probation },
                  ),
            ]
          : [
              t('timeoff.add-leave-type.not_counted_from_a_balance', 'Not counted from a balance'),
              t(
                'timeoff.add-leave-type.asked_for_and_approved_like_any',
                'Asked for and approved like any time off',
              ),
            ]
        ).map((line) => (
          <ListItem key={line}>{line}</ListItem>
        ))}
      </List>
      {tracked && policyId !== null ? <Members policyId={policyId} unit={unit} /> : null}
      {tracked ? (
        <DatePicker
          label={t('timeoff.add-leave-type.in_effect_from', 'In effect from')}
          value={from}
          onChange={onFrom}
        />
      ) : (
        <Alert tone="success" title={t('timeoff.add-leave-type.added', 'Added')}>
          {t('timeoff.add-leave-type.can_be_asked_for_now', '{{name}} can be asked for now.', {
            name,
          })}
        </Alert>
      )}
    </Stack>
  );
}

/** What publishing gives each person this year, from Time Off's own preview of the draft. */
function Members({ policyId, unit }: { policyId: string; unit: string }): React.JSX.Element {
  const { load } = useTimeOff<Preview>('TimeOffPolicyPreview', { policyId });
  if (load.status === 'loading')
    return (
      <Loading
        label={t(
          'timeoff.add-leave-type.working_out_each_persons_balance',
          'Working out each person’s balance',
        )}
      />
    );
  if (load.status === 'error') return <Text tone="muted">{load.message}</Text>;
  const members = load.data.members;
  return (
    <Card>
      <Stack gap={2}>
        <CardTitle>
          {t(
            'timeoff.add-leave-type.once_published_for',
            {
              one: 'Once published, for {{count}} person',
              other: 'Once published, for {{count}} people',
            },
            { count: members.length },
          )}
        </CardTitle>
        {members.length === 0 ? (
          <Text tone="muted">
            {t(
              'timeoff.add-leave-type.nobody_it_applies_to_works_here',
              'Nobody it applies to works here yet.',
            )}
          </Text>
        ) : (
          <View>
            {members.slice(0, 5).map((m) => (
              <ListItem
                key={m.personId}
                listitem={false}
                description={t(
                  'timeoff.add-leave-type.this_year',
                  '{{amount}} {{unit}} this year',
                  { amount: amount(m.allowance.draft), unit },
                )}
                trailing={
                  <Text className="tabular-nums">
                    {t('timeoff.add-leave-type.left', '{{amount}} left', {
                      amount: amount(m.left.draft),
                    })}
                  </Text>
                }
              >
                {m.displayName}
              </ListItem>
            ))}
            {members.length > 5 ? (
              <Text variant="footnote" tone="muted">
                {t('timeoff.add-leave-type.and_more', 'and {{String}} more', {
                  String: String(members.length - 5),
                })}
              </Text>
            ) : null}
          </View>
        )}
        <Text variant="footnote" tone="muted">
          {t(
            'timeoff.add-leave-type.worked_out_by_time_off_as',
            'Worked out by Time Off as of {{shortDate}}.',
            { shortDate: shortDate(todayHere()) },
          )}
        </Text>
      </Stack>
    </Card>
  );
}

/** What kind of leave a description is about, from its words. */
function categoryOf(text: string): string {
  if (/\bsick|ill(ness)?\b/iu.test(text)) return 'sick_leave';
  if (/\bparental|maternity|paternity|birth|adopt/iu.test(text)) return 'parental_leave';
  if (/\bunpaid\b/iu.test(text)) return 'unpaid_leave';
  if (/\bvacation|annual|holiday\b/iu.test(text)) return 'annual_leave';
  return 'other';
}

/**
 * A new leave type, described (design v3 S12): paste the handbook line or say
 * it. Time Off's reader drafts the rules and asks the one question the text
 * leaves open; Create writes the type and its draft policy, which then opens
 * to be checked and published. Edit rules is the step-by-step flow.
 */
export function DescribeLeaveTypeDialog({
  initial,
  onClose,
  onCreated,
  onSteps,
}: {
  initial: string;
  onClose: () => void;
  onCreated: (key: string, name: string) => void;
  onSteps: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct('timeoff');
  const [text, setText] = useState(initial);
  const [asked, setAsked] = useState<Record<string, unknown> | null>(null);
  const [answer, setAnswer] = useState<
    | (PolicyRead & { rules?: readonly { key: string; label: string; value: string }[] })
    | string
    | null
  >(null);
  const name = (text.split(/[:.,\n]/u)[0] ?? '').trim();
  const category = categoryOf(text);
  const unpaid = /\bunpaid\b/iu.test(text);

  const readIt = (with_: Record<string, unknown>): void => {
    setAsked(with_);
    setAnswer(null);
    void read<PolicyRead & { rules?: { key: string; label: string; value: string }[] }>(
      signed,
      'TimeOffPolicyRead',
      with_,
      'timeoff',
    ).then((a) => {
      setAnswer(a.ok ? a.data : a.message);
    });
  };
  // A description handed in from the list's box is read at once.
  useEffect(() => {
    if (initial.trim() !== '') readIt({ text: initial.trim() });
  }, []);
  const read_ = typeof answer === 'object' && answer !== null ? answer : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('timeoff.add-leave-type.new_leave_type', 'New leave type')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Textarea
            value={text}
            onChange={setText}
            placeholder={t(
              'timeoff.add-leave-type.bereavement_5_paid_days_for_close',
              'Bereavement: 5 paid days for close family, 2 for anyone else. No approval, just tell the manager.',
            )}
            accessibilityLabel={t(
              'timeoff.add-leave-type.describe_the_leave',
              'Describe the leave',
            )}
          />
          <Button
            size="sm"
            disabled={text.trim() === '' || busy !== null}
            startIcon={<Icon icon={Sparkles} />}
            onPress={() => {
              readIt({ text: text.trim() });
            }}
          >
            {asked === null
              ? t('timeoff.add-leave-type.read_it', 'Read it')
              : t('timeoff.add-leave-type.read_it_again', 'Read it again')}
          </Button>
          {asked === null ? null : answer === null ? (
            <Loading label={t('timeoff.add-leave-type.reading_it', 'Reading it')} />
          ) : typeof answer === 'string' ? (
            <Alert tone="danger">{answer}</Alert>
          ) : (
            <Card variant="assistant" className="gap-3">
              <View className="flex-row items-center gap-2">
                <Icon icon={Sparkles} size={16} tone="accent" />
                <Text variant="headline" className="flex-1">
                  {name === '' ? t('timeoff.add-leave-type.the_new_leave', 'The new leave') : name}
                </Text>
              </View>
              <List>
                <ListItem listitem={false} overline="Paid">
                  {unpaid
                    ? t('timeoff.add-leave-type.no_unpaid', 'No, unpaid')
                    : t('timeoff.add-leave-type.yes_full_pay', 'Yes, full pay')}
                </ListItem>
                {(read_?.rules ?? []).map((r) => (
                  <ListItem key={r.key} listitem={false} overline={r.label} wrap>
                    {r.value}
                  </ListItem>
                ))}
              </List>
              {read_?.question == null ? null : (
                <Card variant="fill" className="gap-2">
                  <Text weight="semibold">{read_.question.title}</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {read_.question.options.map((o) => (
                      <Button
                        key={o.value}
                        size="sm"
                        variant="tinted"
                        onPress={() => {
                          readIt({ ...asked, [read_.question?.key ?? '']: o.value });
                        }}
                      >
                        {o.label}
                      </Button>
                    ))}
                  </View>
                </Card>
              )}
              {(read_?.problems ?? []).map((p) => (
                <Text key={p.path} variant="footnote" tone="warning">
                  {p.message}
                </Text>
              ))}
            </Card>
          )}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onSteps}>
            {t('timeoff.add-leave-type.edit_rules', 'Edit rules')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={keyOf(name) === '' || read_ === null}
            loading={busy !== null}
            onPress={() => {
              void (async () => {
                const defined = await act<{ key: string }>('DefineTimeOffLeaveType', {
                  input: {
                    key: keyOf(name),
                    name: { default: name },
                    category,
                    colorToken: category === 'sick_leave' ? 'chart-3' : 'chart-4',
                    icon: CATEGORIES().find(([c]) => c === category)?.[2] ?? 'flag',
                    unit: 'day',
                    tracked: read_?.definition != null,
                    paid: unpaid ? 'unpaid' : 'paid',
                    visibility: category === 'sick_leave' ? 'off_only' : 'type',
                  },
                });
                if (defined === null) return;
                if (read_?.definition != null) {
                  const drafted = await act('DraftTimeOffPolicy', {
                    input: { ...read_.definition, leaveTypeKey: defined.key },
                  });
                  if (drafted === null) return;
                }
                onCreated(defined.key, name);
              })();
            }}
          >
            {t('timeoff.add-leave-type.create', 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
