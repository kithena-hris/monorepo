import {
  Alert,
  AssistantCard,
  Badge,
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  List,
  ListItem,
  NumberField,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { SettingsSkeleton } from './shared';
import { t as tr } from '../i18n';

/**
 * Write a policy in plain words (T32, PRD §6.4): the handbook's paragraph,
 * the rules Time Off understood, the one question the text cannot answer,
 * and "Create draft".
 *
 * Nothing here reads the text or decides a rule. The host asks Time Off,
 * which reads it (by TypeSafe with a key, by its own rules without) into the
 * ordinary policy form. Every rule HR changes and every answer is the
 * address (`onAsk`), so Time Off reads it again. Nothing is created until
 * "Create draft", which sends the definition to the ordinary draft route,
 * and the draft opens on its leave type, where it is tested on real people
 * before anything is published.
 */

type RuleKey = 'allowance' | 'probation' | 'carry_over' | 'negative';

export interface PolicyReadData {
  readonly text: string | null;
  readonly leaveTypeKey: string | null;
  readonly leaveTypes: readonly { readonly key: string; readonly name: string }[];
  /** A model read the text. */
  readonly ai: boolean;
  readonly rules: readonly {
    readonly key: RuleKey;
    readonly label: string;
    readonly value: string;
    readonly amount: string;
  }[];
  readonly question: {
    readonly key: 'day_kind' | 'earning';
    readonly title: string;
    readonly body: { readonly text: string; readonly ai: boolean };
    readonly options: readonly { readonly value: string; readonly label: string }[];
  } | null;
  /** The ordinary policy draft it would create; null until the text says enough. */
  readonly definition: unknown;
  readonly problems: readonly { readonly path: string; readonly message: string }[];
}

/** What may change in the address: a value, or null to drop it. */
export type PolicyAsk = Partial<
  Record<
    'text' | 'type' | 'days' | 'earning' | 'allowance' | 'probation' | 'carry' | 'negative',
    string | null
  >
>;

export type Created =
  | { readonly ok: true; readonly policyId: string }
  | { readonly ok: false; readonly message: string };

export interface DescribePolicyProps {
  readonly load: Loadable<PolicyReadData>;
  readonly onAsk?: ((patch: PolicyAsk, mode: 'push' | 'replace') => void) | undefined;
  readonly onCreate?: ((definition: unknown) => Promise<Created>) | undefined;
  readonly onNavigate?: ((href: string) => void) | undefined;
}

const CONTAINER = '@container/policy';
const COLUMNS =
  'flex flex-col gap-5 @min-[56rem]/policy:grid @min-[56rem]/policy:grid-cols-2 @min-[56rem]/policy:items-start';
const TITLE = tr('settings.describe-policy.new_policy', 'New policy');
const DESCRIPTION = tr(
  'settings.describe-policy.write_the_policy_the_way_it_is',
  'Write the policy the way it is in the handbook. Time Off turns it into rules you can check.',
);

/** The address's name for each rule HR can change. */
const PARAM: Record<RuleKey, 'allowance' | 'probation' | 'carry' | 'negative'> = {
  allowance: 'allowance',
  probation: 'probation',
  carry_over: 'carry',
  negative: 'negative',
};
const UNIT: Record<RuleKey, string> = {
  allowance: tr('settings.describe-policy.days_a_year', 'Days a year'),
  probation: tr('settings.describe-policy.months_before_booking', 'Months before booking'),
  carry_over: tr('settings.describe-policy.days_carried_over', 'Days carried over'),
  negative: tr('settings.describe-policy.days_below_zero', 'Days below zero'),
};

export function DescribePolicy(props: DescribePolicyProps): JSX.Element {
  if (props.load.status === 'loading') {
    return (
      <SettingsSkeleton
        title={TITLE}
        description={DESCRIPTION}
        container={CONTAINER}
        columns={COLUMNS}
        main={['h-12', 'h-40', 'h-10']}
        side={['h-64', 'h-20']}
      />
    );
  }
  return (
    <div className={`${CONTAINER} flex flex-col gap-6`}>
      {props.load.status === 'error' ? (
        <PageHeader title={TITLE} description={DESCRIPTION} />
      ) : null}
      <Loaded load={props.load} what={tr('settings.describe-policy.the_policy', 'the policy')}>
        {(data) => <Ready data={data} {...props} />}
      </Loaded>
    </div>
  );
}

function Ready({
  data,
  onAsk,
  onCreate,
  onNavigate,
}: DescribePolicyProps & { readonly data: PolicyReadData }): JSX.Element {
  const [text, setText] = useState(data.text ?? '');
  const [editing, setEditing] = useState<RuleKey | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const ask = (patch: PolicyAsk): void => {
    onAsk?.(patch, 'replace');
  };
  const ready = data.definition !== null && data.question === null && data.problems.length === 0;
  const create = (): void => {
    if (onCreate === undefined || !ready) return;
    setFailed(null);
    start(async () => {
      const created = await onCreate(data.definition);
      if (created.ok) {
        onNavigate?.(
          `/settings/time-off/leave-types/${data.leaveTypeKey ?? ''}?policy=${created.policyId}`,
        );
      } else setFailed(created.message);
    });
  };
  return (
    <>
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          <Button
            variant="primary"
            startIcon={<icons.confirm aria-hidden />}
            disabled={!ready || onCreate === undefined}
            loading={pending}
            onClick={create}
          >
            {tr('settings.describe-policy.create_draft', 'Create draft')}
          </Button>
        }
      />
      <div className={COLUMNS}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onAsk?.(
              {
                text: text.trim(),
                days: null,
                earning: null,
                allowance: null,
                probation: null,
                carry: null,
                negative: null,
              },
              'push',
            );
          }}
        >
          <Field>
            <FieldLabel>{tr('settings.describe-policy.leave_type', 'Leave type')}</FieldLabel>
            <Select
              value={data.leaveTypeKey ?? ''}
              onValueChange={(type) => {
                ask({ type });
              }}
            >
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {data.leaveTypes.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>
              {tr(
                'settings.describe-policy.the_policy_as_it_is_in',
                'The policy, as it is in the handbook',
              )}
            </FieldLabel>
            <FieldControl>
              <Textarea
                autoResize
                rows={5}
                maxLength={2000}
                value={text}
                placeholder={tr(
                  'settings.describe-policy.everyone_gets_25_days_a_year',
                  'Everyone gets 25 days a year. They can carry 5 days into the next year if they use them before April.',
                )}
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
            </FieldControl>
            <FieldDescription>
              {tr(
                'settings.describe-policy.time_off_reads_it_into_rules',
                'Time Off reads it into rules. Nothing is saved yet.',
              )}
            </FieldDescription>
          </Field>
          <Button
            type="submit"
            className="self-start"
            startIcon={<icons.assistant aria-hidden />}
            disabled={text.trim() === ''}
          >
            {tr('settings.describe-policy.read_it', 'Read it')}
          </Button>
        </form>
        <div className="flex min-w-0 flex-col gap-4">
          {data.text === null ? (
            <p className="text-sm text-fg-muted">
              {tr(
                'settings.describe-policy.write_or_paste_the_policy_and',
                'Write or paste the policy, and the rules Time Off understood show here.',
              )}
            </p>
          ) : (
            <AssistantCard
              level={2}
              title={tr('settings.describe-policy.understood_as', 'Understood as')}
              action={
                data.ai ? (
                  <Badge tone="assistant" size="sm">
                    {tr('settings.describe-policy.ai', 'AI')}
                  </Badge>
                ) : undefined
              }
            >
              {data.rules.length === 0 ? null : (
                <List>
                  {data.rules.map((r) =>
                    editing === r.key ? (
                      <ListItem key={r.key} icon={<icons.edit />} iconTone="neutral">
                        <span className="flex flex-wrap items-end gap-2">
                          <NumberField
                            label={UNIT[r.key]}
                            value={value}
                            min={0}
                            step={r.key === 'probation' ? 1 : 0.5}
                            precision={r.key === 'probation' ? 0 : 1}
                            onChange={setValue}
                          />
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={value === null}
                            onClick={() => {
                              if (value === null) return;
                              ask({ [PARAM[r.key]]: String(value) });
                              setEditing(null);
                            }}
                          >
                            {tr('settings.describe-policy.use_this', 'Use this')}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setEditing(null);
                            }}
                          >
                            {tr('settings.describe-policy.cancel', 'Cancel')}
                          </Button>
                        </span>
                      </ListItem>
                    ) : (
                      <ListItem
                        key={r.key}
                        icon={<icons.success />}
                        iconTone="success"
                        description={r.value}
                        trailing={
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label={tr('settings.describe-policy.change', 'Change {{label}}', {
                              label: r.label,
                            })}
                            startIcon={<icons.edit aria-hidden />}
                            onClick={() => {
                              setValue(Number(r.amount));
                              setEditing(r.key);
                            }}
                          />
                        }
                      >
                        {r.label}
                      </ListItem>
                    ),
                  )}
                </List>
              )}
              {data.question === null ? null : (
                <Alert
                  tone="warning"
                  title={data.question.title}
                  actions={
                    <>
                      {data.question.options.map((o, i) => (
                        <Button
                          key={o.value}
                          size="xs"
                          variant={i === 0 ? 'primary' : 'secondary'}
                          onClick={() => {
                            ask(
                              data.question?.key === 'day_kind'
                                ? { days: o.value }
                                : { earning: o.value },
                            );
                          }}
                        >
                          {o.label}
                        </Button>
                      ))}
                    </>
                  }
                >
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {data.question.body.text}
                    {data.question.body.ai ? (
                      <Badge tone="assistant" size="sm">
                        {tr('settings.describe-policy.ai', 'AI')}
                      </Badge>
                    ) : null}
                  </span>
                </Alert>
              )}
            </AssistantCard>
          )}
          {data.problems.length === 0 ? null : (
            <Alert
              tone="danger"
              title={tr(
                'settings.describe-policy.not_enough_to_make_a_policy',
                'Not enough to make a policy yet',
              )}
            >
              {data.problems.map((p) => p.message).join(' ')}
            </Alert>
          )}
          {failed === null ? null : (
            <Alert
              tone="danger"
              title={tr(
                'settings.describe-policy.the_draft_was_not_created',
                'The draft was not created',
              )}
            >
              {failed}
            </Alert>
          )}
          <Alert
            tone="info"
            icon={<icons.permission aria-hidden />}
            title={tr(
              'settings.describe-policy.nothing_changes_until_you_publish',
              'Nothing changes until you publish',
            )}
          >
            {tr(
              'settings.describe-policy.create_draft_makes_an_ordinary_draft',
              'Create draft makes an ordinary draft of the policy. You see who it changes before anything is published.',
            )}
          </Alert>
        </div>
      </div>
    </>
  );
}
