import {
  Alert,
  AssistantCard,
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
import { t } from '../i18n';

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
      {load.status === 'error' ? (
        <PageHeader title={t('parental.case.parental_leave', 'Parental leave')} />
      ) : null}
      <Loaded
        load={load}
        what={t('parental.case.this_parental_leave_case', 'this parental leave case')}
      >
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
        title: t('parental.case.entitlement_checked', 'Entitlement checked'),
        detail:
          e.companyWeeks > 0
            ? t(
                'parental.case.by_law_from_the_company',
                '{{weeks}} by law, {{weeks2}} from the company.',
                { weeks: weeks(lawWeeks(e)), weeks2: weeks(e.companyWeeks) },
              )
            : t('parental.case.by_law', '{{weeks}} by law.', { weeks: weeks(lawWeeks(e)) }),
      };
    case 'manager_told':
      return {
        title:
          managerName == null
            ? t('parental.case.the_manager_told', 'The manager told')
            : t('parental.case.told', '{{value}} told', {
                value: managerName.split(' ')[0] ?? managerName,
              }),
        detail:
          plan.sentAt === null
            ? t('parental.case.when_the_plan_is_sent', 'When the plan is sent.')
            : t('parental.case.sent_the_plan_on', 'Sent the plan on {{sentAt}}.', {
                sentAt: shortDate(plan.sentAt),
              }),
      };
    case 'certificate':
      return {
        title: t(
          'parental.case.company_certificate_for_social_security',
          'Company certificate for Social Security',
        ),
        detail: t(
          'parental.case.drafted_from_s_pay_history_once',
          'Drafted from {{first}}’s pay history once you confirm it. Needs your signature.',
          { first },
        ),
      };
    case 'payroll':
      return {
        title: t('parental.case.pause_salary_in_payroll', 'Pause salary in Payroll'),
        detail:
          sorted[0] === undefined || back === null
            ? t(
                'parental.case.for_the_weeks_social_security_pays',
                'For the weeks Social Security pays.',
              )
            : t(
                'parental.case.for_the_weeks_social_security_pays_2',
                '{{from}} – {{addDays}}, for the weeks Social Security pays.',
                { from: shortDate(sorted[0].from), addDays: shortDate(addDays(back, -1)) },
              ),
      };
    case 'benefits':
      return {
        title: t('parental.case.add_the_baby_as_a_dependent', 'Add the baby as a dependent'),
        detail: t(
          'parental.case.health_insurance_in_benefits_after_the',
          'Health insurance in Benefits, after the birth certificate.',
        ),
      };
    case 'birth_certificate':
      return {
        title: t('parental.case.birth_certificate', 'Birth certificate'),
        detail:
          plan.birth !== null
            ? t(
                'parental.case.ask_for_it_the_baby_was',
                'Ask {{first}} for it: the baby was born on {{birth}}.',
                { first, birth: shortDate(plan.birth) },
              )
            : on === null
              ? t('parental.case.asked_of_after_the_birth', 'Asked of {{first}} after the birth.', {
                  first,
                })
              : t(
                  'parental.case.time_off_asks_for_it_on',
                  'Time Off asks {{first}} for it on {{on}}, 3 days after the due date.',
                  { first, on: shortDate(on) },
                ),
      };
  }
}

const MODULE: Record<'payroll' | 'benefits', string> = {
  payroll: t('parental.case.payroll_module', 'Payroll module'),
  benefits: t('parental.case.benefits_module', 'Benefits module'),
};

function trailing(item: ParentalCaseData['checklist'][number]): ReactNode {
  switch (item.status) {
    case 'done':
      return (
        <Badge size="sm" tone="success">
          {t('parental.case.done', 'Done')}
        </Badge>
      );
    case 'scheduled':
      return (
        <Badge size="sm" tone="info">
          {t('parental.case.scheduled', 'Scheduled')}
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
          {t('parental.case.to_do', 'To do')}
        </Badge>
      );
  }
}

/** The domain's rules, each said as passed or not: what the plan breaks is in `problems`. */
const RULES: readonly { code: string; passed: (plan: Plan) => string }[] = [
  {
    code: 'WHOLE_WEEKS',
    passed: () =>
      t(
        'parental.case.flexible_weeks_are_taken_in_whole',
        'Flexible weeks are taken in whole weeks',
      ),
  },
  {
    code: 'FLEXIBLE_DEADLINE',
    passed: (plan) =>
      t('parental.case.flexible_weeks_end_before', 'Flexible weeks end before {{longDate}}', {
        longDate: longDate(plan.entitlement.flexibleBefore),
      }),
  },
  {
    code: 'MANDATORY_AT_BIRTH',
    passed: (plan) =>
      t(
        'parental.case.the_mandatory_weeks_run_from_the',
        'The {{mandatoryWeeks}} mandatory weeks run from the birth',
        { mandatoryWeeks: String(plan.entitlement.mandatoryWeeks) },
      ),
  },
  {
    code: 'OVER_ENTITLEMENT',
    passed: () =>
      t(
        'parental.case.every_total_is_within_the_entitlement',
        'Every total is within the entitlement',
      ),
  },
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
        {t('parental.case.approved', 'Approved')}
      </Badge>
    ) : (
      <Badge tone="warning" dot>
        {t('parental.case.waiting_for_hr', 'Waiting for HR')}
      </Badge>
    );
  return (
    <>
      <PageHeader
        title={t('parental.case.parental_leave_2', '{{displayName}} · parental leave', {
          displayName: member.displayName,
        })}
        description={[
          plan.sentAt === null
            ? null
            : t('parental.case.sent', 'Sent {{sentAt}}', { sentAt: shortDate(plan.sentAt) }),
          plan.birth === null
            ? t('parental.case.due', 'due {{longDate}}', { longDate: longDate(due) })
            : t('parental.case.born', 'born {{longDate}}', { longDate: longDate(plan.birth) }),
          back === null
            ? null
            : t('parental.case.back', 'back {{longDate}}', { longDate: longDate(back) }),
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
              {t('parental.case.approve_plan', 'Approve plan')}
            </Button>
          ) : (
            status
          )
        }
      />
      {failed === null ? null : (
        <Alert
          tone="danger"
          title={t('parental.case.the_plan_was_not_approved', 'The plan was not approved')}
        >
          {failed}
        </Alert>
      )}
      <PageSection title={t('parental.case.plan', 'Plan')}>
        <Card padded>
          <PlanTrack plan={plan} />
        </Card>
      </PageSection>
      <div className="flex flex-col gap-5 @min-[56rem]/case:grid @min-[56rem]/case:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] @min-[56rem]/case:items-start">
        <PageSection
          title={t('parental.case.checklist', 'Checklist')}
          actions={
            <span className="text-sm font-medium text-fg-muted">
              {t('parental.case.of', '{{done}} of {{length}}', {
                done: String(done),
                length: String(data.checklist.length),
              })}
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
          {plan.explanation === undefined ? null : (
            <AssistantCard
              level={2}
              title={t('parental.case.why_this_plan', 'Why this plan')}
              action={
                plan.explanation.ai ? (
                  <Badge tone="assistant" size="sm">
                    {t('parental.case.ai', 'AI')}
                  </Badge>
                ) : undefined
              }
            >
              <p className="text-sm text-fg-muted">{plan.explanation.text}</p>
            </AssistantCard>
          )}
          <PageSection
            title={t('parental.case.checked_against_the_rules', 'Checked against the rules')}
          >
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
                      description={
                        broken.has(r.code)
                          ? t('parental.case.broken', 'Broken')
                          : t('parental.case.passed', 'Passed')
                      }
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
                      description={t('parental.case.broken', 'Broken')}
                    >
                      {p.message}
                    </ListItem>
                  ))}
                {plan.reminders.map((r) => (
                  <ListItem
                    key={r.blockFrom}
                    icon={<icons.warning aria-hidden />}
                    iconTone="chart-4"
                    description={t(
                      'parental.case.is_reminded_on_nothing_to_do',
                      '{{firstName}} is reminded on {{remindOn}}. Nothing to do now.',
                      { firstName: member.firstName, remindOn: shortDate(r.remindOn) },
                    )}
                  >
                    {t(
                      'parental.case.the_block_from_needs_days_notice',
                      'The block from {{blockFrom}} needs {{noticeDays}} days’ notice',
                      {
                        blockFrom: shortDate(r.blockFrom),
                        noticeDays: String(plan.entitlement.noticeDays),
                      },
                    )}
                  </ListItem>
                ))}
              </List>
            </Card>
          </PageSection>
          <PageSection title={t('parental.case.who_can_see_this', 'Who can see this')}>
            <Card padded>
              <KeyValues
                items={[
                  { label: member.displayName, value: 'Everything' },
                  ...(data.managerName === null
                    ? []
                    : [{ label: data.managerName, value: 'Dates and handover' }]),
                  {
                    label:
                      member.teamName === null
                        ? t('parental.case.the_team', 'The team')
                        : t('parental.case.team', '{{teamName}} team', {
                            teamName: member.teamName,
                          }),
                    value: `${plan.teamSees === 'type' ? '“Parental leave”' : '“Away”'}, dates`,
                  },
                  { label: 'HR', value: 'Everything, plus documents' },
                ]}
              />
            </Card>
          </PageSection>
          {plan.handover.length === 0 ? null : (
            <PageSection title={t('parental.case.handover', 'Handover')}>
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
            <p className="text-sm text-fg-muted">
              {t('parental.case.approved_2', 'Approved {{dayDate}}.', {
                dayDate: dayDate(plan.approvedAt),
              })}
            </p>
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
      <PageHeader title={t('parental.case.parental_leave', 'Parental leave')} description={' '} />
      <div role="status" className="flex flex-col gap-5">
        <span className="sr-only">
          {t('parental.case.loading_this_parental_leave_case', 'Loading this parental leave case')}
        </span>
        <Skeleton className="h-64 rounded-lg" />
        <div className="flex flex-col gap-5 @min-[56rem]/case:grid @min-[56rem]/case:grid-cols-2">
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
