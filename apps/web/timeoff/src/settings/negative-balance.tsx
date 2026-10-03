import {
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

const TITLE = 'Negative balance';
const DESCRIPTION = 'What happens when someone books more than they’ve earned.';
const page = '@container/negative flex flex-col gap-6';
const columns =
  'flex flex-col gap-6 @min-[60rem]/negative:grid @min-[60rem]/negative:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] @min-[60rem]/negative:items-start';

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
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Loaded load={load} what="the negative balance rules">
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
      <Alert tone="info" title="No policies yet">
        A leave type needs a policy before anyone can go below zero on it.
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
        <Alert tone="info" title={`${policy.leaveTypeName} has a draft`}>
          What you save here joins it, and holds once the draft is published.
        </Alert>
      ) : null}
      {form.refusal}
      <div className={columns}>
        <FormSections>
          <FormSection title="Borrowing" description="How far below zero, and who says yes.">
            {data.policies.length > 1 ? (
              <Field>
                <FieldLabel>For</FieldLabel>
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
              label="Let people go below zero"
              checked={rule !== null}
              onChange={(on) => {
                form.set(on ? (policy.rule ?? DEFAULT_RULE) : null);
              }}
            />
            {rule === null ? null : (
              <>
                <NumberField
                  label="Up to (days)"
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
                    Who approves
                  </span>
                  <SegmentedControl
                    aria-labelledby="negative-approvers"
                    value={rule.approvers}
                    onValueChange={(approvers) => {
                      if (approvers !== '') set({ approvers: approvers as Rule['approvers'] });
                    }}
                  >
                    <SegmentedControlItem value="manager">Manager</SegmentedControlItem>
                    <SegmentedControlItem value="manager_then_hr">
                      Manager, then HR
                    </SegmentedControlItem>
                    <SegmentedControlItem value="hr">HR only</SegmentedControlItem>
                  </SegmentedControl>
                </div>
              </>
            )}
          </FormSection>
          {rule === null ? null : (
            <FormSection title="What happens next" description="When the days are not earned back.">
              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">At the end of the year</legend>
                <RadioGroup
                  value={rule.atYearEnd}
                  onValueChange={(atYearEnd) => {
                    set({ atYearEnd: atYearEnd as Rule['atYearEnd'] });
                  }}
                >
                  <RadioCard
                    value="next_year"
                    description="The person starts the year with fewer days."
                    badge={<Badge size="sm">Most common</Badge>}
                  >
                    Take it from next year’s allowance
                  </RadioCard>
                  <RadioCard value="unpaid" description="Deducted from December’s pay.">
                    Make it unpaid
                  </RadioCard>
                  <RadioCard value="write_off" description="The company absorbs it.">
                    Write it off
                  </RadioCard>
                </RadioGroup>
              </fieldset>
              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">
                  If someone leaves while negative
                </legend>
                <RadioGroup
                  value={rule.onLeaving}
                  onValueChange={(onLeaving) => {
                    set({ onLeaving: onLeaving as Rule['onLeaving'] });
                  }}
                >
                  <RadioCard
                    value="final_pay"
                    description="Shown on the leaver’s checklist and sent to Payroll."
                  >
                    Deduct it from final pay
                  </RadioCard>
                  <RadioCard value="write_off" description="The company absorbs it.">
                    Write it off
                  </RadioCard>
                  <RadioCard value="hr_decides" description="HR is asked when someone leaves.">
                    HR decides each time
                  </RadioCard>
                </RadioGroup>
              </fieldset>
            </FormSection>
          )}
        </FormSections>
        <div className="flex min-w-0 flex-col gap-6">
          <WhatPeopleSee rule={rule} typeName={policy.leaveTypeName} />
          {rule?.onLeaving === 'final_pay' ? (
            <Alert tone="info" title="Check your contracts">
              Deducting from final pay needs a clause in the employment contract. Anyone whose
              contract lacks it has the days written off instead.
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
  manager: 'Your manager approves it.',
  manager_then_hr: 'Your manager approves it, then HR.',
  hr: 'HR approves it.',
};
const YEAR_END: Record<Rule['atYearEnd'], string> = {
  next_year: 'They come from next year’s allowance.',
  unpaid: 'Any still below zero at the end of the year are unpaid, deducted from December’s pay.',
  write_off: 'Any still below zero at the end of the year are written off.',
};
const LEAVING: Record<Rule['onLeaving'], string> = {
  final_pay: 'If you leave before earning them back, they’re deducted from your final pay.',
  write_off: 'If you leave before earning them back, they’re written off.',
  hr_decides: 'If you leave before earning them back, HR decides what happens.',
};

/** The sentence a request that crosses zero shows its employee, word for word. */
export function negativeSentence(rule: Rule): string {
  const limit = daysLabel(amount(rule.limit));
  return `This can take you up to ${limit} below zero. ${YEAR_END[rule.atYearEnd]} ${LEAVING[rule.onLeaving]} ${APPROVES[rule.approvers]}`;
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
      title="What people see"
      actions={<Badge size="sm">Preview</Badge>}
      description="When a request would take them below zero."
      surface
    >
      {rule === null ? (
        <p className="text-sm">
          {`A request for more ${typeName.toLowerCase()} than someone has is refused, with what they have left.`}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <Stat
            inset
            label={`${typeName} balance`}
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
      title={TITLE}
      description={DESCRIPTION}
      container="@container/negative"
      columns={columns}
      main={['h-72', 'h-[34rem]']}
      side={['h-56', 'h-28']}
    />
  );
}
