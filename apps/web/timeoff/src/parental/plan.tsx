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
  { id: 'about', label: 'About the baby' },
  { id: 'plan', label: 'Your plan' },
  { id: 'handover', label: 'Handover' },
  { id: 'send', label: 'Send to HR' },
] as const;
type Step = (typeof STEPS)[number]['id'];

const href = (step: Step): string => `/time-off/parental/${step}`;

export function ParentalPlan(props: ParentalPlanProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <ParentalSkeleton />;
  return (
    <div className="@container/parental flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Plan parental leave" /> : null}
      <Loaded load={load} what="your parental leave plan">
        {(data) => <Ready data={data} {...props} />}
      </Loaded>
    </div>
  );
}

/* -------------------------------------------------------------- frame -- */

/** "Marco", or "your manager" when nobody is named. */
const managerWord = (data: ParentalData): string =>
  data.managerName?.split(' ')[0] ?? 'your manager';

function Ready({
  data,
  ...props
}: ParentalPlanProps & { readonly data: ParentalData }): JSX.Element {
  const { plan } = data;
  if (data.member === null || !data.supported) {
    return (
      <>
        <PageHeader title="Plan parental leave" />
        <Alert tone="info" title="Parental leave can’t be planned here yet">
          {data.member === null
            ? 'Plans belong to the person taking the leave. Open one from HR’s view of the case.'
            : 'The law where you work isn’t in Time Off yet. HR can plan your leave with you.'}
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
        title="Plan parental leave"
        description={`Built from the law where you work and your company’s policy. Private until you send it to HR and ${managerWord(data)}.`}
        actions={actions}
      />
      <Stepper
        className="max-w-4xl"
        label="Planning parental leave"
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
  { value: 'birth_parent', label: 'The birth parent' },
  { value: 'other_parent', label: 'The other parent' },
  { value: 'adopting', label: 'Adopting or fostering' },
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
        label="What your team sees"
        value={value}
        onChange={(v) => {
          onChange(v === 'away' ? 'away' : 'type');
        }}
        options={[
          { value: 'type', label: 'Parental leave' },
          { value: 'away', label: 'Just “Away”' },
        ]}
      />
      <p className="text-xs text-fg-muted">
        {`HR and ${manager} always see the type. You can change this later.`}
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
            Save draft
          </Button>
          <Button
            variant="primary"
            endIcon={<icons.forward aria-hidden />}
            disabled={!ready || write.pending}
            onClick={() => {
              save(true);
            }}
          >
            Next: your plan
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 @min-[56rem]/parental:grid @min-[56rem]/parental:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] @min-[56rem]/parental:items-start">
        <PageSection title="About the baby">
          <Card padded className="flex flex-col gap-5">
            <Choice
              label="You are"
              value={role}
              onChange={(v) => {
                setRole(v as ParentRole);
              }}
              options={ROLES}
            />
            <Field>
              <FieldLabel>{role === 'adopting' ? 'Date of the decision' : 'Due date'}</FieldLabel>
              <FieldControl>
                <DatePicker
                  label={role === 'adopting' ? 'Date of the decision' : 'Due date'}
                  value={childDate}
                  onChange={setChildDate}
                />
              </FieldControl>
            </Field>
            <Choice
              label="Family"
              value={singleParent ? 'single' : 'two'}
              onChange={(v) => {
                setSingleParent(v === 'single');
              }}
              options={[
                { value: 'two', label: 'Two parents' },
                { value: 'single', label: 'Single parent' },
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
                <FieldLabel>Twins or more</FieldLabel>
                <FieldDescription>Adds weeks for each child after the first</FieldDescription>
              </div>
            </Field>
            <TeamSeesChoice value={teamSees} onChange={setTeamSees} manager={managerWord(data)} />
            <Refused failed={write.failed} title="Your answers were not saved" />
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
      title="What you’re entitled to"
      action={e === null ? undefined : <Badge size="sm">{e.law}</Badge>}
      note="Based on your contract, location and length of service. HR confirms it."
    >
      {e === null || childDate === null ? (
        <p className="text-sm text-fg-muted">
          Say who you are and the date, and the weeks the law and your company give you show here.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-2 @min-[40rem]/parental:grid-cols-3">
            <Stat
              label="Mandatory"
              value={String(e.mandatoryWeeks)}
              unit="weeks"
              description={`Straight after the ${role === 'adopting' ? 'decision' : 'birth'}, full time`}
            />
            <Stat
              label="Flexible"
              value={String(e.flexibleWeeks)}
              unit="weeks"
              description={`Any time before ${longDate(e.flexibleBefore)}`}
            />
            <Stat
              label="For later"
              value={String(e.laterWeeks)}
              unit="weeks"
              description={`Any time before your child turns ${String(Number(year(e.laterBefore)) - Number(year(childDate)))}`}
            />
          </div>
          <List>
            <ListItem
              icon={<icons.payment aria-hidden />}
              iconTone="chart-3"
              description="HR prepares the certificate you need for your claim."
            >
              {`${weeks(lawWeeks(e))}, paid at ${String(e.payPercent)}% by ${PAYER[e.paidBy] ?? e.paidBy}`}
            </ListItem>
            {e.companyWeeks > 0 ? (
              <ListItem
                icon={<icons.company aria-hidden />}
                iconTone="chart-2"
                description={`Company policy for parents with ${String(e.companyAfterYears ?? 0)} ${e.companyAfterYears === 1 ? 'year' : 'years'} of service.`}
              >
                {`Your company adds ${weeks(e.companyWeeks)}, paid`}
              </ListItem>
            ) : null}
            {e.vacationAccrues ? (
              <ListItem
                icon={<icons.vacation aria-hidden />}
                iconTone="chart-1"
                description="It is there when you’re back, even in a later year."
              >
                You keep earning vacation
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
            <a href={href('about')}>Back</a>
          </Button>
          <Button variant="primary" asChild endIcon={<icons.forward aria-hidden />}>
            <a href={href('handover')}>Next: handover</a>
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2 @min-[40rem]/parental:hidden">
        <Stat label="By law" value={String(lawWeeks(e))} unit="weeks" />
        <Stat label="Company" value={String(e.companyWeeks)} unit="weeks" />
        <Stat label="Paid" value={`${String(e.payPercent)}%`} />
      </div>
      {plan.problems.length === 0 ? null : (
        <Alert tone="warning" title="This plan can’t be sent yet">
          <ul className="list-disc ps-5">
            {plan.problems.map((p) => (
              <li key={p.code}>{p.message}</li>
            ))}
          </ul>
        </Alert>
      )}
      <Refused failed={write.failed} title="The block did not move" />
      <PageSection title={`Your plan · ${weeks(total)}`}>
        <Card padded className="@max-[40rem]/parental:hidden">
          <PlanTrack plan={plan} {...(onBlocks === undefined ? {} : { onMove: move })} />
        </Card>
        <Card padded className="@min-[40rem]/parental:hidden">
          <VerticalPlan plan={plan} />
        </Card>
      </PageSection>
      <div className="flex flex-col gap-5 @min-[56rem]/parental:grid @min-[56rem]/parental:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] @min-[56rem]/parental:items-start">
        <PageSection title="Pay while you’re away" className="@max-[40rem]/parental:hidden">
          <List>
            {payPeriods(plan.blocks).map((p) => (
              <ListItem
                key={p.from}
                icon={<icons.payment aria-hidden />}
                iconTone={p.paidBy === 'employer' ? 'chart-2' : 'chart-3'}
                description={
                  p.paidBy === 'employer'
                    ? 'Normal pay'
                    : `${String(p.percent)}% of your regulatory base`
                }
                trailing={<span className="text-sm text-fg-muted">{spanLabel(p.from, p.to)}</span>}
              >
                {PAYER[p.paidBy] ?? p.paidBy}
              </ListItem>
            ))}
          </List>
        </PageSection>
        <AssistantCard
          title="Why this plan"
          note="Drag any block on the timeline. The rules are checked as you go."
        >
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
    lead: `From the birth · ${plan.birth === null ? `due ${shortDate(plan.childDate)}` : `born ${shortDate(plan.childDate)}`}`,
    title: `${duration(b.from, b.to)}, mandatory`,
    detail: `${spanLabel(b.from, b.to)} · full time`,
  }),
  flexible: (b, plan) => {
    const notice = plan.reminders.find((r) => r.blockFrom === b.from);
    return {
      lead: spanLabel(b.from, b.to),
      title: `${duration(b.from, b.to)} flexible`,
      detail:
        notice === undefined
          ? 'Social Security pays'
          : `Give notice by ${shortDate(notice.remindOn)}`,
    };
  },
  vacation: (b) => ({
    lead: spanLabel(b.from, b.to),
    title: `${duration(b.from, b.to)} of vacation`,
    detail: 'Normal pay',
  }),
  company: (b) => ({
    lead: spanLabel(b.from, b.to),
    title: `${duration(b.from, b.to)} from your company`,
    detail: 'Normal pay',
  }),
  later: (b) => ({
    lead: spanLabel(b.from, b.to),
    title: `${duration(b.from, b.to)} later`,
    detail: 'Social Security pays',
  }),
};

/** MT11: one block per period, down the page, with the rule, the dates and the pay. */
function VerticalPlan({ plan }: { readonly plan: Plan }): JSX.Element {
  const sorted = plan.blocks.toSorted((a, b) => a.from.localeCompare(b.from));
  return (
    <List aria-label="Your plan, block by block">
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
          meta={`Until ${year(plan.entitlement.laterBefore)}`}
          description="Book any time"
        >
          {`${weeks(plan.keptWeeks)} kept for later`}
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
            <a href={href('plan')}>Back</a>
          </Button>
          <Button
            variant="primary"
            endIcon={<icons.forward aria-hidden />}
            disabled={onHandover === undefined || write.pending}
            onClick={next}
          >
            Next: send
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 @min-[56rem]/parental:grid @min-[56rem]/parental:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @min-[56rem]/parental:items-start">
        <PageSection
          title="Who covers your work"
          description={`Nobody is asked until ${managerWord(data)} agrees. They can say no.`}
        >
          <Card padded className="flex flex-col gap-4">
            {items.length === 0 ? (
              <p className="text-sm text-fg-muted">Nothing handed over yet.</p>
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
                        aria-label={`Remove ${item.work}`}
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
                <FieldLabel>Work</FieldLabel>
                <FieldControl>
                  <Input
                    value={work}
                    onChange={(ev) => {
                      setWork(ev.target.value);
                    }}
                    placeholder="Billing v2 code reviews"
                  />
                </FieldControl>
              </Field>
              <Field className="flex-1">
                <FieldLabel>Covered by</FieldLabel>
                <FieldControl>
                  <Input
                    value={coveredBy}
                    onChange={(ev) => {
                      setCoveredBy(ev.target.value);
                    }}
                    placeholder="A teammate"
                  />
                </FieldControl>
              </Field>
              <Button
                startIcon={<icons.add aria-hidden />}
                onClick={add}
                disabled={work.trim() === '' || coveredBy.trim() === ''}
              >
                Add
              </Button>
            </div>
          </Card>
        </PageSection>
        <div className="flex flex-col gap-5">
          <PageSection title="While you’re away">
            <Card padded className="flex flex-col gap-4">
              <Integration
                icon={<icons.email aria-hidden />}
                label="Out-of-office reply"
                needs="calendar"
                detail={`From ${shortDate(plan.childDate)}${away === null ? '' : `, until ${shortDate(away)}`}`}
              />
              <Integration
                icon={<icons.message aria-hidden />}
                label="Chat status"
                needs="chat"
                detail={
                  away === null ? 'On parental leave' : `On parental leave until ${shortDate(away)}`
                }
              />
              <Integration
                icon={<icons.calendar aria-hidden />}
                label="Recurring meetings"
                needs="calendar"
                detail={`Declined from ${shortDate(plan.childDate)}`}
              />
            </Card>
          </PageSection>
          <TeamSeesChoice value={teamSees} onChange={setTeamSees} manager={managerWord(data)} />
          <Refused failed={write.failed} title="The handover was not saved" />
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
          <FieldDescription>{`${detail}. Needs the ${needs} integration.`}</FieldDescription>
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
          ? `The decision, ${longDate(plan.childDate)}`
          : plan.birth === null
            ? `The birth, due ${longDate(plan.childDate)}`
            : `The birth, ${longDate(plan.childDate)}`,
    },
    ...(back === null ? [] : [{ label: 'Back at work', value: dayDate(back) }]),
    ...(plan.keptWeeks > 0
      ? [
          {
            label: 'Kept for later',
            value: `${weeks(plan.keptWeeks)}, until ${year(e.laterBefore)}`,
          },
        ]
      : []),
    {
      label: 'Who sees it',
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
            <a href={href('handover')}>Back</a>
          </Button>
          <Button
            variant="primary"
            startIcon={<icons.send aria-hidden />}
            disabled={onSend === undefined || blocked || write.pending}
            onClick={() => {
              if (onSend !== undefined) write.run(() => onSend(plan.planId));
            }}
          >
            {`Send to HR and ${managerWord(data)}`}
          </Button>
        </>
      }
    >
      <div className="flex max-w-3xl flex-col gap-5">
        {blocked ? (
          <Alert tone="warning" title="Fix the plan before sending it">
            <ul className="list-disc ps-5">
              {plan.problems.map((p) => (
                <li key={p.code}>{p.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <PageSection title="Summary">
          <Card padded>
            <KeyValues items={summary(data, plan)} />
          </Card>
        </PageSection>
        {plan.role === 'adopting' ? null : (
          <Alert tone="info" title="The dates follow the birth">
            If the baby arrives early or late, the plan shifts. Record the date and the mandatory
            weeks move with it.
          </Alert>
        )}
        <Alert tone="neutral" title="Private until you send it">
          {`Your draft is only visible to you. HR and ${managerWord(data)} get it when you press Send.`}
        </Alert>
        <Refused failed={write.failed} title="The plan was not sent" />
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
        title="Your parental leave"
        description={plan.sentAt === null ? undefined : `Sent ${dayDate(plan.sentAt)}`}
        actions={
          <Badge tone={approved ? 'success' : 'warning'} dot>
            {approved ? 'Approved' : `With HR and ${managerWord(data)}`}
          </Badge>
        }
      />
      <PageSection title="Your plan">
        <Card padded className="@max-[40rem]/parental:hidden">
          <PlanTrack plan={plan} />
        </Card>
        <Card padded className="@min-[40rem]/parental:hidden">
          <VerticalPlan plan={plan} />
        </Card>
      </PageSection>
      <div className="flex flex-col gap-5 @min-[56rem]/parental:grid @min-[56rem]/parental:grid-cols-2 @min-[56rem]/parental:items-start">
        <PageSection title="Summary">
          <Card padded>
            <KeyValues items={summary(data, plan)} />
          </Card>
        </PageSection>
        {plan.role === 'adopting' || plan.birth !== null || onBirth === undefined ? null : (
          <PageSection
            title="The baby is here"
            description="The mandatory weeks move to the day of the birth, and HR and your manager are told."
          >
            <Card padded className="flex flex-col gap-4">
              <Field>
                <FieldLabel>Date of birth</FieldLabel>
                <FieldControl>
                  <DatePicker label="Date of birth" value={birth} onChange={setBirth} />
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
                Record the birth
              </Button>
              <Refused failed={write.failed} title="The birth was not recorded" />
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
      <PageHeader title="Plan parental leave" description={' '} />
      <div role="status" className="flex flex-col gap-5">
        <span className="sr-only">Loading your parental leave plan</span>
        <Skeleton className="h-12 max-w-4xl rounded-lg" />
        <div className="flex flex-col gap-5 @min-[56rem]/parental:grid @min-[56rem]/parental:grid-cols-2">
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
