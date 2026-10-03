import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  KeyValues,
  List,
  ListItem,
  PageHeader,
  PageSection,
  Skeleton,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import {
  PlanTrack,
  addDays,
  backOn,
  dayDate,
  lawWeeks,
  longDate,
  shortDate,
  weeks,
  type Member,
  type Plan,
} from './shared';

/**
 * HR's view of a parental leave case (T11): the plan on its track, the
 * checklist it becomes, the rules check and who can see it. Steps that
 * belong to modules Time Off is not (Payroll, Benefits) are named and
 * linked, never done here. The rules check is the domain's, as Time Off
 * sends it: what the plan breaks, and the notice each flexible block owes.
 *
 * "Approve plan" is the shell's (`onApprove`), offered only when Time Off
 * says HR may (`canApprove`); the approval comes back as the page drawn again.
 */

type StepKey =
  'entitlement' | 'manager_told' | 'certificate' | 'payroll' | 'benefits' | 'birth_certificate';

export interface ParentalCaseData {
  readonly member: Member;
  readonly managerName: string | null;
  readonly plan: Plan;
  readonly checklist: readonly {
    readonly key: StepKey;
    readonly status: 'done' | 'todo' | 'scheduled' | 'elsewhere';
    readonly module: 'payroll' | 'benefits' | null;
    readonly on: string | null;
  }[];
  readonly canApprove: boolean;
}

export interface ParentalCaseProps {
  readonly load: Loadable<ParentalCaseData>;
  readonly onApprove?: (planId: string) => Promise<Outcome>;
}

export function ParentalCase({ load, onApprove }: ParentalCaseProps): JSX.Element {
  if (load.status === 'loading') return <CaseSkeleton />;
  return (
    <div className="@container/case flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Parental leave" /> : null}
      <Loaded load={load} what="this parental leave case">
        {(data) => <Ready data={data} onApprove={onApprove} />}
      </Loaded>
    </div>
  );
}

/** What each step says, from the plan's own dates and names. */
function step(
  key: StepKey,
  data: ParentalCaseData,
  on: string | null,
): { title: string; detail: string } {
  const { plan, member, managerName } = data;
  const e = plan.entitlement;
  const first = member.firstName;
  const sorted = plan.blocks.toSorted((a, b) => a.from.localeCompare(b.from));
  const back = backOn(plan);
  switch (key) {
    case 'entitlement':
      return {
        title: 'Entitlement checked',
        detail:
          e.companyWeeks > 0
            ? `${weeks(lawWeeks(e))} by law, ${weeks(e.companyWeeks)} from the company.`
            : `${weeks(lawWeeks(e))} by law.`,
      };
    case 'manager_told':
      return {
        title: `${managerName?.split(' ')[0] ?? 'The manager'} told`,
        detail:
          plan.sentAt === null
            ? 'When the plan is sent.'
            : `Sent the plan on ${shortDate(plan.sentAt)}.`,
      };
    case 'certificate':
      return {
        title: 'Company certificate for Social Security',
        detail: `Drafted from ${first}’s pay history once you confirm it. Needs your signature.`,
      };
    case 'payroll':
      return {
        title: 'Pause salary in Payroll',
        detail:
          sorted[0] === undefined || back === null
            ? 'For the weeks Social Security pays.'
            : `${shortDate(sorted[0].from)} – ${shortDate(addDays(back, -1))}, for the weeks Social Security pays.`,
      };
    case 'benefits':
      return {
        title: 'Add the baby as a dependent',
        detail: 'Health insurance in Benefits, after the birth certificate.',
      };
    case 'birth_certificate':
      return {
        title: 'Birth certificate',
        detail:
          plan.birth !== null
            ? `Ask ${first} for it: the baby was born on ${shortDate(plan.birth)}.`
            : on === null
              ? `Asked of ${first} after the birth.`
              : `Time Off asks ${first} for it on ${shortDate(on)}, 3 days after the due date.`,
      };
  }
}

const MODULE: Record<'payroll' | 'benefits', string> = {
  payroll: 'Payroll module',
  benefits: 'Benefits module',
};

function trailing(item: ParentalCaseData['checklist'][number]): ReactNode {
  switch (item.status) {
    case 'done':
      return (
        <Badge size="sm" tone="success">
          Done
        </Badge>
      );
    case 'scheduled':
      return (
        <Badge size="sm" tone="info">
          Scheduled
        </Badge>
      );
    case 'elsewhere':
      return item.module === null ? null : (
        <Badge size="sm" tone="accent">
          {MODULE[item.module]}
        </Badge>
      );
    case 'todo':
      return (
        <Badge size="sm" variant="outline">
          To do
        </Badge>
      );
  }
}

/** The domain's rules, each said as passed or not: what the plan breaks is in `problems`. */
const RULES: readonly { code: string; passed: (plan: Plan) => string }[] = [
  { code: 'WHOLE_WEEKS', passed: () => 'Flexible weeks are taken in whole weeks' },
  {
    code: 'FLEXIBLE_DEADLINE',
    passed: (plan) => `Flexible weeks end before ${longDate(plan.entitlement.flexibleBefore)}`,
  },
  {
    code: 'MANDATORY_AT_BIRTH',
    passed: (plan) =>
      `The ${String(plan.entitlement.mandatoryWeeks)} mandatory weeks run from the birth`,
  },
  { code: 'OVER_ENTITLEMENT', passed: () => 'Every total is within the entitlement' },
];

function Ready({
  data,
  onApprove,
}: {
  readonly data: ParentalCaseData;
  readonly onApprove: ParentalCaseProps['onApprove'];
}): JSX.Element {
  const { plan, member } = data;
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const approve = (): void => {
    if (onApprove === undefined) return;
    setFailed(null);
    start(async () => {
      const outcome = await onApprove(plan.planId);
      if (!outcome.ok) setFailed(outcome.message);
    });
  };
  const back = backOn(plan);
  const done = data.checklist.filter((c) => c.status === 'done').length;
  const broken = new Set(plan.problems.map((p) => p.code));
  const known = new Set(RULES.map((r) => r.code));
  const due = plan.dueDate ?? plan.childDate;
  const status =
    plan.status === 'approved' ? (
      <Badge tone="success" dot>
        Approved
      </Badge>
    ) : (
      <Badge tone="warning" dot>
        Waiting for HR
      </Badge>
    );
  return (
    <>
      <PageHeader
        title={`${member.displayName} · parental leave`}
        description={[
          plan.sentAt === null ? null : `Sent ${shortDate(plan.sentAt)}`,
          plan.birth === null ? `due ${longDate(due)}` : `born ${longDate(plan.birth)}`,
          back === null ? null : `back ${longDate(back)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        meta={<Avatar name={member.displayName} />}
        actions={
          data.canApprove && onApprove !== undefined ? (
            <Button
              variant="primary"
              startIcon={<icons.approve aria-hidden />}
              disabled={pending}
              onClick={approve}
            >
              Approve plan
            </Button>
          ) : (
            status
          )
        }
      />
      {failed === null ? null : (
        <Alert tone="danger" title="The plan was not approved">
          {failed}
        </Alert>
      )}
      <PageSection title="Plan">
        <Card padded>
          <PlanTrack plan={plan} />
        </Card>
      </PageSection>
      <div className="flex flex-col gap-5 @min-[56rem]/case:grid @min-[56rem]/case:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] @min-[56rem]/case:items-start">
        <PageSection
          title="Checklist"
          actions={
            <span className="text-sm font-medium text-fg-muted">
              {`${String(done)} of ${String(data.checklist.length)}`}
            </span>
          }
        >
          <Card padded>
            <List>
              {data.checklist.map((item) => {
                const words = step(item.key, data, item.on);
                return (
                  <ListItem
                    key={item.key}
                    icon={
                      item.status === 'done' ? (
                        <icons.success aria-hidden />
                      ) : (
                        <icons.pending aria-hidden />
                      )
                    }
                    iconTone={item.status === 'done' ? 'chart-3' : 'neutral'}
                    description={words.detail}
                    trailing={trailing(item)}
                  >
                    {words.title}
                  </ListItem>
                );
              })}
            </List>
          </Card>
        </PageSection>
        <div className="flex flex-col gap-5">
          <PageSection title="Checked against the rules">
            <Card padded>
              <List>
                {RULES.map((r) => {
                  const problem = plan.problems.find((p) => p.code === r.code);
                  return (
                    <ListItem
                      key={r.code}
                      icon={
                        broken.has(r.code) ? (
                          <icons.danger aria-hidden />
                        ) : (
                          <icons.success aria-hidden />
                        )
                      }
                      iconTone={broken.has(r.code) ? 'chart-5' : 'chart-3'}
                      description={broken.has(r.code) ? 'Broken' : 'Passed'}
                    >
                      {problem?.message ?? r.passed(plan)}
                    </ListItem>
                  );
                })}
                {plan.problems
                  .filter((p) => !known.has(p.code))
                  .map((p) => (
                    <ListItem
                      key={p.code}
                      icon={<icons.danger aria-hidden />}
                      iconTone="chart-5"
                      description="Broken"
                    >
                      {p.message}
                    </ListItem>
                  ))}
                {plan.reminders.map((r) => (
                  <ListItem
                    key={r.blockFrom}
                    icon={<icons.warning aria-hidden />}
                    iconTone="chart-4"
                    description={`${member.firstName} is reminded on ${shortDate(r.remindOn)}. Nothing to do now.`}
                  >
                    {`The block from ${shortDate(r.blockFrom)} needs ${String(plan.entitlement.noticeDays)} days’ notice`}
                  </ListItem>
                ))}
              </List>
            </Card>
          </PageSection>
          <PageSection title="Who can see this">
            <Card padded>
              <KeyValues
                items={[
                  { label: member.displayName, value: 'Everything' },
                  ...(data.managerName === null
                    ? []
                    : [{ label: data.managerName, value: 'Dates and handover' }]),
                  {
                    label: member.teamName === null ? 'The team' : `${member.teamName} team`,
                    value: `${plan.teamSees === 'type' ? '“Parental leave”' : '“Away”'}, dates`,
                  },
                  { label: 'HR', value: 'Everything, plus documents' },
                ]}
              />
            </Card>
          </PageSection>
          {plan.handover.length === 0 ? null : (
            <PageSection title="Handover">
              <Card padded>
                <KeyValues
                  items={plan.handover.map((h, i) => ({
                    id: String(i),
                    label: h.work,
                    value: h.coveredBy,
                  }))}
                />
              </Card>
            </PageSection>
          )}
          {plan.approvedAt === null ? null : (
            <p className="text-sm text-fg-muted">{`Approved ${dayDate(plan.approvedAt)}.`}</p>
          )}
        </div>
      </div>
    </>
  );
}

/** The case while it loads, in its shape: the header, the track, two columns. */
export function CaseSkeleton(): JSX.Element {
  return (
    <div className="@container/case flex flex-col gap-6">
      <PageHeader title="Parental leave" description={' '} />
      <div role="status" className="flex flex-col gap-5">
        <span className="sr-only">Loading this parental leave case</span>
        <Skeleton className="h-64 rounded-lg" />
        <div className="flex flex-col gap-5 @min-[56rem]/case:grid @min-[56rem]/case:grid-cols-2">
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
