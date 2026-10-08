import {
  Alert,
  AssistantMark,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldLabel,
  Icon,
  Input,
  KeyValues,
  List,
  ListItem,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Stat,
  Stepper,
  Text,
} from '@reach/ui-native';
import { ArrowRight, Baby, Send, Trash2, Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import { useAct } from '../people/act';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { askTimeOff, useTimeOff } from './api';
import { addDays, asDate, longDate, shortDate, spanLabel } from './words';

type Role = 'birth_parent' | 'other_parent' | 'adopting';
type TeamSees = 'type' | 'away';
type BlockKind = 'mandatory' | 'flexible' | 'vacation' | 'company' | 'later';

interface Entitlement {
  readonly mandatoryWeeks: number;
  readonly flexibleWeeks: number;
  readonly laterWeeks: number;
  readonly companyWeeks: number;
  readonly payPercent: number;
  readonly laterBefore: string;
  readonly noticeDays: number;
}

interface Block {
  readonly kind: BlockKind;
  readonly from: string;
  readonly to: string;
  readonly paidBy: string;
  readonly payPercent: number;
}

interface Plan {
  readonly planId: string;
  readonly status: string;
  readonly role: Role;
  readonly childDate: string;
  readonly birth: string | null;
  readonly singleParent: boolean;
  readonly children: number;
  readonly teamSees: TeamSees;
  readonly sentAt: string | null;
  readonly entitlement: Entitlement;
  readonly blocks: readonly Block[];
  readonly keptWeeks: number;
  readonly handover: readonly { work: string; coveredBy: string }[];
  readonly problems: readonly { code: string; message: string }[];
  readonly reminders: readonly { blockFrom: string; remindOn: string }[];
  readonly explanation: { text: string; ai: boolean } | null;
}

interface Parental {
  readonly managerName: string | null;
  readonly plan: Plan | null;
  readonly preview: Entitlement | null;
  readonly supported: boolean;
}

const ROLES: readonly { value: Role; label: string }[] = [
  { value: 'birth_parent', label: 'Birth parent' },
  { value: 'other_parent', label: 'Other parent' },
  { value: 'adopting', label: 'Adopting' },
];

const length = (from: string, to: string): number =>
  Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000) + 1;
const duration = (from: string, to: string): string => {
  const n = length(from, to);
  if (n % 7 === 0) return n === 7 ? '1 week' : `${String(n / 7)} weeks`;
  return n === 1 ? '1 day' : `${String(n)} days`;
};
const weeks = (n: number): string => (n === 1 ? '1 week' : `${String(n)} weeks`);
const lawWeeks = (e: Entitlement): number => e.mandatoryWeeks + e.flexibleWeeks + e.laterWeeks;
const sorted = (blocks: readonly Block[]): Block[] =>
  [...blocks].sort((a, b) => a.from.localeCompare(b.from));

function backOn(plan: Pick<Plan, 'blocks'>): string | null {
  let last: Block | undefined;
  for (const b of sorted(plan.blocks)) {
    if (last !== undefined && b.from > addDays(last.to, 1)) break;
    last = b;
  }
  return last === undefined ? null : addDays(last.to, 1);
}

/** One block as a period down the page: the rule, the dates, the pay. */
function vertical(b: Block, plan: Plan): { lead: string; title: string; detail: string } {
  switch (b.kind) {
    case 'mandatory':
      return {
        lead: `From the birth · ${plan.birth === null ? `due ${shortDate(plan.childDate)}` : `born ${shortDate(plan.childDate)}`}`,
        title: `${duration(b.from, b.to)}, mandatory`,
        detail: `${spanLabel(b.from, b.to)} · full time`,
      };
    case 'flexible': {
      const notice = plan.reminders.find((r) => r.blockFrom === b.from);
      return {
        lead: spanLabel(b.from, b.to),
        title: `${duration(b.from, b.to)} flexible`,
        detail:
          notice === undefined
            ? 'Social Security pays'
            : `Give notice by ${shortDate(notice.remindOn)}`,
      };
    }
    case 'vacation':
      return {
        lead: spanLabel(b.from, b.to),
        title: `${duration(b.from, b.to)} of vacation`,
        detail: 'Normal pay',
      };
    case 'company':
      return {
        lead: spanLabel(b.from, b.to),
        title: `${duration(b.from, b.to)} from your company`,
        detail: 'Normal pay',
      };
    default:
      return {
        lead: spanLabel(b.from, b.to),
        title: `${duration(b.from, b.to)} later`,
        detail: 'Social Security pays',
      };
  }
}

function VerticalPlan({
  plan,
  onEdit,
}: {
  plan: Plan;
  onEdit?: (index: number) => void;
}): React.JSX.Element {
  const blocks = sorted(plan.blocks);
  return (
    <List>
      {blocks.map((b) => {
        const v = vertical(b, plan);
        return (
          <ListItem
            key={`${b.kind}${b.from}`}
            icon={Baby}
            iconTone={b.kind === 'vacation' ? 1 : b.kind === 'company' ? 2 : 3}
            description={`${v.lead}\n${v.detail}`}
            {...(onEdit === undefined || b.kind === 'mandatory'
              ? {}
              : {
                  chevron: true,
                  onPress: () => {
                    onEdit(plan.blocks.indexOf(b));
                  },
                })}
          >
            {v.title}
          </ListItem>
        );
      })}
      {plan.keptWeeks > 0 ? (
        <ListItem
          description={`Until ${plan.entitlement.laterBefore.slice(0, 4)} · book any time`}
        >{`${weeks(plan.keptWeeks)} kept for later`}</ListItem>
      ) : null}
    </List>
  );
}

function summary(managerName: string | null, plan: Plan): { label: string; value: string }[] {
  const e = plan.entitlement;
  const back = backOn(plan);
  return [
    {
      label: 'Leave',
      value:
        e.companyWeeks > 0
          ? `${weeks(lawWeeks(e))} + ${weeks(e.companyWeeks)} from your company`
          : weeks(lawWeeks(e)),
    },
    {
      label: 'First day',
      value:
        plan.role === 'adopting'
          ? longDate(plan.childDate)
          : plan.birth === null
            ? `The birth, due ${longDate(plan.childDate)}`
            : `The birth, ${longDate(plan.childDate)}`,
    },
    ...(back === null ? [] : [{ label: 'Back at work', value: longDate(back) }]),
    {
      label: 'Pay',
      value: `${String(e.payPercent)}% from Social Security, normal pay for vacation and company weeks`,
    },
    {
      label: 'Handover',
      value:
        plan.handover.length === 0
          ? 'None yet'
          : plan.handover.map((h) => `${h.work}: ${h.coveredBy}`).join('; '),
    },
    { label: 'Your team sees', value: plan.teamSees === 'away' ? 'Away' : 'Parental leave' },
    { label: 'Goes to', value: `HR and ${managerName ?? 'your manager'}` },
  ];
}

/**
 * Parental leave (design MT11, MT12): about the baby, the plan as one block
 * per period down the page with why it has that shape, the handover and what
 * the team sees, then sending it to HR and the manager. Once sent, the plan
 * and, when the baby arrives, its date, which moves the mandatory weeks.
 */
export function TimeOffParental({
  navigation,
}: PeopleScreen<'TimeOffParental'>): React.JSX.Element {
  const { load, reload } = useTimeOff<Parental>('TimeOffParentalPlan');
  const [step, setStep] = useState<'about' | 'plan' | 'handover' | 'send' | null>(null);
  const back = { label: 'Time off', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title="Parental leave" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading your plan" />
        )}
      </Page>
    );
  }
  const d = load.data;
  if (!d.supported) {
    return (
      <Page title="Parental leave" back={back}>
        <Alert tone="info" title="Not planned here yet">
          Parental leave is not set up for where you work. Ask HR.
        </Alert>
      </Page>
    );
  }
  const plan = d.plan;
  const sent = plan !== null && (plan.status === 'sent' || plan.status === 'approved');
  const at = plan === null ? 'about' : (step ?? (sent ? null : 'plan'));
  const manager = d.managerName ?? 'your manager';
  if (plan !== null && sent && at === null) {
    return <Sent plan={plan} manager={manager} back={back} onChanged={reload} />;
  }
  const index = ['about', 'plan', 'handover', 'send'].indexOf(at ?? 'about');
  return (
    <Page
      title="Parental leave"
      back={
        at === 'about' || at === 'plan'
          ? back
          : {
              label: 'Back',
              onPress: () => {
                setStep(at === 'send' ? 'handover' : 'plan');
              },
            }
      }
    >
      <Stepper
        orientation="horizontal"
        label="Planning parental leave"
        steps={['About', 'Plan', 'Handover', 'Send'].map((label, i) => ({
          label,
          status: i < index ? 'done' : i === index ? 'current' : 'todo',
        }))}
      />
      {at === 'about' || plan === null ? (
        <About
          plan={plan}
          preview={d.preview}
          manager={manager}
          onSaved={() => {
            reload();
            setStep('plan');
          }}
        />
      ) : at === 'plan' ? (
        <PlanStep
          plan={plan}
          onChanged={reload}
          onNext={() => {
            setStep('handover');
          }}
          onBack={() => {
            setStep('about');
          }}
        />
      ) : at === 'handover' ? (
        <Handover
          plan={plan}
          manager={manager}
          onSaved={() => {
            reload();
            setStep('send');
          }}
        />
      ) : (
        <SendStep
          plan={plan}
          manager={manager}
          onSent={() => {
            setStep(null);
            reload();
          }}
        />
      )}
    </Page>
  );
}

function About({
  plan,
  preview,
  manager,
  onSaved,
}: {
  plan: Plan | null;
  preview: Entitlement | null;
  manager: string;
  onSaved: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct('timeoff');
  const [role, setRole] = useState<Role | null>(plan?.role ?? null);
  const [childDate, setChildDate] = useState<string | null>(plan?.childDate ?? null);
  const [single, setSingle] = useState(plan?.singleParent ?? false);
  const [twins, setTwins] = useState((plan?.children ?? 1) > 1);
  const [teamSees, setTeamSees] = useState<TeamSees>(plan?.teamSees ?? 'type');
  const [entitlement, setEntitlement] = useState<Entitlement | null>(plan?.entitlement ?? preview);
  const children = twins ? 2 : 1;
  useEffect(() => {
    if (role === null || childDate === null) return undefined;
    let live = true;
    void askTimeOff<{ preview: Entitlement | null }>(signed, 'TimeOffParentalPlan', {
      role,
      childDate,
      singleParent: single,
      children,
    }).then((a) => {
      if (live && a.ok) setEntitlement(a.data.preview);
    });
    return () => {
      live = false;
    };
  }, [signed, role, childDate, single, children]);
  return (
    <>
      <Text weight="semibold">You are</Text>
      <SegmentedControl
        fullWidth
        value={role ?? ''}
        accessibilityLabel="You are"
        onValueChange={(v) => {
          setRole(v as Role);
        }}
      >
        {ROLES.map((r) => (
          <SegmentedControlItem key={r.value} value={r.value}>
            {r.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <DatePicker
        label={role === 'adopting' ? 'Date of the decision' : 'Due date'}
        size="sm"
        value={childDate}
        onChange={setChildDate}
      />
      <SegmentedControl
        fullWidth
        value={single ? 'single' : 'two'}
        accessibilityLabel="Family"
        onValueChange={(v) => {
          setSingle(v === 'single');
        }}
      >
        <SegmentedControlItem value="two">Two parents</SegmentedControlItem>
        <SegmentedControlItem value="single">Single parent</SegmentedControlItem>
      </SegmentedControl>
      <ListItem
        listitem={false}
        leading={
          <Checkbox checked={twins} accessibilityLabel="Twins or more" onCheckedChange={setTwins} />
        }
      >
        Twins or more
      </ListItem>
      <Text weight="semibold">What your team sees</Text>
      <SegmentedControl
        fullWidth
        value={teamSees}
        accessibilityLabel="What your team sees"
        onValueChange={(v) => {
          setTeamSees(v === 'away' ? 'away' : 'type');
        }}
      >
        <SegmentedControlItem value="type">Parental leave</SegmentedControlItem>
        <SegmentedControlItem value="away">Just “Away”</SegmentedControlItem>
      </SegmentedControl>
      <Text
        variant="footnote"
        tone="muted"
      >{`HR and ${manager} always see the type. You can change this later.`}</Text>
      {entitlement === null ? null : (
        <View className="flex-row gap-2">
          <Stat
            className="flex-1"
            label="By law"
            value={String(lawWeeks(entitlement))}
            unit="weeks"
          />
          <Stat
            className="flex-1"
            label="Company"
            value={String(entitlement.companyWeeks)}
            unit="weeks"
          />
          <Stat className="flex-1" label="Paid" value={`${String(entitlement.payPercent)}%`} />
        </View>
      )}
      <Button
        variant="primary"
        endIcon={<Icon icon={ArrowRight} />}
        disabled={role === null || childDate === null}
        loading={busy === 'AnswerTimeOffParental'}
        onPress={() => {
          if (role === null || childDate === null) return;
          void act('AnswerTimeOffParental', {
            input: { role, childDate, singleParent: single, children, teamSees },
          }).then((done) => {
            if (done !== null) onSaved();
          });
        }}
      >
        Next: your plan
      </Button>
    </>
  );
}

function PlanStep({
  plan,
  onChanged,
  onNext,
  onBack,
}: {
  plan: Plan;
  onChanged: () => void;
  onNext: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const [editing, setEditing] = useState<number | null>(null);
  const block = editing === null ? undefined : plan.blocks[editing];
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const e = plan.entitlement;
  return (
    <>
      <View className="flex-row gap-2">
        <Stat className="flex-1" label="By law" value={String(lawWeeks(e))} unit="weeks" />
        <Stat className="flex-1" label="Company" value={String(e.companyWeeks)} unit="weeks" />
        <Stat className="flex-1" label="Paid" value={`${String(e.payPercent)}%`} />
      </View>
      {plan.problems.length === 0 ? null : (
        <Alert tone="warning" title="This plan can’t be sent yet">
          {plan.problems.map((p) => p.message).join(' ')}
        </Alert>
      )}
      <VerticalPlan
        plan={plan}
        onEdit={(i) => {
          setEditing(i);
          setFrom(plan.blocks[i]?.from ?? null);
          setTo(plan.blocks[i]?.to ?? null);
        }}
      />
      {plan.explanation === null ? null : (
        <Card>
          <Stack gap={2}>
            <View className="flex-row items-center gap-2">
              <AssistantMark size={20} />
              <Text variant="headline" className="flex-1">
                Why this plan
              </Text>
              {plan.explanation.ai ? <Badge size="sm">AI</Badge> : null}
            </View>
            <Text>{plan.explanation.text}</Text>
          </Stack>
        </Card>
      )}
      <View className="flex-row gap-2">
        <Button className="flex-1" onPress={onBack}>
          About the baby
        </Button>
        <Button
          className="flex-1"
          variant="primary"
          endIcon={<Icon icon={ArrowRight} />}
          onPress={onNext}
        >
          Next: handover
        </Button>
      </View>
      {block === undefined || editing === null ? null : (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{`Move ${vertical(block, plan).title}`}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <DatePicker label="From" size="sm" value={from} onChange={setFrom} />
              <DatePicker label="To" size="sm" value={to} onChange={setTo} />
              <Text variant="footnote" tone="muted">
                The rules are checked when it is saved.
              </Text>
            </DialogBody>
            <DialogFooter>
              <Button
                className="flex-1"
                onPress={() => {
                  setEditing(null);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                variant="primary"
                disabled={from === null || to === null}
                loading={busy === 'EditTimeOffParentalBlocks'}
                onPress={() => {
                  if (from === null || to === null) return;
                  const blocks = plan.blocks.map((b, i) =>
                    i === editing
                      ? { kind: b.kind, from, to }
                      : { kind: b.kind, from: b.from, to: b.to },
                  );
                  void act(
                    'EditTimeOffParentalBlocks',
                    { planId: plan.planId, input: { blocks } },
                    'Moved',
                  ).then((done) => {
                    setEditing(null);
                    if (done !== null) onChanged();
                  });
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function Handover({
  plan,
  manager,
  onSaved,
}: {
  plan: Plan;
  manager: string;
  onSaved: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const [items, setItems] = useState(plan.handover);
  const [teamSees, setTeamSees] = useState<TeamSees>(plan.teamSees);
  const [work, setWork] = useState('');
  const [coveredBy, setCoveredBy] = useState('');
  return (
    <>
      <Text weight="semibold">Who covers your work</Text>
      <Text
        variant="footnote"
        tone="muted"
      >{`Nobody is asked until ${manager} agrees. They can say no.`}</Text>
      {items.length === 0 ? null : (
        <List>
          {items.map((h, i) => (
            <ListItem
              key={`${h.work}${String(i)}`}
              icon={Users}
              description={h.coveredBy}
              trailing={
                <Button
                  size="sm"
                  variant="ghost"
                  startIcon={<Icon icon={Trash2} />}
                  accessibilityLabel={`Remove ${h.work}`}
                  onPress={() => {
                    setItems(items.filter((_, j) => j !== i));
                  }}
                />
              }
            >
              {h.work}
            </ListItem>
          ))}
        </List>
      )}
      <Field>
        <FieldLabel>Work</FieldLabel>
        <Input value={work} onChange={setWork} size="sm" placeholder="Billing v2 code reviews" />
      </Field>
      <Field>
        <FieldLabel>Covered by</FieldLabel>
        <Input value={coveredBy} onChange={setCoveredBy} size="sm" placeholder="A teammate" />
      </Field>
      <Button
        size="sm"
        disabled={work.trim() === '' || coveredBy.trim() === ''}
        onPress={() => {
          setItems([...items, { work: work.trim(), coveredBy: coveredBy.trim() }]);
          setWork('');
          setCoveredBy('');
        }}
      >
        Add
      </Button>
      <Text weight="semibold">What your team sees</Text>
      <SegmentedControl
        fullWidth
        value={teamSees}
        accessibilityLabel="What your team sees"
        onValueChange={(v) => {
          setTeamSees(v === 'away' ? 'away' : 'type');
        }}
      >
        <SegmentedControlItem value="type">Parental leave</SegmentedControlItem>
        <SegmentedControlItem value="away">Just “Away”</SegmentedControlItem>
      </SegmentedControl>
      <Button
        variant="primary"
        endIcon={<Icon icon={ArrowRight} />}
        loading={busy === 'SaveTimeOffParentalHandover'}
        onPress={() => {
          void act('SaveTimeOffParentalHandover', {
            planId: plan.planId,
            input: { handover: items, teamSees },
          }).then((done) => {
            if (done !== null) onSaved();
          });
        }}
      >
        Next: send
      </Button>
    </>
  );
}

function SendStep({
  plan,
  manager,
  onSent,
}: {
  plan: Plan;
  manager: string;
  onSent: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const blocked = plan.problems.length > 0;
  return (
    <>
      {blocked ? (
        <Alert tone="warning" title="Fix the plan before sending it">
          {plan.problems.map((p) => p.message).join(' ')}
        </Alert>
      ) : null}
      <KeyValues layout="stacked" items={summary(manager, plan)} />
      {plan.role === 'adopting' ? null : (
        <Alert tone="info" title="The dates follow the birth">
          If the baby arrives early or late, the plan shifts. Record the date and the mandatory
          weeks move with it.
        </Alert>
      )}
      <Alert tone="neutral" title="Private until you send it">
        {`Your draft is only visible to you. HR and ${manager} get it when you press Send.`}
      </Alert>
      <Button
        variant="primary"
        startIcon={<Icon icon={Send} />}
        disabled={blocked}
        loading={busy === 'SendTimeOffParentalPlan'}
        onPress={() => {
          void act(
            'SendTimeOffParentalPlan',
            { planId: plan.planId },
            `Sent to HR and ${manager}`,
          ).then((done) => {
            if (done !== null) onSent();
          });
        }}
      >
        {`Send to HR and ${manager}`}
      </Button>
    </>
  );
}

function Sent({
  plan,
  manager,
  back,
  onChanged,
}: {
  plan: Plan;
  manager: string;
  back: { label: string; onPress: () => void };
  onChanged: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct('timeoff');
  const [birth, setBirth] = useState<string | null>(null);
  const approved = plan.status === 'approved';
  return (
    <Page title="Your parental leave" back={back}>
      <Badge tone={approved ? 'success' : 'warning'} dot>
        {approved ? 'Approved' : `With HR and ${manager}`}
      </Badge>
      <VerticalPlan plan={plan} />
      <KeyValues layout="stacked" items={summary(manager, plan)} />
      {plan.role === 'adopting' || plan.birth !== null ? null : (
        <Card>
          <Stack gap={2}>
            <Text variant="headline">The baby is here</Text>
            <Text variant="footnote" tone="muted">
              The mandatory weeks move to the day of the birth, and HR and your manager are told.
            </Text>
            <DatePicker label="Born on" size="sm" value={birth} onChange={setBirth} />
            <Button
              variant="primary"
              disabled={birth === null}
              loading={busy === 'RecordTimeOffParentalBirth'}
              onPress={() => {
                if (birth === null) return;
                void act(
                  'RecordTimeOffParentalBirth',
                  { planId: plan.planId, input: { birth } },
                  'Congratulations',
                ).then(onChanged);
              }}
            >
              Record the birth
            </Button>
          </Stack>
        </Card>
      )}
    </Page>
  );
}

/** HR's parental leave cases: each person's plan and where it is. */
export function TimeOffParentalCases({
  navigation,
}: PeopleScreen<'TimeOffParentalCases'>): React.JSX.Element {
  const { load, reload } = useTimeOff<{
    cases: {
      planId: string;
      personId: string;
      displayName: string;
      teamName: string | null;
      status: string;
      from: string | null;
      to: string | null;
      sentAt: string | null;
    }[];
  }>('TimeOffParentalCases');
  return (
    <Page title="Parental leave" back={{ label: 'Back', onPress: navigation.goBack }}>
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label="Loading the plans" />
      ) : load.data.cases.length === 0 ? (
        <EmptyState
          icon={Baby}
          title="No plans"
          description="Plans appear here when somebody sends theirs."
        />
      ) : (
        <List>
          {load.data.cases.map((c) => (
            <ListItem
              key={c.planId}
              leading={<Avatar name={c.displayName} size={40} />}
              description={[
                c.teamName,
                c.from === null || c.to === null ? null : spanLabel(c.from, c.to),
              ]
                .filter(Boolean)
                .join(' · ')}
              trailing={
                <Badge size="sm" tone={c.status === 'approved' ? 'success' : 'warning'}>
                  {c.status === 'approved' ? 'Approved' : 'To approve'}
                </Badge>
              }
              onPress={() => {
                navigation.navigate('TimeOffParentalCase', {
                  planId: c.planId,
                  name: c.displayName,
                });
              }}
            >
              {c.displayName}
            </ListItem>
          ))}
        </List>
      )}
    </Page>
  );
}

/** One parental leave case for HR: the plan, the checklist across modules, and approving it. */
export function TimeOffParentalCase({
  navigation,
  route,
}: PeopleScreen<'TimeOffParentalCase'>): React.JSX.Element {
  const { load, reload } = useTimeOff<{
    canApprove: boolean;
    managerName: string | null;
    checklist: { key: string; module: string; on: boolean; status: string }[];
    plan: Plan;
  }>('TimeOffParentalCase', { planId: route.params.planId });
  const { act, busy } = useAct('timeoff');
  const back = { label: 'Plans', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={route.params.name} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the plan" />
        )}
      </Page>
    );
  }
  const d = load.data;
  return (
    <Page
      title={route.params.name}
      back={back}
      {...(d.canApprove && d.plan.status !== 'approved'
        ? {
            foot: (
              <Button
                className="flex-1"
                fullWidth
                variant="primary"
                loading={busy === 'ApproveTimeOffParentalPlan'}
                onPress={() => {
                  void act(
                    'ApproveTimeOffParentalPlan',
                    { planId: d.plan.planId },
                    'Approved',
                  ).then(reload);
                }}
              >
                Approve the plan
              </Button>
            ),
          }
        : {})}
    >
      <VerticalPlan plan={d.plan} />
      <KeyValues layout="stacked" items={summary(d.managerName, d.plan)} />
      {d.checklist.length === 0 ? null : (
        <List>
          {d.checklist.map((c) => (
            <ListItem
              key={c.key}
              description={c.module}
              trailing={
                <Badge size="sm" tone={c.status === 'done' ? 'success' : 'neutral'}>
                  {c.on ? c.status : 'Off'}
                </Badge>
              }
            >
              {c.key.replaceAll('_', ' ')}
            </ListItem>
          ))}
        </List>
      )}
    </Page>
  );
}
