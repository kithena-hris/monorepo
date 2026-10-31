import {
  Card,
  Alert,
  Badge,
  Field,
  FieldControl,
  FieldLabel,
  FormSection,
  FormSections,
  NumberField,
  PageHeader,
  PageSection,
  RadioCard,
  RadioGroup,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { amount } from '../overview/overview';
import { SettingsSkeleton, Toggle, daysLabel, useSaved } from './shared';
import { t } from '../i18n';

/**
 * Negative balance rules (T31, TOF-080): how far below zero people may go
 * and on which leave type, who approves it, and what happens to the days
 * at the year end or if the person leaves (PRD §7.4). Three decisions, each
 * with its consequence, and beside them the sentence employees will read
 * when a request would take them below zero.
 *
 * Each policy has its own rule; the page edits the one chosen under "For".
 * Saving is a revision of that policy, published at once, or kept in the
 * policy's draft when it has one, to go out with the rest of it.
 */

type Rule = {
  readonly limit: string;
  readonly approvers: 'manager' | 'manager_then_hr' | 'hr';
  readonly atYearEnd: 'next_year' | 'unpaid' | 'write_off';
  readonly onLeaving: 'final_pay' | 'write_off' | 'hr_decides';
};

export interface NegativeBalanceData {
  readonly policies: readonly {
    readonly policyId: string;
    readonly leaveTypeKey: string;
    readonly leaveTypeName: string;
    readonly version: number;
    readonly status: 'draft' | 'published';
    /** `null`: nobody may go below zero on it. */
    readonly rule: Rule | null;
  }[];
}

export interface NegativeBalanceProps {
  readonly load: Loadable<NegativeBalanceData>;
  /** Save a policy's rule; `publish` puts it in effect today, else it joins the policy's draft. */
  readonly onSave?: (policyId: string, rule: Rule | null, publish: boolean) => Promise<Outcome>;
}

const TITLE = (): string => t('settings.negative-balance.negative_balance', 'Negative balance');
const DESCRIPTION = (): string =>
  t(
    'settings.negative-balance.what_happens_when_someone_books_more_than',
    'What happens when someone books more than they’ve earned.',
  );
const page = '@container/negative flex flex-col gap-6';
// One column: settings read top to bottom, one setting per row.
const columns = 'flex max-w-4xl flex-col gap-6';

const DEFAULT_RULE: Rule = {
  limit: '3.000',
  approvers: 'manager_then_hr',
  atYearEnd: 'next_year',
  onLeaving: 'final_pay',
};

export function NegativeBalance({ load, onSave }: NegativeBalanceProps): JSX.Element {
  if (load.status === 'loading') return <NegativeBalanceSkeleton />;
  return (
    <div className={page}>
      <PageHeader title={TITLE()} description={DESCRIPTION()} />
      <Loaded
        load={load}
        what={t(
          'settings.negative-balance.the_negative_balance_rules',
          'the negative balance rules',
        )}
      >
        {(data) => <Ready data={data} onSave={onSave} />}
      </Loaded>
    </div>
  );
}

function Ready({
  data,
  onSave,
}: {
  readonly data: NegativeBalanceData;
  readonly onSave: NegativeBalanceProps['onSave'];
}): JSX.Element {
  const [chosen, setChosen] = useState(data.policies[0]?.policyId ?? null);
  const policy = data.policies.find((p) => p.policyId === chosen);
  if (policy === undefined) {
    return (
      <Alert tone="info" title={t('settings.negative-balance.no_policies_yet', 'No policies yet')}>
        {t(
          'settings.negative-balance.a_leave_type_needs_a_policy',
          'A leave type needs a policy before anyone can go below zero on it.',
        )}
      </Alert>
    );
  }
  return (
    <Editor
      key={`${policy.policyId} ${String(policy.version)}`}
      data={data}
      policy={policy}
      onChoose={setChosen}
      onSave={onSave}
    />
  );
}

function Editor({
  data,
  policy,
  onChoose,
  onSave,
}: {
  readonly data: NegativeBalanceData;
  readonly policy: NegativeBalanceData['policies'][number];
  readonly onChoose: (policyId: string) => void;
  readonly onSave: NegativeBalanceProps['onSave'];
}): JSX.Element {
  const form = useSaved<Rule | null>(policy.rule);
  const rule = form.draft;
  const set = (patch: Partial<Rule>): void => {
    form.set({ ...(rule ?? DEFAULT_RULE), ...patch });
  };
  return (
    <>
      {policy.status === 'draft' ? (
        <Alert
          tone="info"
          title={t('settings.negative-balance.has_a_draft', '{{leaveTypeName}} has a draft', {
            leaveTypeName: policy.leaveTypeName,
          })}
        >
          {t(
            'settings.negative-balance.what_you_save_here_joins_it',
            'What you save here joins it, and holds once the draft is published.',
          )}
        </Alert>
      ) : null}
      {form.refusal}
      <div className={columns}>
        <Card padded>
          <FormSections>
            <FormSection
              title={t('settings.negative-balance.borrowing', 'Borrowing')}
              description={t(
                'settings.negative-balance.how_far_below_zero_and_who',
                'How far below zero, and who says yes.',
              )}
            >
              {data.policies.length > 1 ? (
                <Field>
                  <FieldLabel>{t('settings.negative-balance.for', 'For')}</FieldLabel>
                  <Select value={policy.policyId} onValueChange={onChoose}>
                    <FieldControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FieldControl>
                    <SelectContent>
                      {data.policies.map((p) => (
                        <SelectItem key={p.policyId} value={p.policyId}>
                          {p.leaveTypeName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              <Toggle
                label={t(
                  'settings.negative-balance.let_people_go_below_zero',
                  'Let people go below zero',
                )}
                checked={rule !== null}
                onChange={(on) => {
                  form.set(on ? (policy.rule ?? DEFAULT_RULE) : null);
                }}
              />
              {rule === null ? null : (
                <>
                  <NumberField
                    label={t('settings.negative-balance.up_to_days', 'Up to (days)')}
                    value={Number(rule.limit)}
                    min={0}
                    step={0.5}
                    precision={1}
                    onChange={(n) => {
                      set({ limit: (n ?? 0).toFixed(3) });
                    }}
                  />
                  <div className="flex flex-col gap-1.5">
                    <span id="negative-approvers" className="text-sm font-medium">
                      {t('settings.negative-balance.who_approves', 'Who approves')}
                    </span>
                    <SegmentedControl
                      aria-labelledby="negative-approvers"
                      value={rule.approvers}
                      onValueChange={(approvers) => {
                        if (approvers !== '') set({ approvers: approvers as Rule['approvers'] });
                      }}
                    >
                      <SegmentedControlItem value="manager">
                        {t('settings.negative-balance.manager', 'Manager')}
                      </SegmentedControlItem>
                      <SegmentedControlItem value="manager_then_hr">
                        {t('settings.negative-balance.manager_then_hr', 'Manager, then HR')}
                      </SegmentedControlItem>
                      <SegmentedControlItem value="hr">
                        {t('settings.negative-balance.hr_only', 'HR only')}
                      </SegmentedControlItem>
                    </SegmentedControl>
                  </div>
                </>
              )}
            </FormSection>
            {rule === null ? null : (
              <FormSection
                title={t('settings.negative-balance.what_happens_next', 'What happens next')}
                description={t(
                  'settings.negative-balance.when_the_days_are_not_earned',
                  'When the days are not earned back.',
                )}
              >
                <fieldset className="flex min-w-0 flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium">
                    {t(
                      'settings.negative-balance.at_the_end_of_the_year',
                      'At the end of the year',
                    )}
                  </legend>
                  <RadioGroup
                    value={rule.atYearEnd}
                    onValueChange={(atYearEnd) => {
                      set({ atYearEnd: atYearEnd as Rule['atYearEnd'] });
                    }}
                  >
                    <RadioCard
                      value="next_year"
                      description={t(
                        'settings.negative-balance.the_person_starts_the_year_with',
                        'The person starts the year with fewer days.',
                      )}
                      badge={
                        <Badge size="sm">
                          {t('settings.negative-balance.most_common', 'Most common')}
                        </Badge>
                      }
                    >
                      {t(
                        'settings.negative-balance.take_it_from_next_years_allowance',
                        'Take it from next year’s allowance',
                      )}
                    </RadioCard>
                    <RadioCard
                      value="unpaid"
                      description={t(
                        'settings.negative-balance.deducted_from_decembers_pay',
                        'Deducted from December’s pay.',
                      )}
                    >
                      {t('settings.negative-balance.make_it_unpaid', 'Make it unpaid')}
                    </RadioCard>
                    <RadioCard
                      value="write_off"
                      description={t(
                        'settings.negative-balance.the_company_absorbs_it',
                        'The company absorbs it.',
                      )}
                    >
                      {t('settings.negative-balance.write_it_off', 'Write it off')}
                    </RadioCard>
                  </RadioGroup>
                </fieldset>
                <fieldset className="flex min-w-0 flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium">
                    {t(
                      'settings.negative-balance.if_someone_leaves_while_negative',
                      'If someone leaves while negative',
                    )}
                  </legend>
                  <RadioGroup
                    value={rule.onLeaving}
                    onValueChange={(onLeaving) => {
                      set({ onLeaving: onLeaving as Rule['onLeaving'] });
                    }}
                  >
                    <RadioCard
                      value="final_pay"
                      description={t(
                        'settings.negative-balance.shown_on_the_leavers_checklist_and',
                        'Shown on the leaver’s checklist and sent to Payroll.',
                      )}
                    >
                      {t(
                        'settings.negative-balance.deduct_it_from_final_pay',
                        'Deduct it from final pay',
                      )}
                    </RadioCard>
                    <RadioCard
                      value="write_off"
                      description={t(
                        'settings.negative-balance.the_company_absorbs_it',
                        'The company absorbs it.',
                      )}
                    >
                      {t('settings.negative-balance.write_it_off', 'Write it off')}
                    </RadioCard>
                    <RadioCard
                      value="hr_decides"
                      description={t(
                        'settings.negative-balance.hr_is_asked_when_someone_leaves',
                        'HR is asked when someone leaves.',
                      )}
                    >
                      {t('settings.negative-balance.hr_decides_each_time', 'HR decides each time')}
                    </RadioCard>
                  </RadioGroup>
                </fieldset>
              </FormSection>
            )}
          </FormSections>
        </Card>
        <div className="flex min-w-0 flex-col gap-6">
          <WhatPeopleSee rule={rule} typeName={policy.leaveTypeName} />
          {rule?.onLeaving === 'final_pay' ? (
            <Alert
              tone="info"
              title={t('settings.negative-balance.check_your_contracts', 'Check your contracts')}
            >
              {t(
                'settings.negative-balance.deducting_from_final_pay_needs_a',
                'Deducting from final pay needs a clause in the employment contract. Anyone whose contract lacks it has the days written off instead.',
              )}
            </Alert>
          ) : null}
        </div>
      </div>
      {onSave === undefined
        ? null
        : form.bar((next) => onSave(policy.policyId, next, policy.status === 'published'))}
    </>
  );
}

const APPROVES: Record<Rule['approvers'], string> = {
  get manager(): string {
    return t('settings.negative-balance.your_manager_approves_it', 'Your manager approves it.');
  },
  get manager_then_hr(): string {
    return t(
      'settings.negative-balance.your_manager_approves_it_then_hr',
      'Your manager approves it, then HR.',
    );
  },
  get hr(): string {
    return t('settings.negative-balance.hr_approves_it', 'HR approves it.');
  },
};
const YEAR_END: Record<Rule['atYearEnd'], string> = {
  get next_year(): string {
    return t(
      'settings.negative-balance.they_come_from_next_years_allowance',
      'They come from next year’s allowance.',
    );
  },
  get unpaid(): string {
    return t(
      'settings.negative-balance.any_still_below_zero_at_the',
      'Any still below zero at the end of the year are unpaid, deducted from December’s pay.',
    );
  },
  get write_off(): string {
    return t(
      'settings.negative-balance.any_still_below_zero_at_the_2',
      'Any still below zero at the end of the year are written off.',
    );
  },
};
const LEAVING: Record<Rule['onLeaving'], string> = {
  get final_pay(): string {
    return t(
      'settings.negative-balance.if_you_leave_before_earning_them',
      'If you leave before earning them back, they’re deducted from your final pay.',
    );
  },
  get write_off(): string {
    return t(
      'settings.negative-balance.if_you_leave_before_earning_them_2',
      'If you leave before earning them back, they’re written off.',
    );
  },
  get hr_decides(): string {
    return t(
      'settings.negative-balance.if_you_leave_before_earning_them_3',
      'If you leave before earning them back, HR decides what happens.',
    );
  },
};

/** The sentence a request that crosses zero shows its employee, word for word. */
export function negativeSentence(rule: Rule): string {
  const limit = daysLabel(amount(rule.limit));
  return t(
    'settings.negative-balance.this_can_take_you_up_to',
    'This can take you up to {{limit}} below zero. {{YEAR_END}} {{LEAVING}} {{APPROVES}}',
    {
      limit,
      YEAR_END: YEAR_END[rule.atYearEnd],
      LEAVING: LEAVING[rule.onLeaving],
      APPROVES: APPROVES[rule.approvers],
    },
  );
}

function WhatPeopleSee({
  rule,
  typeName,
}: {
  readonly rule: Rule | null;
  readonly typeName: string;
}): JSX.Element {
  return (
    <PageSection
      title={t('settings.negative-balance.what_people_see', 'What people see')}
      actions={<Badge size="sm">{t('settings.negative-balance.preview', 'Preview')}</Badge>}
      description={t(
        'settings.negative-balance.when_a_request_would_take_them',
        'When a request would take them below zero.',
      )}
      surface
    >
      {rule === null ? (
        <p className="text-sm">
          {t(
            'settings.negative-balance.a_request_for_more_than_someone',
            'A request for more {{typeName}} than someone has is refused, with what they have left.',
            { typeName: typeName.toLowerCase() },
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <Stat
            inset
            label={t('settings.negative-balance.balance', '{{typeName}} balance', { typeName })}
            from="0"
            value={`−${amount(rule.limit)}`}
            unit="days"
          />
          <p className="text-sm">{negativeSentence(rule)}</p>
        </div>
      )}
    </PageSection>
  );
}

/** The page while it loads: the rules' two sections, and the preview beside them. */
export function NegativeBalanceSkeleton(): JSX.Element {
  return (
    <SettingsSkeleton
      title={TITLE()}
      description={DESCRIPTION()}
      container="@container/negative"
      columns={columns}
      main={['h-72', 'h-[34rem]']}
      side={['h-56', 'h-28']}
    />
  );
}
