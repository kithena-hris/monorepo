import {
  Alert,
  Button,
  Card,
  CardTitle,
  DatePicker,
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
} from '@reach/ui-native';
import { ArrowLeft, ArrowRight, Send } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Loading, Page } from '../frame';
import { useAct } from '../people/act';
import type { PeopleScreen } from '../people/routes';
import { useTimeOff } from './api';
import { leaveIcon } from './icons';
import { CATEGORIES, keyOf } from './settings';
import { todayHere } from './time';
import { amount, shortDate } from './words';

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

  const key = defined ?? keyOf(name);
  const sick = category === 'sick_leave';
  const steps: readonly Step[] = tracked
    ? ['what', 'balance', 'rules', 'preview']
    : ['what', 'balance', 'preview'];
  const at = steps.indexOf(step);
  const definition = {
    leaveTypeKey: key,
    allowance: [{ fromYears: 0, days: days(allowance) }],
    earning,
    proRata,
    probationMonths: probation,
    carryOver: carry === 0 ? null : { maxDays: days(carry), useBy: { month: 3, day: 31 } },
  };

  /** The type and its draft, written or brought up to date, before the example is shown. */
  const prepare = async (): Promise<boolean> => {
    if (defined === null) {
      const done = await act<{ key: string }>('DefineTimeOffLeaveType', {
        input: {
          key,
          name: { default: name.trim() },
          category,
          colorToken: sick ? 'chart-3' : 'chart-4',
          icon: CATEGORIES.find(([c]) => c === category)?.[2] ?? 'flag',
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
            input: { ...definition, leaveTypeKey: defined ?? key },
          })
        : await act('ReviseTimeOffPolicy', { policyId, input: definition }).then((d) =>
            d === null ? null : { policyId },
          );
    if (drafted === null) return false;
    setPolicyId(drafted.policyId);
    return true;
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
      ? { label: 'Leave types', onPress: navigation.goBack }
      : {
          label: 'Back',
          onPress: () => {
            setStep(steps[at - 1] ?? 'what');
          },
        };
  const ready = step !== 'what' || (keyOf(name) !== '' && name.trim().length <= 60);

  return (
    <Page
      title="Add a leave type"
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
            {tracked ? 'Publish' : 'Done'}
          </Button>
        ) : (
          <>
            {at === 0 ? null : (
              <Button
                startIcon={<Icon icon={ArrowLeft} />}
                onPress={back.onPress}
                accessibilityLabel="Back"
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
              {steps[at + 1] === 'preview' ? 'See an example' : 'Next'}
            </Button>
          </>
        )
      }
    >
      <StepperProgress step={at + 1} count={steps.length} label="Add a leave type" />
      {step === 'what' ? (
        <Stack gap={3}>
          <Text variant="title2" accessibilityRole="header">
            What is it?
          </Text>
          <Field required>
            <FieldLabel>Name</FieldLabel>
            <Input
              value={name}
              onChange={setName}
              maxLength={60}
              readOnly={defined !== null}
              placeholder="Personal leave"
            />
            <FieldDescription>
              {defined !== null
                ? 'Already added; rename it from the leave type.'
                : name.trim() === ''
                  ? 'What people see when they ask for it.'
                  : `Key: ${keyOf(name)}`}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Kind</FieldLabel>
            <Select value={category} onValueChange={setCategory} disabled={defined !== null}>
              <SelectTrigger accessibilityLabel="Kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(([v, l]) => (
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
              accessibilityLabel="Pay"
              onValueChange={setPaid}
            >
              <SegmentedControlItem value="paid">Paid</SegmentedControlItem>
              <SegmentedControlItem value="unpaid">Unpaid</SegmentedControlItem>
            </SegmentedControl>
          ) : (
            <Text tone="muted">{paid === 'paid' ? 'Paid' : 'Unpaid'}</Text>
          )}
          <ListItem
            listitem={false}
            description="Teammates see only “Off”. Sick leave always is."
            trailing={
              <Switch
                checked={hidden || sick}
                disabled={sick || defined !== null}
                accessibilityLabel="Private"
                onCheckedChange={setHidden}
              />
            }
          >
            Private
          </ListItem>
        </Stack>
      ) : step === 'balance' ? (
        <Stack gap={3}>
          <Text variant="title2" accessibilityRole="header">
            How much can people take?
          </Text>
          <ListItem
            listitem={false}
            description="Taken from an allowance that Time Off keeps."
            trailing={
              <Switch
                checked={tracked}
                disabled={defined !== null}
                accessibilityLabel="From a balance"
                onCheckedChange={setTracked}
              />
            }
          >
            From a balance
          </ListItem>
          {tracked ? (
            <>
              <ListItem
                listitem={false}
                description="Counted in hours, not days."
                trailing={
                  <Switch
                    checked={hours}
                    disabled={defined !== null}
                    accessibilityLabel="In hours"
                    onCheckedChange={setHours}
                  />
                }
              >
                In hours
              </ListItem>
              <NumberField
                label={hours ? 'Hours a year' : 'Days a year'}
                min={0}
                max={365}
                step={0.5}
                value={allowance}
                onChange={(v) => {
                  setAllowance(v ?? 0);
                }}
              />
              <Field>
                <FieldLabel>Given</FieldLabel>
                <SegmentedControl
                  fullWidth
                  value={earning}
                  accessibilityLabel="Given"
                  onValueChange={(v) => {
                    setEarning(v === 'monthly' ? 'monthly' : 'upfront');
                  }}
                >
                  <SegmentedControlItem value="upfront">All at once</SegmentedControlItem>
                  <SegmentedControlItem value="monthly">Month by month</SegmentedControlItem>
                </SegmentedControl>
              </Field>
              <ListItem
                listitem={false}
                description="Someone joining or leaving mid-year gets a share, rounded up to the half day."
                trailing={
                  <Switch
                    checked={proRata}
                    accessibilityLabel="Pro rata"
                    onCheckedChange={setProRata}
                  />
                }
              >
                Pro rata
              </ListItem>
            </>
          ) : (
            <Text tone="muted">
              People ask for it and their manager decides; nothing is counted down.
            </Text>
          )}
        </Stack>
      ) : step === 'rules' ? (
        <Stack gap={3}>
          <Text variant="title2" accessibilityRole="header">
            Any rules?
          </Text>
          <NumberField
            label="Carried into next year, at most"
            min={0}
            max={365}
            step={0.5}
            value={carry}
            onChange={(v) => {
              setCarry(v ?? 0);
            }}
          />
          <Text variant="footnote" tone="muted">
            Used by 31 March, or lost. 0 carries nothing.
          </Text>
          <NumberField
            label="Probation, months"
            min={0}
            max={24}
            value={probation}
            onChange={(v) => {
              setProbation(v ?? 0);
            }}
          />
          <Text variant="footnote" tone="muted">
            How long after joining before it can be booked.
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
  const icon = CATEGORIES.find(([c]) => c === category)?.[2] ?? 'flag';
  return (
    <Stack gap={3}>
      <Text variant="title2" accessibilityRole="header">
        How it will look
      </Text>
      <Card>
        <Stack gap={2}>
          <Text variant="footnote" weight="semibold" tone="muted">
            On someone’s phone
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
                  chart: <Progress label={`${name}: none used yet`} value={0} max={allowance} />,
                  description: '0 used · 0 booked',
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
                ? 'Joining or leaving mid-year gets a share, rounded up to the half day'
                : 'Joining mid-year still gets the whole year',
              carry === 0
                ? 'Nothing carries into next year'
                : `Up to ${amount(days(carry))} ${unit} carry over, used by 31 March`,
              probation === 0
                ? 'Can be booked from day one'
                : `Can be booked after ${String(probation)} ${probation === 1 ? 'month' : 'months'}`,
            ]
          : ['Not counted from a balance', 'Asked for and approved like any time off']
        ).map((line) => (
          <ListItem key={line}>{line}</ListItem>
        ))}
      </List>
      {tracked && policyId !== null ? <Members policyId={policyId} unit={unit} /> : null}
      {tracked ? (
        <DatePicker label="In effect from" value={from} onChange={onFrom} />
      ) : (
        <Alert tone="success" title="Added">
          {`${name} can be asked for now.`}
        </Alert>
      )}
    </Stack>
  );
}

/** What publishing gives each person this year, from Time Off's own preview of the draft. */
function Members({ policyId, unit }: { policyId: string; unit: string }): React.JSX.Element {
  const { load } = useTimeOff<Preview>('TimeOffPolicyPreview', { policyId });
  if (load.status === 'loading') return <Loading label="Working out each person’s balance" />;
  if (load.status === 'error') return <Text tone="muted">{load.message}</Text>;
  const members = load.data.members;
  return (
    <Card>
      <Stack gap={2}>
        <CardTitle>{`Once published, for ${String(members.length)} ${members.length === 1 ? 'person' : 'people'}`}</CardTitle>
        {members.length === 0 ? (
          <Text tone="muted">Nobody it applies to works here yet.</Text>
        ) : (
          <View>
            {members.slice(0, 5).map((m) => (
              <ListItem
                key={m.personId}
                listitem={false}
                description={`${amount(m.allowance.draft)} ${unit} this year`}
                trailing={<Text className="tabular-nums">{`${amount(m.left.draft)} left`}</Text>}
              >
                {m.displayName}
              </ListItem>
            ))}
            {members.length > 5 ? (
              <Text
                variant="footnote"
                tone="muted"
              >{`and ${String(members.length - 5)} more`}</Text>
            ) : null}
          </View>
        )}
        <Text variant="footnote" tone="muted">
          {`Worked out by Time Off as of ${shortDate(todayHere())}.`}
        </Text>
      </Stack>
    </Card>
  );
}
