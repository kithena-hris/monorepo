import {
  Alert,
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  KeyValues,
  NumberField,
  PageSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Outcome } from '../load';
import { t } from '../i18n';

/**
 * Settings › People › Organisation › Inbox rules (P2): company-wide defaults
 * for the tasks People sends. People can add channels in their own
 * notification settings, never remove these. Each change is in the Activity
 * log, as every company setting is.
 */

export interface InboxRules {
  readonly remind: 'off' | 'day_before' | 'day_before_then_every_2_days';
  readonly overdueDays: number;
  readonly askDueDays: number;
  readonly signDueDays: number;
  readonly acknowledgeDueDays: number;
  readonly failuresForATask: number;
}

const REMIND: readonly { readonly value: InboxRules['remind']; readonly label: string }[] = [
  {
    value: 'day_before_then_every_2_days',
    get label(): string {
      return t(
        'settings.inbox-rules.day_before_then_every_2_days',
        'Day before, then every 2 days',
      );
    },
  },
  {
    value: 'day_before',
    get label(): string {
      return t('settings.inbox-rules.the_day_before_only', 'The day before only');
    },
  },
  {
    value: 'off',
    get label(): string {
      return t('settings.inbox-rules.dont_remind', 'Don’t remind');
    },
  },
];

const OVERDUE = [
  {
    value: '3',
    get label(): string {
      return t('settings.inbox-rules.3_days', '3 days');
    },
  },
  {
    value: '7',
    get label(): string {
      return t('settings.inbox-rules.7_days', '7 days');
    },
  },
  {
    value: '14',
    get label(): string {
      return t('settings.inbox-rules.14_days', '14 days');
    },
  },
  {
    value: '0',
    get label(): string {
      return t('settings.inbox-rules.never', 'Never');
    },
  },
] as const;

export function InboxRulesTab({
  rules,
  canManage,
  onSave,
}: {
  readonly rules: InboxRules;
  readonly canManage: boolean;
  readonly onSave: (patch: { inboxRules: Partial<InboxRules> }) => Promise<Outcome>;
}): JSX.Element {
  const [r, setR] = useState(rules);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const changed = JSON.stringify(r) !== JSON.stringify(rules);
  const days = (key: 'askDueDays' | 'signDueDays' | 'acknowledgeDueDays', label: string) => (
    <NumberField
      label={label}
      value={r[key]}
      min={1}
      max={90}
      step={1}
      suffix={t('settings.inbox-rules.days', 'days')}
      disabled={!canManage}
      onChange={(v) => {
        if (v !== null) setR({ ...r, [key]: v });
      }}
      className="max-w-48"
    />
  );
  return (
    <form
      aria-label={t('settings.inbox-rules.inbox_rules', 'Inbox rules')}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setOutcome(null);
        void onSave({ inboxRules: r }).then((done) => {
          setBusy(false);
          setOutcome(done);
        });
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 @4xl/page:grid-cols-2">
        <PageSection
          surface
          title={t('settings.inbox-rules.reminders_and_escalation', 'Reminders and escalation')}
        >
          <Stack gap={4}>
            <Field>
              <FieldLabel>
                {t('settings.inbox-rules.remind_people_about_a_task', 'Remind people about a task')}
              </FieldLabel>
              <Select
                value={r.remind}
                disabled={!canManage}
                onValueChange={(v) => {
                  const found = REMIND.find((x) => x.value === v);
                  if (found !== undefined) setR({ ...r, remind: found.value });
                }}
              >
                <FieldControl>
                  <SelectTrigger className="max-w-72">
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {REMIND.map((x) => (
                    <SelectItem key={x.value} value={x.value}>
                      {x.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>
                {t('settings.inbox-rules.when_a_task_is_overdue_for', 'When a task is overdue for')}
              </FieldLabel>
              <Select
                value={String(r.overdueDays)}
                disabled={!canManage}
                onValueChange={(v) => {
                  setR({ ...r, overdueDays: Number(v) });
                }}
              >
                <FieldControl>
                  <SelectTrigger className="max-w-40">
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {OVERDUE.map((x) => (
                    <SelectItem key={x.value} value={x.value}>
                      {x.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {t(
                  'settings.inbox-rules.the_persons_manager_gets_an_update',
                  'The person’s manager gets an update.',
                )}
              </FieldDescription>
            </Field>
            <KeyValues
              layout="stacked"
              items={[
                {
                  label: t(
                    'settings.inbox-rules.approvals_that_wait_for_7_days',
                    'Approvals that wait for 7 days',
                  ),
                  value: 'They lapse and the requester is told, as in Review',
                },
                {
                  label: t(
                    'settings.inbox-rules.hand_over_automatically',
                    'Hand over automatically',
                  ),
                  value: 'Each approver turns it on in Time off › Approvals › Cover',
                },
              ]}
            />
          </Stack>
        </PageSection>
        <PageSection
          surface
          title={t('settings.inbox-rules.default_due_dates', 'Default due dates')}
        >
          <Stack gap={4}>
            {days('askDueDays', t('settings.inbox-rules.ask_for_details', 'Ask for details'))}
            {days('signDueDays', t('settings.inbox-rules.sign_a_document', 'Sign a document'))}
            {days(
              'acknowledgeDueDays',
              t('settings.inbox-rules.read_and_acknowledge', 'Read and acknowledge'),
            )}
            <KeyValues
              layout="stacked"
              items={[
                {
                  label: t('settings.inbox-rules.approve_time_off', 'Approve time off'),
                  value: 'Set in Time off › Settings › Approval rules',
                },
              ]}
            />
          </Stack>
        </PageSection>
        <PageSection surface title={t('settings.inbox-rules.team_tasks', 'Team tasks')}>
          <Stack gap={4}>
            <NumberField
              label={t('settings.inbox-rules.integration_failures', 'Integration failures')}
              value={r.failuresForATask}
              min={1}
              max={20}
              step={1}
              suffix={t('settings.inbox-rules.in_a_row', 'in a row')}
              disabled={!canManage}
              hint={t(
                'settings.inbox-rules.then_it_is_a_task_for',
                'Then it is a task for all People administrators.',
              )}
              onChange={(v) => {
                if (v !== null) setR({ ...r, failuresForATask: v });
              }}
              className="max-w-56"
            />
            <KeyValues
              layout="stacked"
              items={[
                {
                  label: t('settings.inbox-rules.import_rows_to_check', 'Import rows to check'),
                  value: 'Whoever ran the import',
                },
              ]}
            />
          </Stack>
        </PageSection>
        <PageSection surface title={t('settings.inbox-rules.who_can_send', 'Who can send')}>
          <KeyValues
            layout="stacked"
            items={[
              {
                label: t(
                  'settings.inbox-rules.documents_that_need_signing',
                  'Documents that need signing',
                ),
                value: 'HR',
              },
              {
                label: t('settings.inbox-rules.requests_for_details', 'Requests for details'),
                value: 'HR and managers',
              },
            ]}
          />
        </PageSection>
      </div>
      <Stack gap={3} className="mt-4">
        {outcome === null ? null : outcome.ok ? (
          <Alert tone="success">
            {t(
              'settings.inbox-rules.saved_the_new_rules_apply_from',
              'Saved. The new rules apply from now on.',
            )}
          </Alert>
        ) : (
          <Alert tone="danger" title={t('settings.inbox-rules.not_saved', 'Not saved')}>
            {outcome.message}
          </Alert>
        )}
        {canManage ? (
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!changed}
              loading={busy}
              loadingLabel={t('settings.inbox-rules.saving', 'Saving')}
            >
              {t('settings.inbox-rules.save', 'Save')}
            </Button>
          </div>
        ) : null}
      </Stack>
    </form>
  );
}
