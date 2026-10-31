import {
  Card,
  Alert,
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  FormSection,
  FormSections,
  NumberField,
  PageHeader,
  PageSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TimePicker,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import {
  SettingsSkeleton,
  Toggle,
  approversLabel,
  useSaved,
  type ApprovalRule,
  type Approver,
  type LeaveTypeRow,
} from './shared';
import { t as tr } from '../i18n';

/**
 * Approval rules and team minimums (T34, TOF-082): who approves each kind of
 * request, read as a sentence, what is approved without anyone, and how many
 * of each team must be in (PRD §9.1, §9.3). Minimums warn; they never block
 * unless a policy says so, and the page says that where the minimums are.
 */

export interface AutoApproval {
  readonly shortenOrCancel: boolean;
  readonly sickUnderDays: number | null;
  readonly oneDayAboveMinimum: boolean;
}

export interface TeamMinimum {
  readonly atLeast: number;
  readonly unit: 'people' | 'percent';
}

/** "If nobody decides" (§9.7): after how many working days, to whom, reminded when. */
export interface Escalation {
  readonly afterWorkingDays: number;
  readonly to: 'manager' | 'hr';
  /** Minutes after midnight. */
  readonly remindAt: number;
}

export interface ApprovalSettingsData {
  readonly rules: readonly ApprovalRule[];
  readonly autoApproval: AutoApproval;
  readonly escalation: Escalation;
  readonly teams: readonly {
    readonly teamKey: string;
    readonly teamName: string | null;
    readonly minimum: TeamMinimum | null;
  }[];
  /** For the names of the types a rule lists. */
  readonly leaveTypes: readonly LeaveTypeRow[];
}

export interface ApprovalSettingsProps {
  readonly load: Loadable<ApprovalSettingsData>;
  readonly onSave?: (
    rules: readonly ApprovalRule[],
    autoApproval: AutoApproval,
    minimums: readonly { readonly teamKey: string; readonly minimum: TeamMinimum | null }[],
    escalation: Escalation,
  ) => Promise<Outcome>;
}

const TITLE = (): string => tr('settings.approval-settings.approvals', 'Approvals');
const DESCRIPTION = (): string =>
  tr(
    'settings.approval-settings.who_approves_each_kind_of_request_and',
    'Who approves each kind of request, and when it’s automatic.',
  );
const page = '@container/approvals flex flex-col gap-6';
// One column: settings read top to bottom, one setting per row.
const columns = 'flex max-w-4xl flex-col gap-6';

export function ApprovalSettings({ load, onSave }: ApprovalSettingsProps): JSX.Element {
  if (load.status === 'loading') return <ApprovalSettingsSkeleton />;
  return (
    <div className={page}>
      <PageHeader title={TITLE()} description={DESCRIPTION()} />
      <Loaded
        load={load}
        what={tr('settings.approval-settings.the_approval_rules', 'the approval rules')}
      >
        {(data) => <Ready data={data} onSave={onSave} />}
      </Loaded>
    </div>
  );
}

/** The chains a rule can name, as a select's values. */
const CHAINS: Record<string, readonly Approver[]> = {
  manager: ['manager'],
  manager_hr: ['manager', 'hr'],
  hr: ['hr'],
};
const chainOf = (approvers: readonly Approver[]): string =>
  Object.entries(CHAINS).find(([, c]) => c.join() === approvers.join())?.[0] ?? 'manager';

const SUBJECT: Record<ApprovalRule['subject'], string> = {
  get request(): string {
    return tr('settings.approval-settings.request', 'Request');
  },
  get plan(): string {
    return tr('settings.approval-settings.plan', 'Plan');
  },
  get timesheet(): string {
    return tr('settings.approval-settings.timesheet', 'Timesheet');
  },
};

/** What a rule covers, as a phrase: "Any request below zero", "Parental leave plans". */
function ruleTitle(rule: ApprovalRule, names: ReadonlyMap<string, string>): string {
  const types =
    rule.leaveTypes === null ? null : rule.leaveTypes.map((k) => names.get(k) ?? k).join(', ');
  if (rule.subject === 'timesheet')
    return tr(
      'settings.approval-settings.overtime_and_timesheet_changes',
      'Overtime and timesheet changes',
    );
  if (rule.subject === 'plan')
    return types === null
      ? tr('settings.approval-settings.parental_leave_plans', 'Parental leave plans')
      : tr('settings.approval-settings.plans', '{{value}} plans', { value: types });
  const what = types ?? tr('settings.approval-settings.any_request', 'Any request');
  return {
    always: what,
    below_zero: tr('settings.approval-settings.below_zero', '{{what}} below zero', { what }),
    unpaid: tr('settings.approval-settings.unpaid', '{{what}}, unpaid', { what }),
  }[rule.when];
}

interface Form {
  readonly rules: readonly ApprovalRule[];
  readonly autoApproval: AutoApproval;
  readonly minimums: Readonly<Record<string, TeamMinimum | null>>;
  readonly escalation: Escalation;
}

const ANY = 'any';
const clock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** A new rule's three choices, and the button that adds it to the list. */
function AddRule({
  types,
  onAdd,
}: {
  readonly types: readonly LeaveTypeRow[];
  readonly onAdd: (rule: ApprovalRule) => void;
}): JSX.Element {
  const [subject, setSubject] = useState<ApprovalRule['subject']>('request');
  const [type, setType] = useState<string>(ANY);
  const [when, setWhen] = useState<ApprovalRule['when']>('always');
  const pick = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    items: readonly (readonly [string, string])[],
  ): JSX.Element => (
    <Field className="min-w-0 flex-1">
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <FieldControl>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
        </FieldControl>
        <SelectContent>
          {items.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">
        {tr('settings.approval-settings.add_a_rule', 'Add a rule')}
      </legend>
      <div className="flex flex-col gap-3 @min-[36rem]/approvals:flex-row">
        {pick(
          tr('settings.approval-settings.covers', 'Covers'),
          subject,
          (v) => {
            setSubject(v as ApprovalRule['subject']);
          },
          [
            ['request', tr('settings.approval-settings.a_request', 'A request')],
            ['plan', tr('settings.approval-settings.a_parental_plan', 'A parental plan')],
            [
              'timesheet',
              tr('settings.approval-settings.overtime_and_timesheets', 'Overtime and timesheets'),
            ],
          ],
        )}
        {subject === 'timesheet'
          ? null
          : pick(tr('settings.approval-settings.leave_type', 'Leave type'), type, setType, [
              [ANY, tr('settings.approval-settings.any', 'Any')],
              ...types.map((t) => [t.definition.key, t.definition.name.default] as const),
            ])}
        {subject === 'request'
          ? pick(
              tr('settings.approval-settings.when', 'When'),
              when,
              (v) => {
                setWhen(v as ApprovalRule['when']);
              },
              [
                ['always', tr('settings.approval-settings.always', 'Always')],
                ['below_zero', tr('settings.approval-settings.below_zero_2', 'Below zero')],
                ['unpaid', tr('settings.approval-settings.unpaid_2', 'Unpaid')],
              ],
            )
          : null}
      </div>
      <div>
        <Button
          size="sm"
          variant="secondary"
          startIcon={<icons.add aria-hidden />}
          onClick={() => {
            onAdd({
              subject,
              leaveTypes: subject === 'timesheet' || type === ANY ? null : [type],
              when: subject === 'request' ? when : 'always',
              approvers: ['manager'],
            });
          }}
        >
          {tr('settings.approval-settings.add_rule', 'Add rule')}
        </Button>
      </div>
    </fieldset>
  );
}

function Ready({
  data,
  onSave,
}: {
  readonly data: ApprovalSettingsData;
  readonly onSave: ApprovalSettingsProps['onSave'];
}): JSX.Element {
  const saved: Form = {
    rules: data.rules,
    autoApproval: data.autoApproval,
    minimums: Object.fromEntries(data.teams.map((t) => [t.teamKey, t.minimum])),
    escalation: data.escalation,
  };
  const form = useSaved(saved);
  const { rules, autoApproval: auto, minimums, escalation } = form.draft;
  const set = (patch: Partial<Form>): void => {
    form.set({ ...form.draft, ...patch });
  };
  const names = new Map(data.leaveTypes.map((t) => [t.definition.key, t.definition.name.default]));
  return (
    <>
      {form.refusal}
      <div className={columns}>
        <Card padded>
          <FormSections>
            <FormSection
              title={tr('settings.approval-settings.who_approves', 'Who approves')}
              description={tr(
                'settings.approval-settings.each_kind_of_request_and_who',
                'Each kind of request, and who decides it, in order.',
              )}
            >
              {rules.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  {tr(
                    'settings.approval-settings.no_rules_yet_every_request_goes',
                    'No rules yet: every request goes to the person’s manager.',
                  )}
                </p>
              ) : (
                rules.map((rule, i) => (
                  <Field key={i} orientation="horizontal">
                    <div className="min-w-0 flex-1">
                      <FieldLabel>{ruleTitle(rule, names)}</FieldLabel>
                      <FieldDescription>
                        {[
                          SUBJECT[rule.subject],
                          ...rule.approvers.map((a) =>
                            a === 'hr' ? 'HR' : tr('settings.approval-settings.manager', 'Manager'),
                          ),
                        ].join(' → ')}
                      </FieldDescription>
                    </div>
                    <Select
                      value={chainOf(rule.approvers)}
                      onValueChange={(chain) => {
                        const approvers = CHAINS[chain] ?? rule.approvers;
                        set({ rules: rules.map((r, j) => (j === i ? { ...r, approvers } : r)) });
                      }}
                    >
                      <FieldControl>
                        <SelectTrigger className="w-48 shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                      </FieldControl>
                      <SelectContent>
                        {Object.entries(CHAINS).map(([value, chain]) => (
                          <SelectItem key={value} value={value}>
                            {approversLabel(chain)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      aria-label={tr(
                        'settings.approval-settings.remove_the_rule_for',
                        'Remove the rule for {{ruleTitle}}',
                        { ruleTitle: ruleTitle(rule, names) },
                      )}
                      startIcon={<icons.delete aria-hidden />}
                      onClick={() => {
                        set({ rules: rules.filter((_, j) => j !== i) });
                      }}
                    />
                  </Field>
                ))
              )}
              <AddRule
                types={data.leaveTypes.filter((t) => !t.deleted)}
                onAdd={(rule) => {
                  set({ rules: [...rules, rule] });
                }}
              />
            </FormSection>
            <FormSection
              title={tr(
                'settings.approval-settings.approved_automatically',
                'Approved automatically',
              )}
              description={tr(
                'settings.approval-settings.requests_that_only_give_time_back',
                'Requests that only give time back, or that nobody needs to weigh.',
              )}
            >
              <Toggle
                kind="checkbox"
                label={tr(
                  'settings.approval-settings.shortening_or_cancelling_time_off',
                  'Shortening or cancelling time off',
                )}
                checked={auto.shortenOrCancel}
                onChange={(shortenOrCancel) => {
                  set({ autoApproval: { ...auto, shortenOrCancel } });
                }}
              />
              <Toggle
                kind="checkbox"
                label={tr('settings.approval-settings.short_sick_leave', 'Short sick leave')}
                description={
                  auto.sickUnderDays === null
                    ? tr(
                        'settings.approval-settings.off_every_sick_day_goes_to',
                        'Off: every sick day goes to the manager',
                      )
                    : tr(
                        'settings.approval-settings.under_days_manager_told',
                        {
                          one: 'Under {{count}} day; the manager is told',
                          other: 'Under {{count}} days; the manager is told',
                        },
                        { count: auto.sickUnderDays },
                      )
                }
                checked={auto.sickUnderDays !== null}
                onChange={(on) => {
                  set({ autoApproval: { ...auto, sickUnderDays: on ? 3 : null } });
                }}
              />
              {auto.sickUnderDays === null ? null : (
                <NumberField
                  label={tr(
                    'settings.approval-settings.sick_leave_approved_automatically_under_days',
                    'Sick leave approved automatically under (days)',
                  )}
                  value={auto.sickUnderDays}
                  min={1}
                  max={30}
                  step={1}
                  onChange={(n) => {
                    set({ autoApproval: { ...auto, sickUnderDays: Math.max(1, n ?? 1) } });
                  }}
                />
              )}
              <Toggle
                kind="checkbox"
                label={tr(
                  'settings.approval-settings.one_day_of_vacation_with_the',
                  'One day of vacation with the team above its minimum',
                )}
                checked={auto.oneDayAboveMinimum}
                onChange={(oneDayAboveMinimum) => {
                  set({ autoApproval: { ...auto, oneDayAboveMinimum } });
                }}
              />
            </FormSection>
          </FormSections>
        </Card>
        <div className="flex min-w-0 flex-col gap-6">
          <PageSection
            title={tr('settings.approval-settings.team_minimums', 'Team minimums')}
            description={tr(
              'settings.approval-settings.how_many_must_be_in_every',
              'How many must be in, every weekday.',
            )}
            surface
          >
            {data.teams.length === 0 ? (
              <p className="text-sm text-fg-muted">
                {tr('settings.approval-settings.no_teams_yet', 'No teams yet.')}
              </p>
            ) : (
              <ul
                aria-label={tr('settings.approval-settings.team_minimums', 'Team minimums')}
                className="flex flex-col gap-4"
              >
                {data.teams.map((team) => {
                  const minimum = minimums[team.teamKey] ?? null;
                  const name = team.teamName ?? team.teamKey;
                  const setMinimum = (next: TeamMinimum | null): void => {
                    set({ minimums: { ...minimums, [team.teamKey]: next } });
                  };
                  return (
                    <li key={team.teamKey} className="flex flex-col gap-2">
                      <Field>
                        <FieldLabel>{name}</FieldLabel>
                        <Select
                          value={minimum?.unit ?? 'none'}
                          onValueChange={(unit) => {
                            setMinimum(
                              unit === 'people'
                                ? { atLeast: 1, unit }
                                : unit === 'percent'
                                  ? { atLeast: 50, unit }
                                  : null,
                            );
                          }}
                        >
                          <FieldControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FieldControl>
                          <SelectContent>
                            <SelectItem value="none">
                              {tr('settings.approval-settings.no_minimum', 'No minimum')}
                            </SelectItem>
                            <SelectItem value="people">
                              {tr(
                                'settings.approval-settings.a_number_of_people',
                                'A number of people',
                              )}
                            </SelectItem>
                            <SelectItem value="percent">
                              {tr(
                                'settings.approval-settings.a_share_of_the_team',
                                'A share of the team',
                              )}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      {minimum === null ? null : (
                        <NumberField
                          label={
                            minimum.unit === 'people'
                              ? tr(
                                  'settings.approval-settings.at_least_people_in',
                                  '{{name}}: at least (people in)',
                                  { name },
                                )
                              : tr(
                                  'settings.approval-settings.at_least_in',
                                  '{{name}}: at least (% in)',
                                  { name },
                                )
                          }
                          value={minimum.atLeast}
                          min={minimum.unit === 'percent' ? 1 : 0}
                          max={minimum.unit === 'percent' ? 100 : 500}
                          step={1}
                          onChange={(n) => {
                            setMinimum({ ...minimum, atLeast: n ?? 0 });
                          }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </PageSection>
          <Alert
            tone="info"
            title={tr(
              'settings.approval-settings.minimums_warn_they_dont_block',
              'Minimums warn, they don’t block',
            )}
          >
            {tr(
              'settings.approval-settings.people_can_still_send_a_request',
              'People can still send a request. The manager sees the clash and decides.',
            )}
          </Alert>
          <PageSection
            title={tr('settings.approval-settings.if_nobody_decides', 'If nobody decides')}
            description={tr(
              'settings.approval-settings.nothing_waits_for_ever_it_moves',
              'Nothing waits for ever: it moves on, and whoever decides is reminded daily.',
            )}
            surface
          >
            <div className="flex flex-col gap-4">
              <NumberField
                label={tr('settings.approval-settings.after_working_days', 'After (working days)')}
                value={escalation.afterWorkingDays}
                min={1}
                max={20}
                step={1}
                onChange={(n) => {
                  set({ escalation: { ...escalation, afterWorkingDays: Math.max(1, n ?? 1) } });
                }}
              />
              <Field>
                <FieldLabel>{tr('settings.approval-settings.goes_to', 'Goes to')}</FieldLabel>
                <Select
                  value={escalation.to}
                  onValueChange={(to) => {
                    if (to === 'manager' || to === 'hr') set({ escalation: { ...escalation, to } });
                  }}
                >
                  <FieldControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent>
                    <SelectItem value="manager">
                      {tr(
                        'settings.approval-settings.the_managers_manager',
                        'The manager’s manager',
                      )}
                    </SelectItem>
                    <SelectItem value="hr">{tr('settings.approval-settings.hr', 'HR')}</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {escalation.to === 'manager'
                    ? tr(
                        'settings.approval-settings.hr_when_the_manager_has_nobody',
                        'HR, when the manager has nobody above them.',
                      )
                    : tr(
                        'settings.approval-settings.straight_to_hr_whoever_the_manager',
                        'Straight to HR, whoever the manager reports to.',
                      )}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>
                  {tr('settings.approval-settings.reminder_every_day_at', 'Reminder, every day at')}
                </FieldLabel>
                <FieldControl>
                  <TimePicker
                    label={tr(
                      'settings.approval-settings.reminder_every_day_at',
                      'Reminder, every day at',
                    )}
                    value={clock(escalation.remindAt)}
                    step={15}
                    onChange={(time) => {
                      if (time === null) return;
                      const [h = 9, m = 0] = time.split(':').map(Number);
                      set({ escalation: { ...escalation, remindAt: h * 60 + m } });
                    }}
                  />
                </FieldControl>
              </Field>
            </div>
          </PageSection>
        </div>
      </div>
      {onSave === undefined
        ? null
        : form.bar((next) =>
            onSave(
              next.rules,
              next.autoApproval,
              data.teams
                .filter(
                  (t) =>
                    JSON.stringify(next.minimums[t.teamKey] ?? null) !== JSON.stringify(t.minimum),
                )
                .map((t) => ({ teamKey: t.teamKey, minimum: next.minimums[t.teamKey] ?? null })),
              next.escalation,
            ),
          )}
    </>
  );
}

/** The page while it loads: the rules and automatic approval, the minimums beside them. */
export function ApprovalSettingsSkeleton(): JSX.Element {
  return (
    <SettingsSkeleton
      title={TITLE()}
      description={DESCRIPTION()}
      container="@container/approvals"
      columns={columns}
      main={['h-64', 'h-56']}
      side={['h-80', 'h-24']}
    />
  );
}
