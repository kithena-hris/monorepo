import {
  Alert,
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
} from '@reach/ui';
import type { JSX } from 'react';

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

export interface ApprovalSettingsData {
  readonly rules: readonly ApprovalRule[];
  readonly autoApproval: AutoApproval;
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
  ) => Promise<Outcome>;
}

const TITLE = 'Approvals';
const DESCRIPTION = 'Who approves each kind of request, and when it’s automatic.';
const page = '@container/approvals flex flex-col gap-6';
const columns =
  'flex flex-col gap-6 @min-[60rem]/approvals:grid @min-[60rem]/approvals:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @min-[60rem]/approvals:items-start';

export function ApprovalSettings({ load, onSave }: ApprovalSettingsProps): JSX.Element {
  if (load.status === 'loading') return <ApprovalSettingsSkeleton />;
  return (
    <div className={page}>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Loaded load={load} what="the approval rules">
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
  request: 'Request',
  plan: 'Plan',
  timesheet: 'Timesheet',
};

/** What a rule covers, as a phrase: "Any request below zero", "Parental leave plans". */
function ruleTitle(rule: ApprovalRule, names: ReadonlyMap<string, string>): string {
  const types =
    rule.leaveTypes === null ? null : rule.leaveTypes.map((k) => names.get(k) ?? k).join(', ');
  if (rule.subject === 'timesheet') return 'Overtime and timesheet changes';
  if (rule.subject === 'plan') return `${types ?? 'Parental leave'} plans`;
  const what = types ?? 'Any request';
  return { always: what, below_zero: `${what} below zero`, unpaid: `${what}, unpaid` }[rule.when];
}

interface Form {
  readonly rules: readonly ApprovalRule[];
  readonly autoApproval: AutoApproval;
  readonly minimums: Readonly<Record<string, TeamMinimum | null>>;
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
  };
  const form = useSaved(saved);
  const { rules, autoApproval: auto, minimums } = form.draft;
  const set = (patch: Partial<Form>): void => {
    form.set({ ...form.draft, ...patch });
  };
  const names = new Map(data.leaveTypes.map((t) => [t.definition.key, t.definition.name.default]));
  return (
    <>
      {form.refusal}
      <div className={columns}>
        <FormSections>
          <FormSection
            title="Who approves"
            description="Each kind of request, and who decides it, in order."
          >
            {rules.length === 0 ? (
              <p className="text-sm text-fg-muted">
                No rules yet: every request goes to the person’s manager.
              </p>
            ) : (
              rules.map((rule, i) => (
                <Field key={i} orientation="horizontal">
                  <div className="min-w-0 flex-1">
                    <FieldLabel>{ruleTitle(rule, names)}</FieldLabel>
                    <FieldDescription>
                      {[
                        SUBJECT[rule.subject],
                        ...rule.approvers.map((a) => (a === 'hr' ? 'HR' : 'Manager')),
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
                </Field>
              ))
            )}
          </FormSection>
          <FormSection
            title="Approved automatically"
            description="Requests that only give time back, or that nobody needs to weigh."
          >
            <Toggle
              kind="checkbox"
              label="Shortening or cancelling time off"
              checked={auto.shortenOrCancel}
              onChange={(shortenOrCancel) => {
                set({ autoApproval: { ...auto, shortenOrCancel } });
              }}
            />
            <Toggle
              kind="checkbox"
              label="Short sick leave"
              description={
                auto.sickUnderDays === null
                  ? 'Off: every sick day goes to the manager'
                  : `Under ${String(auto.sickUnderDays)} days; the manager is told`
              }
              checked={auto.sickUnderDays !== null}
              onChange={(on) => {
                set({ autoApproval: { ...auto, sickUnderDays: on ? 3 : null } });
              }}
            />
            {auto.sickUnderDays === null ? null : (
              <NumberField
                label="Sick leave approved automatically under (days)"
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
              label="One day of vacation with the team above its minimum"
              checked={auto.oneDayAboveMinimum}
              onChange={(oneDayAboveMinimum) => {
                set({ autoApproval: { ...auto, oneDayAboveMinimum } });
              }}
            />
          </FormSection>
        </FormSections>
        <div className="flex min-w-0 flex-col gap-6">
          <PageSection
            title="Team minimums"
            description="How many must be in, every weekday."
            surface
          >
            {data.teams.length === 0 ? (
              <p className="text-sm text-fg-muted">No teams yet.</p>
            ) : (
              <ul aria-label="Team minimums" className="flex flex-col gap-4">
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
                            <SelectItem value="none">No minimum</SelectItem>
                            <SelectItem value="people">A number of people</SelectItem>
                            <SelectItem value="percent">A share of the team</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      {minimum === null ? null : (
                        <NumberField
                          label={
                            minimum.unit === 'people'
                              ? `${name}: at least (people in)`
                              : `${name}: at least (% in)`
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
          <Alert tone="info" title="Minimums warn, they don’t block">
            People can still send a request. The manager sees the clash and decides.
          </Alert>
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
            ),
          )}
    </>
  );
}

/** The page while it loads: the rules and automatic approval, the minimums beside them. */
export function ApprovalSettingsSkeleton(): JSX.Element {
  return (
    <SettingsSkeleton
      title={TITLE}
      description={DESCRIPTION}
      container="@container/approvals"
      columns={columns}
      main={['h-64', 'h-56']}
      side={['h-80', 'h-24']}
    />
  );
}
