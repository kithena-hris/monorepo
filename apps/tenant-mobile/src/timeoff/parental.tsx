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
import { t } from '../i18n';

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

const ROLES = (): readonly { value: Role; label: string }[] => [
  { value: 'birth_parent', label: t('timeoff.parental.birth_parent', 'Birth parent') },
  { value: 'other_parent', label: t('timeoff.parental.other_parent', 'Other parent') },
  { value: 'adopting', label: t('timeoff.parental.adopting', 'Adopting') },
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
        title: t('timeoff.parental.mandatory', '{{duration}}, mandatory', {
          duration: duration(b.from, b.to),
        }),
        detail: `${spanLabel(b.from, b.to)} · full time`,
      };
    case 'flexible': {
      const notice = plan.reminders.find((r) => r.blockFrom === b.from);
      return {
        lead: spanLabel(b.from, b.to),
        title: t('timeoff.parental.flexible', '{{duration}} flexible', {
          duration: duration(b.from, b.to),
        }),
        detail:
          notice === undefined
            ? t('timeoff.parental.social_security_pays', 'Social Security pays')
            : t('timeoff.parental.give_notice_by', 'Give notice by {{shortDate}}', {
                shortDate: shortDate(notice.remindOn),
              }),
      };
    }
    case 'vacation':
      return {
        lead: spanLabel(b.from, b.to),
        title: t('timeoff.parental.of_vacation', '{{duration}} of vacation', {
          duration: duration(b.from, b.to),
        }),
        detail: 'Normal pay',
      };
    case 'company':
      return {
        lead: spanLabel(b.from, b.to),
        title: t('timeoff.parental.from_your_company', '{{duration}} from your company', {
          duration: duration(b.from, b.to),
        }),
        detail: 'Normal pay',
      };
    default:
      return {
        lead: spanLabel(b.from, b.to),
        title: t('timeoff.parental.later', '{{duration}} later', {
          duration: duration(b.from, b.to),
        }),
        detail: t('timeoff.parental.social_security_pays', 'Social Security pays'),
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
          description={t(
            'timeoff.parental.until_book_any_time',
            'Until {{slice}} · book any time',
            { slice: plan.entitlement.laterBefore.slice(0, 4) },
          )}
        >
          {t('timeoff.parental.kept_for_later', '{{weeks}} kept for later', {
            weeks: weeks(plan.keptWeeks),
          })}
        </ListItem>
      ) : null}
    </List>
  );
}

function summary(managerName: string | null, plan: Plan): { label: string; value: string }[] {
  const e = plan.entitlement;
  const back = backOn(plan);
  return [
    {
      label: t('timeoff.parental.leave', 'Leave'),
      value:
        e.companyWeeks > 0
          ? `${weeks(lawWeeks(e))} + ${weeks(e.companyWeeks)} from your company`
          : weeks(lawWeeks(e)),
    },
    {
      label: t('timeoff.parental.first_day', 'First day'),
      value:
        plan.role === 'adopting'
          ? longDate(plan.childDate)
          : plan.birth === null
            ? t('timeoff.parental.the_birth_due', 'The birth, due {{longDate}}', {
                longDate: longDate(plan.childDate),
              })
            : t('timeoff.parental.the_birth', 'The birth, {{longDate}}', {
                longDate: longDate(plan.childDate),
              }),
    },
    ...(back === null
      ? []
      : [{ label: t('timeoff.parental.back_at_work', 'Back at work'), value: longDate(back) }]),
    {
      label: t('timeoff.parental.pay', 'Pay'),
      value: `${String(e.payPercent)}% from Social Security, normal pay for vacation and company weeks`,
    },
    {
      label: t('timeoff.parental.handover', 'Handover'),
      value:
        plan.handover.length === 0
          ? t('timeoff.parental.none_yet', 'None yet')
          : plan.handover.map((h) => `${h.work}: ${h.coveredBy}`).join('; '),
    },
    {
      label: t('timeoff.parental.your_team_sees', 'Your team sees'),
      value:
        plan.teamSees === 'away' ? 'Away' : t('timeoff.parental.parental_leave', 'Parental leave'),
    },
    {
      label: t('timeoff.parental.goes_to', 'Goes to'),
      value: t('timeoff.parental.hr_and', 'HR and {{value}}', {
        value: managerName ?? 'your manager',
      }),
    },
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
  const [step, setStep] = useState<'overview' | 'about' | 'plan' | 'handover' | 'send' | null>(
    null,
  );
  const back = { label: t('timeoff.parental.time_off', 'Time off'), onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={t('timeoff.parental.parental_leave', 'Parental leave')} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={t('timeoff.parental.loading_your_plan', 'Loading your plan')} />
        )}
      </Page>
    );
  }
  const d = load.data;
  if (!d.supported) {
    return (
      <Page title={t('timeoff.parental.parental_leave', 'Parental leave')} back={back}>
        <Alert
          tone="info"
          title={t('timeoff.parental.not_planned_here_yet', 'Not planned here yet')}
        >
          {t(
            'timeoff.parental.parental_leave_is_not_set_up',
            'Parental leave is not set up for where you work. Ask HR.',
          )}
        </Alert>
      </Page>
    );
  }
  const plan = d.plan;
  const sent = plan !== null && (plan.status === 'sent' || plan.status === 'approved');
  const at = plan === null ? 'about' : (step ?? (sent ? null : 'overview'));
  const manager = d.managerName ?? 'your manager';
  if (plan !== null && sent && at === null) {
    return <Sent plan={plan} manager={manager} back={back} onChanged={reload} />;
  }
  if (plan !== null && at === 'overview') {
    // The whole plan on one screen (design v3 T10): drafted already, changed where you want.
    const e = plan.entitlement;
    return (
      <Page
        title={t('timeoff.parental.parental_leave', 'Parental leave')}
        back={back}
        foot={
          <>
            <Button className="flex-1" onPress={navigation.goBack}>
              {t('timeoff.parental.save_draft', 'Save draft')}
            </Button>
            <Button
              className="flex-1"
              variant="primary"
              disabled={plan.problems.length > 0}
              onPress={() => {
                setStep('send');
              }}
            >
              {t('timeoff.parental.send_to_hr_and', 'Send to HR and {{value}}', {
                value: manager.split(' ')[0] ?? manager,
              })}
            </Button>
          </>
        }
      >
        <Alert tone="accent" variant="summary">
          {plan.explanation?.text ??
            `${plan.birth === null ? t('timeoff.parental.baby_due', 'Baby due {{longDate}}', { longDate: longDate(plan.childDate) }) : `Born ${longDate(plan.childDate)}`}. You get ${weeks(lawWeeks(e))}${e.companyWeeks > 0 ? ` and ${weeks(e.companyWeeks)} from your company` : ''}. Here is a plan; change what you want.`}
        </Alert>
        <View className="flex-row gap-2">
          <Stat
            className="flex-1"
            size={20}
            label={t('timeoff.parental.right_after_the_birth', 'Right after the birth')}
            value={weeks(e.mandatoryWeeks)}
          />
          <Stat
            className="flex-1"
            size={20}
            label={t('timeoff.parental.flexible_first_year', 'Flexible, first year')}
            value={weeks(e.flexibleWeeks)}
          />
          {e.laterWeeks === 0 ? null : (
            <Stat
              className="flex-1"
              size={20}
              label={t('timeoff.parental.for_later', 'For later')}
              value={weeks(e.laterWeeks)}
            />
          )}
        </View>
        {plan.problems.map((p) => (
          <Alert key={p.code} tone="warning">
            {p.message}
          </Alert>
        ))}
        <Card padded={false} className="overflow-hidden">
          <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
            <Text variant="headline">{t('timeoff.parental.your_plan', 'Your plan')}</Text>
            <Button
              size="xs"
              variant="link"
              onPress={() => {
                setStep('plan');
              }}
            >
              {t('timeoff.parental.change', 'Change')}
            </Button>
          </View>
          <VerticalPlan plan={plan} />
        </Card>
        <Card padded={false} className="overflow-hidden">
          <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
            <Text variant="headline">{t('timeoff.parental.who_covers', 'Who covers')}</Text>
            <Button
              size="xs"
              variant="link"
              onPress={() => {
                setStep('handover');
              }}
            >
              {plan.handover.length === 0
                ? t('timeoff.parental.add', 'Add')
                : t('timeoff.parental.change', 'Change')}
            </Button>
          </View>
          {plan.handover.length === 0 ? (
            <Text tone="muted" className="px-4 pb-4">
              {t(
                'timeoff.parental.nobody_yet_say_who_takes_over',
                'Nobody yet. Say who takes over what while you’re away.',
              )}
            </Text>
          ) : (
            plan.handover.map((h) => (
              <ListItem
                key={h.work}
                listitem={false}
                leading={<Avatar name={h.coveredBy} size={40} />}
                description={h.coveredBy}
              >
                {h.work}
              </ListItem>
            ))
          )}
        </Card>
        <Button
          variant="ghost"
          onPress={() => {
            setStep('about');
          }}
        >
          {t('timeoff.parental.change_the_date_or_who_you', 'Change the date or who you are')}
        </Button>
      </Page>
    );
  }
  const index = ['about', 'plan', 'handover', 'send'].indexOf(at ?? 'about');
  return (
    <Page
      title={t('timeoff.parental.parental_leave', 'Parental leave')}
      back={
        plan === null
          ? back
          : {
              label: t('timeoff.parental.your_plan', 'Your plan'),
              onPress: () => {
                setStep('overview');
              },
            }
      }
    >
      <Stepper
        orientation="horizontal"
        label={t('timeoff.parental.planning_parental_leave', 'Planning parental leave')}
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
            setStep('overview');
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
            setStep('overview');
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
      <Text weight="semibold">{t('timeoff.parental.you_are', 'You are')}</Text>
      <SegmentedControl
        fullWidth
        value={role ?? ''}
        accessibilityLabel={t('timeoff.parental.you_are', 'You are')}
        onValueChange={(v) => {
          setRole(v as Role);
        }}
      >
        {ROLES().map((r) => (
          <SegmentedControlItem key={r.value} value={r.value}>
            {r.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <DatePicker
        label={
          role === 'adopting'
            ? t('timeoff.parental.date_of_the_decision', 'Date of the decision')
            : t('timeoff.parental.due_date', 'Due date')
        }
        size="sm"
        value={childDate}
        onChange={setChildDate}
      />
      <SegmentedControl
        fullWidth
        value={single ? 'single' : 'two'}
        accessibilityLabel={t('timeoff.parental.family', 'Family')}
        onValueChange={(v) => {
          setSingle(v === 'single');
        }}
      >
        <SegmentedControlItem value="two">
          {t('timeoff.parental.two_parents', 'Two parents')}
        </SegmentedControlItem>
        <SegmentedControlItem value="single">
          {t('timeoff.parental.single_parent', 'Single parent')}
        </SegmentedControlItem>
      </SegmentedControl>
      <ListItem
        listitem={false}
        leading={
          <Checkbox
            checked={twins}
            accessibilityLabel={t('timeoff.parental.twins_or_more', 'Twins or more')}
            onCheckedChange={setTwins}
          />
        }
      >
        {t('timeoff.parental.twins_or_more', 'Twins or more')}
      </ListItem>
      <Text weight="semibold">
        {t('timeoff.parental.what_your_team_sees', 'What your team sees')}
      </Text>
      <SegmentedControl
        fullWidth
        value={teamSees}
        accessibilityLabel={t('timeoff.parental.what_your_team_sees', 'What your team sees')}
        onValueChange={(v) => {
          setTeamSees(v === 'away' ? 'away' : 'type');
        }}
      >
        <SegmentedControlItem value="type">
          {t('timeoff.parental.parental_leave', 'Parental leave')}
        </SegmentedControlItem>
        <SegmentedControlItem value="away">
          {t('timeoff.parental.just_away', 'Just “Away”')}
        </SegmentedControlItem>
      </SegmentedControl>
      <Text variant="footnote" tone="muted">
        {t(
          'timeoff.parental.hr_and_always_see_the_type',
          'HR and {{manager}} always see the type. You can change this later.',
          { manager },
        )}
      </Text>
      {entitlement === null ? null : (
        <View className="flex-row gap-2">
          <Stat
            className="flex-1"
            label={t('timeoff.parental.by_law', 'By law')}
            value={String(lawWeeks(entitlement))}
            unit="weeks"
          />
          <Stat
            className="flex-1"
            label={t('timeoff.parental.company', 'Company')}
            value={String(entitlement.companyWeeks)}
            unit="weeks"
          />
          <Stat
            className="flex-1"
            label={t('timeoff.parental.paid', 'Paid')}
            value={`${String(entitlement.payPercent)}%`}
          />
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
        {t('timeoff.parental.next_your_plan', 'Next: your plan')}
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
        <Stat
          className="flex-1"
          label={t('timeoff.parental.by_law', 'By law')}
          value={String(lawWeeks(e))}
          unit="weeks"
        />
        <Stat
          className="flex-1"
          label={t('timeoff.parental.company', 'Company')}
          value={String(e.companyWeeks)}
          unit="weeks"
        />
        <Stat
          className="flex-1"
          label={t('timeoff.parental.paid', 'Paid')}
          value={`${String(e.payPercent)}%`}
        />
      </View>
      {plan.problems.length === 0 ? null : (
        <Alert
          tone="warning"
          title={t('timeoff.parental.this_plan_cant_be_sent_yet', 'This plan can’t be sent yet')}
        >
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
                {t('timeoff.parental.why_this_plan', 'Why this plan')}
              </Text>
              {plan.explanation.ai ? (
                <Badge size="sm">{t('timeoff.parental.ai', 'AI')}</Badge>
              ) : null}
            </View>
            <Text>{plan.explanation.text}</Text>
          </Stack>
        </Card>
      )}
      <View className="flex-row gap-2">
        <Button className="flex-1" onPress={onBack}>
          {t('timeoff.parental.about_the_baby', 'About the baby')}
        </Button>
        <Button
          className="flex-1"
          variant="primary"
          endIcon={<Icon icon={ArrowRight} />}
          onPress={onNext}
        >
          {t('timeoff.parental.next_handover', 'Next: handover')}
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
              <DialogTitle>
                {t('timeoff.parental.move', 'Move {{title}}', {
                  title: vertical(block, plan).title,
                })}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <DatePicker
                label={t('timeoff.parental.from', 'From')}
                size="sm"
                value={from}
                onChange={setFrom}
              />
              <DatePicker
                label={t('timeoff.parental.to', 'To')}
                size="sm"
                value={to}
                onChange={setTo}
              />
              <Text variant="footnote" tone="muted">
                {t(
                  'timeoff.parental.the_rules_are_checked_when_it',
                  'The rules are checked when it is saved.',
                )}
              </Text>
            </DialogBody>
            <DialogFooter>
              <Button
                className="flex-1"
                onPress={() => {
                  setEditing(null);
                }}
              >
                {t('timeoff.parental.cancel', 'Cancel')}
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
                {t('timeoff.parental.save', 'Save')}
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
      <Text weight="semibold">
        {t('timeoff.parental.who_covers_your_work', 'Who covers your work')}
      </Text>
      <Text variant="footnote" tone="muted">
        {t(
          'timeoff.parental.nobody_is_asked_until_agrees_they',
          'Nobody is asked until {{manager}} agrees. They can say no.',
          { manager },
        )}
      </Text>
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
                  accessibilityLabel={t('timeoff.parental.remove', 'Remove {{work}}', {
                    work: h.work,
                  })}
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
        <FieldLabel>{t('timeoff.parental.work', 'Work')}</FieldLabel>
        <Input
          value={work}
          onChange={setWork}
          size="sm"
          placeholder={t('timeoff.parental.billing_v2_code_reviews', 'Billing v2 code reviews')}
        />
      </Field>
      <Field>
        <FieldLabel>{t('timeoff.parental.covered_by', 'Covered by')}</FieldLabel>
        <Input
          value={coveredBy}
          onChange={setCoveredBy}
          size="sm"
          placeholder={t('timeoff.parental.a_teammate', 'A teammate')}
        />
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
        {t('timeoff.parental.add', 'Add')}
      </Button>
      <Text weight="semibold">
        {t('timeoff.parental.what_your_team_sees', 'What your team sees')}
      </Text>
      <SegmentedControl
        fullWidth
        value={teamSees}
        accessibilityLabel={t('timeoff.parental.what_your_team_sees', 'What your team sees')}
        onValueChange={(v) => {
          setTeamSees(v === 'away' ? 'away' : 'type');
        }}
      >
        <SegmentedControlItem value="type">
          {t('timeoff.parental.parental_leave', 'Parental leave')}
        </SegmentedControlItem>
        <SegmentedControlItem value="away">
          {t('timeoff.parental.just_away', 'Just “Away”')}
        </SegmentedControlItem>
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
        {t('timeoff.parental.next_send', 'Next: send')}
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
        <Alert
          tone="warning"
          title={t(
            'timeoff.parental.fix_the_plan_before_sending_it',
            'Fix the plan before sending it',
          )}
        >
          {plan.problems.map((p) => p.message).join(' ')}
        </Alert>
      ) : null}
      <KeyValues layout="stacked" items={summary(manager, plan)} />
      {plan.role === 'adopting' ? null : (
        <Alert
          tone="info"
          title={t('timeoff.parental.the_dates_follow_the_birth', 'The dates follow the birth')}
        >
          {t(
            'timeoff.parental.if_the_baby_arrives_early_or',
            'If the baby arrives early or late, the plan shifts. Record the date and the mandatory weeks move with it.',
          )}
        </Alert>
      )}
      <Alert
        tone="neutral"
        title={t('timeoff.parental.private_until_you_send_it', 'Private until you send it')}
      >
        {t(
          'timeoff.parental.your_draft_is_only_visible_to',
          'Your draft is only visible to you. HR and {{manager}} get it when you press Send.',
          { manager },
        )}
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
            t('timeoff.parental.sent_to_hr_and', 'Sent to HR and {{manager}}', { manager }),
          ).then((done) => {
            if (done !== null) onSent();
          });
        }}
      >
        {t('timeoff.parental.send_to_hr_and_2', 'Send to HR and {{manager}}', { manager })}
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
    <Page title={t('timeoff.parental.your_parental_leave', 'Your parental leave')} back={back}>
      <Badge tone={approved ? 'success' : 'warning'} dot>
        {approved
          ? t('timeoff.parental.approved', 'Approved')
          : t('timeoff.parental.with_hr_and', 'With HR and {{manager}}', { manager })}
      </Badge>
      <VerticalPlan plan={plan} />
      <KeyValues layout="stacked" items={summary(manager, plan)} />
      {plan.role === 'adopting' || plan.birth !== null ? null : (
        <Card>
          <Stack gap={2}>
            <Text variant="headline">
              {t('timeoff.parental.the_baby_is_here', 'The baby is here')}
            </Text>
            <Text variant="footnote" tone="muted">
              {t(
                'timeoff.parental.the_mandatory_weeks_move_to_the',
                'The mandatory weeks move to the day of the birth, and HR and your manager are told.',
              )}
            </Text>
            <DatePicker
              label={t('timeoff.parental.born_on', 'Born on')}
              size="sm"
              value={birth}
              onChange={setBirth}
            />
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
              {t('timeoff.parental.record_the_birth', 'Record the birth')}
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
    <Page
      title={t('timeoff.parental.parental_leave', 'Parental leave')}
      back={{ label: t('timeoff.parental.back', 'Back'), onPress: navigation.goBack }}
    >
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label={t('timeoff.parental.loading_the_plans', 'Loading the plans')} />
      ) : load.data.cases.length === 0 ? (
        <EmptyState
          icon={Baby}
          title={t('timeoff.parental.no_plans', 'No plans')}
          description={t(
            'timeoff.parental.plans_appear_here_when_somebody_sends',
            'Plans appear here when somebody sends theirs.',
          )}
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
                  {c.status === 'approved'
                    ? t('timeoff.parental.approved', 'Approved')
                    : t('timeoff.parental.to_approve', 'To approve')}
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
  const back = { label: t('timeoff.parental.plans', 'Plans'), onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={route.params.name} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={t('timeoff.parental.loading_the_plan', 'Loading the plan')} />
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
                {t('timeoff.parental.approve_the_plan', 'Approve the plan')}
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
                  {c.on ? c.status : t('timeoff.parental.off', 'Off')}
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
