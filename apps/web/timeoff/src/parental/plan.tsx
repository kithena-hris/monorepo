import {
  Alert,
  AssistantCard,
  Badge,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  KeyValues,
  List,
  ListItem,
  PageHeader,
  PageSection,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  Stat,
  Stepper,
  Switch,
  icons,
} from '@reach/ui';
import { useEffect, useId, useState, useTransition, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import {
  PAYER,
  PlanTrack,
  addDays,
  backOn,
  dayDate,
  duration,
  lawWeeks,
  length,
  longDate,
  shortDate,
  spanLabel,
  weeks,
  year,
  type Block,
  type BlockKind,
  type Entitlement,
  type Member,
  type ParentRole,
  type Plan,
  type TeamSees,
} from './shared';
import { t } from '../i18n';

/**
 * Planning parental leave (T8–T10, MT11, MT12), one step per address:
 * `/time-off/parental/about` (four answers and the entitlement), `/plan`
 * (the plan laid out, dragged on a desk, listed down a phone), `/handover`
 * (who covers what, what the team sees) and `/send` (the summary, and the
 * button that ends the privacy). `/plan` before there is a plan asks the
 * four questions first: nothing can be laid out without them.
 *
 * Drawn from Time Off's answer and nothing else; every number on it is the
 * domain's, and every write is the shell's (`on*`), coming back as the page
 * drawn again. A sent plan is shown as sent, whatever the step, with the
 * birth to record once the baby is here.
 *
 * One component at two widths: under 40rem of its own width the track turns
 * into MT11's vertical blocks.
 */

export interface ParentalData {
  /** The step the address names. */
  readonly step: string;
  /** `null` for an HR account that is not itself a member. */
  readonly member: (Member & { readonly managerPersonId: string | null }) | null;
  readonly managerName: string | null;
  readonly supported: boolean;
  readonly plan: Plan | null;
  readonly preview: Entitlement | null;
}

interface Answers {
  readonly role: ParentRole;
  readonly childDate: string;
  readonly singleParent: boolean;
  readonly children: number;
}

export interface ParentalPlanProps {
  readonly load: Loadable<ParentalData>;
  /** The entitlement for answers not saved yet. */
  readonly onPreview?: (
    answers: Answers,
  ) => Promise<{ ok: true; entitlement: unknown } | { ok: false; message: string }>;
  readonly onAnswer?: (answers: Answers & { teamSees: TeamSees }) => Promise<Outcome>;
  readonly onBlocks?: (
    planId: string,
    blocks: readonly { kind: BlockKind; from: string; to: string }[],
  ) => Promise<Outcome>;
  readonly onHandover?: (
    planId: string,
    handover: readonly { work: string; coveredBy: string }[],
    teamSees: TeamSees,
  ) => Promise<Outcome>;
  readonly onSend?: (planId: string) => Promise<Outcome>;
  readonly onBirth?: (planId: string, birth: string) => Promise<Outcome>;
  readonly onNavigate?: (href: string) => void;
}

const STEPS = [
  { id: 'about', label: t('parental.plan.about_the_baby', 'About the baby') },
  { id: 'plan', label: t('parental.plan.your_plan', 'Your plan') },
  { id: 'handover', label: t('parental.plan.handover', 'Handover') },
  { id: 'send', label: t('parental.plan.send_to_hr', 'Send to HR') },
] as const;
type Step = (typeof STEPS)[number]['id'];

const href = (step: Step): string => `/time-off/parental/${step}`;

export function ParentalPlan(props: ParentalPlanProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <ParentalSkeleton />;
  return (
    <div className="@container/parental flex flex-col gap-6">
      {load.status === 'error' ? (
        <PageHeader title={t('parental.plan.plan_parental_leave', 'Plan parental leave')} />
      ) : null}
      <Loaded load={load} what="your parental leave plan">
        {(data) => <Ready data={data} {...props} />}
      </Loaded>
    </div>
  );
}

/* -------------------------------------------------------------- frame -- */

/** "Marco", or "your manager" when nobody is named. */
const managerWord = (data: ParentalData): string =>
  data.managerName?.split(' ')[0] ?? t('parental.plan.your_manager', 'your manager');

function Ready({
  data,
  ...props
}: ParentalPlanProps & { readonly data: ParentalData }): JSX.Element {
  const { plan } = data;
  if (data.member === null || !data.supported) {
    return (
      <>
        <PageHeader title={t('parental.plan.plan_parental_leave', 'Plan parental leave')} />
        <Alert
          tone="info"
          title={t(
            'parental.plan.parental_leave_cant_be_planned_here',
            'Parental leave can’t be planned here yet',
          )}
        >
          {data.member === null
            ? t(
                'parental.plan.plans_belong_to_the_person_taking',
                'Plans belong to the person taking the leave. Open one from HR’s view of the case.',
              )
            : t(
                'parental.plan.the_law_where_you_work_isnt',
                'The law where you work isn’t in Time Off yet. HR can plan your leave with you.',
              )}
        </Alert>
      </>
    );
  }
  if (plan !== null && plan.status !== 'draft') return <Sent data={data} plan={plan} {...props} />;
  const asked = STEPS.find((s) => s.id === data.step)?.id ?? 'plan';
  const step: Step = plan === null ? 'about' : asked;
  return <Steps data={data} plan={plan} step={step} {...props} />;
}

/** The page header and the stepper over every step; the step's own actions in the header. */
function Frame({
  data,
  step,
  actions,
  onNavigate,
  children,
}: {
  readonly data: ParentalData;
  readonly step: Step;
  readonly actions: ReactNode;
  readonly onNavigate: ParentalPlanProps['onNavigate'];
  readonly children: ReactNode;
}): JSX.Element {
  const index = STEPS.findIndex((s) => s.id === step);
  return (
    <>
      <PageHeader
        title={t('parental.plan.plan_parental_leave', 'Plan parental leave')}
        description={t(
          'parental.plan.built_from_the_law_where_you',
          'Built from the law where you work and your company’s policy. Private until you send it to HR and {{managerWord}}.',
          { managerWord: managerWord(data) },
        )}
        actions={actions}
      />
      <Stepper
        className="max-w-4xl"
        label={t('parental.plan.planning_parental_leave', 'Planning parental leave')}
        orientation="horizontal"
        current={index}
        steps={STEPS.map((s) => ({ id: s.id, label: s.label }))}
        {...(onNavigate === undefined
          ? {}
          : {
              onStepChange: (i: number) => {
                const to = STEPS[i];
                if (to !== undefined) onNavigate(href(to.id));
              },
            })}
      />
      {children}
    </>
  );
}

function Steps({
  data,
  plan,
  step,
  ...props
}: ParentalPlanProps & {
  readonly data: ParentalData;
  readonly plan: Plan | null;
  readonly step: Step;
}): JSX.Element {
  switch (step) {
    case 'about':
      return <About data={data} plan={plan} {...props} />;
    case 'plan':
      return plan === null ? (
        <About data={data} plan={plan} {...props} />
      ) : (
        <Laid data={data} plan={plan} {...props} />
      );
    case 'handover':
      return plan === null ? (
        <About data={data} plan={plan} {...props} />
      ) : (
        <Handover data={data} plan={plan} {...props} />
      );
    case 'send':
      return plan === null ? (
        <About data={data} plan={plan} {...props} />
      ) : (
        <Send data={data} plan={plan} {...props} />
      );
  }
}

/** A write in flight, and what it was refused with. */
function useWrite(): {
  readonly pending: boolean;
  readonly failed: string | null;
  readonly run: (write: () => Promise<Outcome>, then?: () => void) => void;
} {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  return {
    pending,
    failed,
    run: (write, then) => {
      setFailed(null);
      start(async () => {
        const outcome = await write();
        if (outcome.ok) then?.();
        else setFailed(outcome.message);
      });
    },
  };
}

function Refused({
  failed,
  title,
}: {
  readonly failed: string | null;
  readonly title: string;
}): JSX.Element | null {
  return failed === null ? null : (
    <Alert tone="danger" title={title}>
      {failed}
    </Alert>
  );
}

/* ------------------------------------------------------------- T8 -- */

const ROLES: readonly { value: ParentRole; label: string }[] = [
  { value: 'birth_parent', label: t('parental.plan.the_birth_parent', 'The birth parent') },
  { value: 'other_parent', label: t('parental.plan.the_other_parent', 'The other parent') },
  { value: 'adopting', label: t('parental.plan.adopting_or_fostering', 'Adopting or fostering') },
];

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly onChange: (value: string) => void;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}): JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-sm font-medium text-fg">
        {label}
      </span>
      <SegmentedControl aria-labelledby={id} fullWidth value={value ?? ''} onValueChange={onChange}>
        {options.map((o) => (
          <SegmentedControlItem key={o.value} value={o.value}>
            {o.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  );
}

function TeamSeesChoice({
  value,
  onChange,
  manager,
}: {
  readonly value: TeamSees;
  readonly onChange: (value: TeamSees) => void;
  readonly manager: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <Choice
        label={t('parental.plan.what_your_team_sees', 'What your team sees')}
        value={value}
        onChange={(v) => {
          onChange(v === 'away' ? 'away' : 'type');
        }}
        options={[
          { value: 'type', label: t('parental.plan.parental_leave', 'Parental leave') },
          { value: 'away', label: t('parental.plan.just_away', 'Just “Away”') },
        ]}
      />
      <p className="text-xs text-fg-muted">
        {t(
          'parental.plan.hr_and_always_see_the_type',
          'HR and {{manager}} always see the type. You can change this later.',
          { manager },
        )}
      </p>
    </div>
  );
}

function About({
  data,
  plan,
  onPreview,
  onAnswer,
  onNavigate,
}: ParentalPlanProps & { readonly data: ParentalData; readonly plan: Plan | null }): JSX.Element {
  const [role, setRole] = useState<ParentRole | null>(plan?.role ?? null);
  const [childDate, setChildDate] = useState<string | null>(plan?.childDate ?? null);
  const [singleParent, setSingleParent] = useState(plan?.singleParent ?? false);
  const [twins, setTwins] = useState((plan?.children ?? 1) > 1);
  const [teamSees, setTeamSees] = useState<TeamSees>(plan?.teamSees ?? 'type');
  const [entitlement, setEntitlement] = useState<Entitlement | null>(
    plan?.entitlement ?? data.preview,
  );
  const write = useWrite();
  const children = twins ? 2 : 1;

  useEffect(() => {
    if (role === null || childDate === null || onPreview === undefined) return;
    let current = true;
    void onPreview({ role, childDate, singleParent, children }).then((answer) => {
      if (current && answer.ok) setEntitlement(answer.entitlement as Entitlement | null);
    });
    return () => {
      current = false;
    };
  }, [role, childDate, singleParent, children, onPreview]);

  const ready = role !== null && childDate !== null && onAnswer !== undefined;
  const save = (next: boolean): void => {
    if (!ready) return;
    write.run(
      () => onAnswer({ role, childDate, singleParent, children, teamSees }),
      next ? () => onNavigate?.(href('plan')) : undefined,
    );
  };
  return (
    <Frame
      data={data}
      step="about"
      onNavigate={onNavigate}
      actions={
        <>
          <Button
            disabled={!ready || write.pending}
            onClick={() => {
              save(false);
            }}
          >
            {t('parental.plan.save_draft', 'Save draft')}
          </Button>
          <Button
            variant="primary"
            endIcon={<icons.forward aria-hidden />}
            disabled={!ready || write.pending}
            onClick={() => {
              save(true);
            }}
          >
            {t('parental.plan.next_your_plan', 'Next: your plan')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 @min-[56rem]/parental:grid @min-[56rem]/parental:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] @min-[56rem]/parental:items-start">
        <PageSection title={t('parental.plan.about_the_baby', 'About the baby')}>
          <Card padded className="flex flex-col gap-5">
            <Choice
              label={t('parental.plan.you_are', 'You are')}
              value={role}
              onChange={(v) => {
                setRole(v as ParentRole);
              }}
              options={ROLES}
            />
            <Field>
              <FieldLabel>
                {role === 'adopting'
                  ? t('parental.plan.date_of_the_decision', 'Date of the decision')
                  : t('parental.plan.due_date', 'Due date')}
              </FieldLabel>
              <FieldControl>
                <DatePicker
                  label={
                    role === 'adopting'
                      ? t('parental.plan.date_of_the_decision', 'Date of the decision')
                      : t('parental.plan.due_date', 'Due date')
                  }
                  value={childDate}
                  onChange={setChildDate}
                />
              </FieldControl>
            </Field>
            <Choice
              label={t('parental.plan.family', 'Family')}
              value={singleParent ? 'single' : 'two'}
              onChange={(v) => {
                setSingleParent(v === 'single');
              }}
              options={[
                { value: 'two', label: t('parental.plan.two_parents', 'Two parents') },
                { value: 'single', label: t('parental.plan.single_parent', 'Single parent') },
              ]}
            />
            <Field orientation="horizontal" className="items-start justify-start gap-3">
              <FieldControl>
                <Checkbox
                  checked={twins}
                  onCheckedChange={(on) => {
                    setTwins(on === true);
                  }}
                />
              </FieldControl>
              <div>
                <FieldLabel>{t('parental.plan.twins_or_more', 'Twins or more')}</FieldLabel>
                <FieldDescription>
                  {t(
                    'parental.plan.adds_weeks_for_each_child_after',
                    'Adds weeks for each child after the first',
                  )}
                </FieldDescription>
              </div>
            </Field>
            <TeamSeesChoice value={teamSees} onChange={setTeamSees} manager={managerWord(data)} />
            <Refused
              failed={write.failed}
              title={t('parental.plan.your_answers_were_not_saved', 'Your answers were not saved')}
            />
          </Card>
        </PageSection>
        <EntitlementCard entitlement={entitlement} role={role} childDate={childDate} />
      </div>
    </Frame>
  );
}

/** T8's "What you’re entitled to", or what it needs first. */
function EntitlementCard({
  entitlement: e,
  role,
  childDate,
}: {
  readonly entitlement: Entitlement | null;
  readonly role: ParentRole | null;
  readonly childDate: string | null;
}): JSX.Element {
  return (
    <AssistantCard
      title={t('parental.plan.what_youre_entitled_to', 'What you’re entitled to')}
      action={e === null ? undefined : <Badge size="sm">{e.law}</Badge>}
      note={t(
        'parental.plan.based_on_your_contract_location_and',
        'Based on your contract, location and length of service. HR confirms it.',
      )}
    >
      {e === null || childDate === null ? (
        <p className="text-sm text-fg-muted">
          {t(
            'parental.plan.say_who_you_are_and_the',
            'Say who you are and the date, and the weeks the law and your company give you show here.',
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-2 @min-[40rem]/parental:grid-cols-3">
            <Stat
              label={t('parental.plan.mandatory', 'Mandatory')}
              value={String(e.mandatoryWeeks)}
              unit="weeks"
              description={
                role === 'adopting'
                  ? t(
                      'parental.plan.straight_after_the_decision',
                      'Straight after the decision, full time',
                    )
                  : t(
                      'parental.plan.straight_after_the_birth',
                      'Straight after the birth, full time',
                    )
              }
            />
            <Stat
              label={t('parental.plan.flexible', 'Flexible')}
              value={String(e.flexibleWeeks)}
              unit="weeks"
              description={t('parental.plan.any_time_before', 'Any time before {{longDate}}', {
                longDate: longDate(e.flexibleBefore),
              })}
            />
            <Stat
              label={t('parental.plan.for_later', 'For later')}
              value={String(e.laterWeeks)}
              unit="weeks"
              description={t(
                'parental.plan.any_time_before_your_child_turns',
                'Any time before your child turns {{value}}',
                { value: String(Number(year(e.laterBefore)) - Number(year(childDate))) },
              )}
            />
          </div>
          <List>
            <ListItem
              icon={<icons.payment aria-hidden />}
              iconTone="chart-3"
              description={t(
                'parental.plan.hr_prepares_the_certificate_you_need',
                'HR prepares the certificate you need for your claim.',
              )}
            >
              {t('parental.plan.paid_at_by', '{{weeks}}, paid at {{payPercent}}% by {{value}}', {
                weeks: weeks(lawWeeks(e)),
                payPercent: String(e.payPercent),
                value: PAYER[e.paidBy] ?? e.paidBy,
              })}
            </ListItem>
            {e.companyWeeks > 0 ? (
              <ListItem
                icon={<icons.company aria-hidden />}
                iconTone="chart-2"
                description={t(
                  'parental.plan.company_policy_for_parents_with_of',
                  {
                    one: 'Company policy for parents with {{value}} year of service.',
                    other: 'Company policy for parents with {{value}} years of service.',
                  },
                  { count: e.companyAfterYears, value: String(e.companyAfterYears ?? 0) },
                )}
              >
                {t('parental.plan.your_company_adds_paid', 'Your company adds {{weeks}}, paid', {
                  weeks: weeks(e.companyWeeks),
                })}
              </ListItem>
            ) : null}
            {e.vacationAccrues ? (
              <ListItem
                icon={<icons.vacation aria-hidden />}
                iconTone="chart-1"
                description={t(
                  'parental.plan.it_is_there_when_youre_back',
                  'It is there when you’re back, even in a later year.',
                )}
              >
                {t('parental.plan.you_keep_earning_vacation', 'You keep earning vacation')}
              </ListItem>
            ) : null}
          </List>
        </div>
      )}
    </AssistantCard>
  );
}

/* ---------------------------------------------------------- T9, MT11 -- */

/** Consecutive days with the same payer, as T9's "Pay while you’re away". */
function payPeriods(
  blocks: readonly Block[],
): { from: string; to: string; paidBy: string; percent: number }[] {
  const out: { from: string; to: string; paidBy: string; percent: number }[] = [];
  for (const b of blocks.toSorted((x, y) => x.from.localeCompare(y.from))) {
    const last = out.at(-1);
    if (
      last?.paidBy === b.paidBy &&
      last.percent === b.payPercent &&
      b.from === addDays(last.to, 1)
    ) {
      last.to = b.to;
    } else out.push({ from: b.from, to: b.to, paidBy: b.paidBy, percent: b.payPercent });
  }
  return out;
}

/** The plan in words (T9's "Why this plan"), templated from Time Off's numbers until TOF-092. */
function reasons(plan: Plan): { icon: ReactNode; title: string; detail: string }[] {
  const e = plan.entitlement;
  const sorted = plan.blocks.toSorted((a, b) => a.from.localeCompare(b.from));
  const mandatory = sorted.find((b) => b.kind === 'mandatory');
  let run = 0;
  let edge = mandatory?.to;
  for (const b of sorted) {
    if (edge !== undefined && b.kind === 'flexible' && b.from === addDays(edge, 1)) {
      run += length(b.from, b.to) / 7;
      edge = b.to;
    }
  }
  const back = backOn(plan);
  const out: { icon: ReactNode; title: string; detail: string }[] = [];
  if (run > 0 && back !== null) {
    out.push({
      icon: <icons.parental aria-hidden />,
      title: 'Most time at the start',
      detail: `${String(run)} of your ${String(e.flexibleWeeks)} flexible weeks follow the mandatory ${String(e.mandatoryWeeks)}, so you’re home until ${dayDate(addDays(back, -1))}.`,
    });
  }
  if (plan.reminders.length > 0) {
    out.push({
      icon: <icons.notifications aria-hidden />,
      title: 'Reminders for notice',
      detail: `Each flexible block needs ${String(e.noticeDays)} days’ notice. You’re reminded on ${plan.reminders.map((r) => shortDate(r.remindOn)).join(', ')}.`,
    });
  }
  if (plan.keptWeeks > 0) {
    out.push({
      icon: <icons.scheduled aria-hidden />,
      title: `${weeks(plan.keptWeeks)} kept for later`,
      detail: `Book them any time before ${longDate(e.laterBefore)}.`,
    });
  }
  return out;
}

function Laid({
  data,
  plan,
  onBlocks,
  onNavigate,
}: ParentalPlanProps & { readonly data: ParentalData; readonly plan: Plan }): JSX.Element {
  const write = useWrite();
  const e = plan.entitlement;
  const move = (index: number, from: string, to: string): void => {
    if (onBlocks === undefined) return;
    const blocks = plan.blocks.map((b, i) =>
      i === index ? { kind: b.kind, from, to } : { kind: b.kind, from: b.from, to: b.to },
    );
    write.run(() => onBlocks(plan.planId, blocks));
  };
  const total = e.mandatoryWeeks + e.flexibleWeeks + e.laterWeeks + e.companyWeeks;
  return (
    <Frame
      data={data}
      step="plan"
      onNavigate={onNavigate}
      actions={
        <>
          <Button asChild>
            <a href={href('about')}>{t('parental.plan.back', 'Back')}</a>
          </Button>
          <Button variant="primary" asChild endIcon={<icons.forward aria-hidden />}>
            <a href={href('handover')}>{t('parental.plan.next_handover', 'Next: handover')}</a>
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2 @min-[40rem]/parental:hidden">
        <Stat
          label={t('parental.plan.by_law', 'By law')}
          value={String(lawWeeks(e))}
          unit="weeks"
        />
        <Stat
          label={t('parental.plan.company', 'Company')}
          value={String(e.companyWeeks)}
          unit="weeks"
        />
        <Stat label={t('parental.plan.paid', 'Paid')} value={`${String(e.payPercent)}%`} />
      </div>
      {plan.problems.length === 0 ? null : (
        <Alert
          tone="warning"
          title={t('parental.plan.this_plan_cant_be_sent_yet', 'This plan can’t be sent yet')}
        >
          <ul className="list-disc ps-5">
            {plan.problems.map((p) => (
              <li key={p.code}>{p.message}</li>
            ))}
          </ul>
        </Alert>
      )}
      <Refused
        failed={write.failed}
        title={t('parental.plan.the_block_did_not_move', 'The block did not move')}
      />
      <PageSection
        title={t('parental.plan.your_plan_2', 'Your plan · {{weeks}}', { weeks: weeks(total) })}
      >
        <Card padded className="@max-[40rem]/parental:hidden">
          <PlanTrack plan={plan} {...(onBlocks === undefined ? {} : { onMove: move })} />
        </Card>
        <Card padded className="@min-[40rem]/parental:hidden">
          <VerticalPlan plan={plan} />
        </Card>
      </PageSection>
      <div className="flex flex-col gap-5 @min-[56rem]/parental:grid @min-[56rem]/parental:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] @min-[56rem]/parental:items-start">
        <PageSection
          title={t('parental.plan.pay_while_youre_away', 'Pay while you’re away')}
          className="@max-[40rem]/parental:hidden"
        >
          <List>
            {payPeriods(plan.blocks).map((p) => (
              <ListItem
                key={p.from}
                icon={<icons.payment aria-hidden />}
                iconTone={p.paidBy === 'employer' ? 'chart-2' : 'chart-3'}
                description={
                  p.paidBy === 'employer'
                    ? t('parental.plan.normal_pay', 'Normal pay')
                    : t(
                        'parental.plan.of_your_regulatory_base',
                        '{{percent}}% of your regulatory base',
                        { percent: String(p.percent) },
                      )
                }
                trailing={<span className="text-sm text-fg-muted">{spanLabel(p.from, p.to)}</span>}
              >
                {PAYER[p.paidBy] ?? p.paidBy}
              </ListItem>
            ))}
          </List>
        </PageSection>
        <AssistantCard
          title={t('parental.plan.why_this_plan', 'Why this plan')}
          action={
            plan.explanation?.ai === true ? (
              <Badge tone="assistant" size="sm">
                {t('parental.plan.ai', 'AI')}
              </Badge>
            ) : undefined
          }
          note={t(
            'parental.plan.drag_any_block_on_the_timeline',
            'Drag any block on the timeline. The rules are checked as you go.',
          )}
        >
          {plan.explanation === undefined ? null : (
            <p className="text-sm text-fg-muted">{plan.explanation.text}</p>
          )}
          <List>
            {reasons(plan).map((r) => (
              <ListItem key={r.title} icon={r.icon} iconTone="neutral" description={r.detail}>
                {r.title}
              </ListItem>
            ))}
          </List>
        </AssistantCard>
      </div>
    </Frame>
  );
}

const VERTICAL: Record<
  BlockKind,
  (b: Block, plan: Plan) => { lead: string; title: string; detail: string }
> = {
  mandatory: (b, plan) => ({
    lead:
      plan.birth === null
        ? t('parental.plan.from_the_birth_due', 'From the birth · due {{date}}', {
            date: shortDate(plan.childDate),
          })
        : t('parental.plan.from_the_birth_born', 'From the birth · born {{date}}', {
            date: shortDate(plan.childDate),
          }),
    title: t('parental.plan.mandatory_2', '{{from}}, mandatory', { from: duration(b.from, b.to) }),
    detail: t('parental.plan.full_time', '{{spanLabel}} · full time', {
      spanLabel: spanLabel(b.from, b.to),
    }),
  }),
  flexible: (b, plan) => {
    const notice = plan.reminders.find((r) => r.blockFrom === b.from);
    return {
      lead: spanLabel(b.from, b.to),
      title: t('parental.plan.flexible_2', '{{from}} flexible', { from: duration(b.from, b.to) }),
      detail:
        notice === undefined
          ? t('parental.plan.social_security_pays', 'Social Security pays')
          : t('parental.plan.give_notice_by', 'Give notice by {{remindOn}}', {
              remindOn: shortDate(notice.remindOn),
            }),
    };
  },
  vacation: (b) => ({
    lead: spanLabel(b.from, b.to),
    title: t('parental.plan.of_vacation', '{{from}} of vacation', { from: duration(b.from, b.to) }),
    detail: t('parental.plan.normal_pay', 'Normal pay'),
  }),
  company: (b) => ({
    lead: spanLabel(b.from, b.to),
    title: t('parental.plan.from_your_company', '{{from}} from your company', {
      from: duration(b.from, b.to),
    }),
    detail: t('parental.plan.normal_pay', 'Normal pay'),
  }),
  later: (b) => ({
    lead: spanLabel(b.from, b.to),
    title: t('parental.plan.later', '{{from}} later', { from: duration(b.from, b.to) }),
    detail: t('parental.plan.social_security_pays', 'Social Security pays'),
  }),
};

/** MT11: one block per period, down the page, with the rule, the dates and the pay. */
function VerticalPlan({ plan }: { readonly plan: Plan }): JSX.Element {
  const sorted = plan.blocks.toSorted((a, b) => a.from.localeCompare(b.from));
  return (
    <List aria-label={t('parental.plan.your_plan_block_by_block', 'Your plan, block by block')}>
      {sorted.map((b) => {
        const v = VERTICAL[b.kind](b, plan);
        return (
          <ListItem
            key={`${b.kind}${b.from}`}
            icon={<icons.parental aria-hidden />}
            iconTone={
              b.kind === 'vacation' ? 'chart-1' : b.kind === 'company' ? 'chart-2' : 'chart-3'
            }
            meta={v.lead}
            description={v.detail}
          >
            {v.title}
          </ListItem>
        );
      })}
      {plan.keptWeeks > 0 ? (
        <ListItem
          icon={<icons.scheduled aria-hidden />}
          iconTone="neutral"
          meta={t('parental.plan.until', 'Until {{year}}', {
            year: year(plan.entitlement.laterBefore),
          })}
          description={t('parental.plan.book_any_time', 'Book any time')}
        >
          {t('parental.plan.kept_for_later', '{{weeks}} kept for later', {
            weeks: weeks(plan.keptWeeks),
          })}
        </ListItem>
      ) : null}
    </List>
  );
}

/* --------------------------------------------------------- T10, MT12 -- */

function Handover({
  data,
  plan,
  onHandover,
  onNavigate,
}: ParentalPlanProps & { readonly data: ParentalData; readonly plan: Plan }): JSX.Element {
  const [items, setItems] = useState(plan.handover);
  const [teamSees, setTeamSees] = useState<TeamSees>(plan.teamSees);
  const [work, setWork] = useState('');
  const [coveredBy, setCoveredBy] = useState('');
  const write = useWrite();
  const add = (): void => {
    if (work.trim() === '' || coveredBy.trim() === '') return;
    setItems([...items, { work: work.trim(), coveredBy: coveredBy.trim() }]);
    setWork('');
    setCoveredBy('');
  };
  const next = (): void => {
    if (onHandover === undefined) return;
    write.run(
      () => onHandover(plan.planId, items, teamSees),
      () => onNavigate?.(href('send')),
    );
  };
  const away = backOn(plan);
  return (
    <Frame
      data={data}
      step="handover"
      onNavigate={onNavigate}
      actions={
        <>
          <Button asChild>
            <a href={href('plan')}>{t('parental.plan.back', 'Back')}</a>
          </Button>
          <Button
            variant="primary"
            endIcon={<icons.forward aria-hidden />}
            disabled={onHandover === undefined || write.pending}
            onClick={next}
          >
            {t('parental.plan.next_send', 'Next: send')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 @min-[56rem]/parental:grid @min-[56rem]/parental:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @min-[56rem]/parental:items-start">
        <PageSection
          title={t('parental.plan.who_covers_your_work', 'Who covers your work')}
          description={t(
            'parental.plan.nobody_is_asked_until_agrees_they',
            'Nobody is asked until {{managerWord}} agrees. They can say no.',
            { managerWord: managerWord(data) },
          )}
        >
          <Card padded className="flex flex-col gap-4">
            {items.length === 0 ? (
              <p className="text-sm text-fg-muted">
                {t('parental.plan.nothing_handed_over_yet', 'Nothing handed over yet.')}
              </p>
            ) : (
              <List>
                {items.map((item, i) => (
                  <ListItem
                    key={`${item.work}${String(i)}`}
                    icon={<icons.team aria-hidden />}
                    iconTone="neutral"
                    description={item.coveredBy}
                    trailing={
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('parental.plan.remove', 'Remove {{work}}', {
                          work: item.work,
                        })}
                        startIcon={<icons.remove aria-hidden />}
                        onClick={() => {
                          setItems(items.filter((_, j) => j !== i));
                        }}
                      />
                    }
                  >
                    {item.work}
                  </ListItem>
                ))}
              </List>
            )}
            <div className="flex flex-col gap-3 @min-[40rem]/parental:flex-row @min-[40rem]/parental:items-end">
              <Field className="flex-1">
                <FieldLabel>{t('parental.plan.work', 'Work')}</FieldLabel>
                <FieldControl>
                  <Input
                    value={work}
                    onChange={(ev) => {
                      setWork(ev.target.value);
                    }}
                    placeholder={t(
                      'parental.plan.billing_v2_code_reviews',
                      'Billing v2 code reviews',
                    )}
                  />
                </FieldControl>
              </Field>
              <Field className="flex-1">
                <FieldLabel>{t('parental.plan.covered_by', 'Covered by')}</FieldLabel>
                <FieldControl>
                  <Input
                    value={coveredBy}
                    onChange={(ev) => {
                      setCoveredBy(ev.target.value);
                    }}
                    placeholder={t('parental.plan.a_teammate', 'A teammate')}
                  />
                </FieldControl>
              </Field>
              <Button
                startIcon={<icons.add aria-hidden />}
                onClick={add}
                disabled={work.trim() === '' || coveredBy.trim() === ''}
              >
                {t('parental.plan.add', 'Add')}
              </Button>
            </div>
          </Card>
        </PageSection>
        <div className="flex flex-col gap-5">
          <PageSection title={t('parental.plan.while_youre_away', 'While you’re away')}>
            <Card padded className="flex flex-col gap-4">
              <Integration
                icon={<icons.email aria-hidden />}
                label={t('parental.plan.out_of_office_reply', 'Out-of-office reply')}
                needs="calendar"
                detail={
                  away === null
                    ? t('parental.plan.from', 'From {{childDate}}', {
                        childDate: shortDate(plan.childDate),
                      })
                    : t('parental.plan.from_until', 'From {{childDate}}, until {{until}}', {
                        childDate: shortDate(plan.childDate),
                        until: shortDate(away),
                      })
                }
              />
              <Integration
                icon={<icons.message aria-hidden />}
                label={t('parental.plan.chat_status', 'Chat status')}
                needs="chat"
                detail={
                  away === null
                    ? t('parental.plan.on_parental_leave', 'On parental leave')
                    : t(
                        'parental.plan.on_parental_leave_until',
                        'On parental leave until {{away}}',
                        { away: shortDate(away) },
                      )
                }
              />
              <Integration
                icon={<icons.calendar aria-hidden />}
                label={t('parental.plan.recurring_meetings', 'Recurring meetings')}
                needs="calendar"
                detail={t('parental.plan.declined_from', 'Declined from {{childDate}}', {
                  childDate: shortDate(plan.childDate),
                })}
              />
            </Card>
          </PageSection>
          <TeamSeesChoice value={teamSees} onChange={setTeamSees} manager={managerWord(data)} />
          <Refused
            failed={write.failed}
            title={t('parental.plan.the_handover_was_not_saved', 'The handover was not saved')}
          />
        </div>
      </div>
    </Frame>
  );
}

/** A switch an integration will run, shown and off until it is connected (TOF-110, TOF-111). */
function Integration({
  icon,
  label,
  detail,
  needs,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly detail: string;
  readonly needs: 'calendar' | 'chat';
}): JSX.Element {
  return (
    <Field orientation="horizontal" disabled className="items-start justify-between gap-4">
      <div className="flex gap-3 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-muted">
        {icon}
        <div>
          <FieldLabel>{label}</FieldLabel>
          <FieldDescription>
            {t(
              'parental.plan.needs_the_integration',
              '{{detail}}. Needs the {{needs}} integration.',
              { detail, needs },
            )}
          </FieldDescription>
        </div>
      </div>
      <FieldControl>
        <Switch checked={false} disabled />
      </FieldControl>
    </Field>
  );
}

/* -------------------------------------------------------------- send -- */

function summary(data: ParentalData, plan: Plan): { label: string; value: string }[] {
  const e = plan.entitlement;
  const back = backOn(plan);
  return [
    {
      label: t('parental.plan.leave', 'Leave'),
      value:
        e.companyWeeks > 0
          ? `${weeks(lawWeeks(e))} + ${weeks(e.companyWeeks)} from your company`
          : weeks(lawWeeks(e)),
    },
    {
      label: t('parental.plan.first_day', 'First day'),
      value:
        plan.role === 'adopting'
          ? `The decision, ${longDate(plan.childDate)}`
          : plan.birth === null
            ? `The birth, due ${longDate(plan.childDate)}`
            : `The birth, ${longDate(plan.childDate)}`,
    },
    ...(back === null
      ? []
      : [{ label: t('parental.plan.back_at_work', 'Back at work'), value: dayDate(back) }]),
    ...(plan.keptWeeks > 0
      ? [
          {
            label: t('parental.plan.kept_for_later_2', 'Kept for later'),
            value: `${weeks(plan.keptWeeks)}, until ${year(e.laterBefore)}`,
          },
        ]
      : []),
    {
      label: t('parental.plan.who_sees_it', 'Who sees it'),
      value: `HR, ${data.managerName ?? 'your manager'}. Team sees ${plan.teamSees === 'type' ? '“Parental leave”' : '“Away”'}`,
    },
  ];
}

function Send({
  data,
  plan,
  onSend,
  onNavigate,
}: ParentalPlanProps & { readonly data: ParentalData; readonly plan: Plan }): JSX.Element {
  const write = useWrite();
  const blocked = plan.problems.length > 0;
  return (
    <Frame
      data={data}
      step="send"
      onNavigate={onNavigate}
      actions={
        <>
          <Button asChild>
            <a href={href('handover')}>{t('parental.plan.back', 'Back')}</a>
          </Button>
          <Button
            variant="primary"
            startIcon={<icons.send aria-hidden />}
            disabled={onSend === undefined || blocked || write.pending}
            onClick={() => {
              if (onSend !== undefined) write.run(() => onSend(plan.planId));
            }}
          >
            {t('parental.plan.send_to_hr_and', 'Send to HR and {{managerWord}}', {
              managerWord: managerWord(data),
            })}
          </Button>
        </>
      }
    >
      <div className="flex max-w-3xl flex-col gap-5">
        {blocked ? (
          <Alert
            tone="warning"
            title={t(
              'parental.plan.fix_the_plan_before_sending_it',
              'Fix the plan before sending it',
            )}
          >
            <ul className="list-disc ps-5">
              {plan.problems.map((p) => (
                <li key={p.code}>{p.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <PageSection title={t('parental.plan.summary', 'Summary')}>
          <Card padded>
            <KeyValues items={summary(data, plan)} />
          </Card>
        </PageSection>
        {plan.role === 'adopting' ? null : (
          <Alert
            tone="info"
            title={t('parental.plan.the_dates_follow_the_birth', 'The dates follow the birth')}
          >
            {t(
              'parental.plan.if_the_baby_arrives_early_or',
              'If the baby arrives early or late, the plan shifts. Record the date and the mandatory weeks move with it.',
            )}
          </Alert>
        )}
        <Alert
          tone="neutral"
          title={t('parental.plan.private_until_you_send_it', 'Private until you send it')}
        >
          {t(
            'parental.plan.your_draft_is_only_visible_to',
            'Your draft is only visible to you. HR and {{managerWord}} get it when you press Send.',
            { managerWord: managerWord(data) },
          )}
        </Alert>
        <Refused
          failed={write.failed}
          title={t('parental.plan.the_plan_was_not_sent', 'The plan was not sent')}
        />
      </div>
    </Frame>
  );
}

/* -------------------------------------------------------------- sent -- */

function Sent({
  data,
  plan,
  onBirth,
}: ParentalPlanProps & { readonly data: ParentalData; readonly plan: Plan }): JSX.Element {
  const [birth, setBirth] = useState<string | null>(null);
  const write = useWrite();
  const approved = plan.status === 'approved';
  return (
    <>
      <PageHeader
        title={t('parental.plan.your_parental_leave', 'Your parental leave')}
        description={
          plan.sentAt === null
            ? undefined
            : t('parental.plan.sent', 'Sent {{dayDate}}', { dayDate: dayDate(plan.sentAt) })
        }
        actions={
          <Badge tone={approved ? 'success' : 'warning'} dot>
            {approved
              ? t('parental.plan.approved', 'Approved')
              : t('parental.plan.with_hr_and', 'With HR and {{managerWord}}', {
                  managerWord: managerWord(data),
                })}
          </Badge>
        }
      />
      <PageSection title={t('parental.plan.your_plan', 'Your plan')}>
        <Card padded className="@max-[40rem]/parental:hidden">
          <PlanTrack plan={plan} />
        </Card>
        <Card padded className="@min-[40rem]/parental:hidden">
          <VerticalPlan plan={plan} />
        </Card>
      </PageSection>
      <div className="flex flex-col gap-5 @min-[56rem]/parental:grid @min-[56rem]/parental:grid-cols-2 @min-[56rem]/parental:items-start">
        <PageSection title={t('parental.plan.summary', 'Summary')}>
          <Card padded>
            <KeyValues items={summary(data, plan)} />
          </Card>
        </PageSection>
        {plan.role === 'adopting' || plan.birth !== null || onBirth === undefined ? null : (
          <PageSection
            title={t('parental.plan.the_baby_is_here', 'The baby is here')}
            description={t(
              'parental.plan.the_mandatory_weeks_move_to_the',
              'The mandatory weeks move to the day of the birth, and HR and your manager are told.',
            )}
          >
            <Card padded className="flex flex-col gap-4">
              <Field>
                <FieldLabel>{t('parental.plan.date_of_birth', 'Date of birth')}</FieldLabel>
                <FieldControl>
                  <DatePicker
                    label={t('parental.plan.date_of_birth', 'Date of birth')}
                    value={birth}
                    onChange={setBirth}
                  />
                </FieldControl>
              </Field>
              <Button
                variant="primary"
                className="self-start"
                disabled={birth === null || write.pending}
                onClick={() => {
                  if (birth !== null) write.run(() => onBirth(plan.planId, birth));
                }}
              >
                {t('parental.plan.record_the_birth', 'Record the birth')}
              </Button>
              <Refused
                failed={write.failed}
                title={t('parental.plan.the_birth_was_not_recorded', 'The birth was not recorded')}
              />
            </Card>
          </PageSection>
        )}
      </div>
    </>
  );
}

/* ----------------------------------------------------------- skeleton -- */

/** The steps while they load, in their shape: the header, the stepper and two columns. */
export function ParentalSkeleton(): JSX.Element {
  return (
    <div className="@container/parental flex flex-col gap-6">
      <PageHeader
        title={t('parental.plan.plan_parental_leave', 'Plan parental leave')}
        description={' '}
      />
      <div role="status" className="flex flex-col gap-5">
        <span className="sr-only">
          {t('parental.plan.loading_your_parental_leave_plan', 'Loading your parental leave plan')}
        </span>
        <Skeleton className="h-12 max-w-4xl rounded-lg" />
        <div className="flex flex-col gap-5 @min-[56rem]/parental:grid @min-[56rem]/parental:grid-cols-2">
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
