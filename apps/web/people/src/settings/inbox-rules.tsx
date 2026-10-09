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
  { value: 'day_before_then_every_2_days', label: 'Day before, then every 2 days' },
  { value: 'day_before', label: 'The day before only' },
  { value: 'off', label: 'Don’t remind' },
];

const OVERDUE = [
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '0', label: 'Never' },
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
      suffix="days"
      disabled={!canManage}
      onChange={(v) => {
        if (v !== null) setR({ ...r, [key]: v });
      }}
      className="max-w-48"
    />
  );
  return (
    <form
      aria-label="Inbox rules"
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
        <PageSection surface title="Reminders and escalation">
          <Stack gap={4}>
            <Field>
              <FieldLabel>Remind people about a task</FieldLabel>
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
              <FieldLabel>When a task is overdue for</FieldLabel>
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
              <FieldDescription>The person’s manager gets an update.</FieldDescription>
            </Field>
            <KeyValues
              layout="stacked"
              items={[
                {
                  label: 'Approvals that wait for 7 days',
                  value: 'They lapse and the requester is told, as in Review',
                },
                {
                  label: 'Hand over automatically',
                  value: 'Each approver turns it on in Time off › Approvals › Cover',
                },
              ]}
            />
          </Stack>
        </PageSection>
        <PageSection surface title="Default due dates">
          <Stack gap={4}>
            {days('askDueDays', 'Ask for details')}
            {days('signDueDays', 'Sign a document')}
            {days('acknowledgeDueDays', 'Read and acknowledge')}
            <KeyValues
              layout="stacked"
              items={[
                { label: 'Approve time off', value: 'Set in Time off › Settings › Approval rules' },
              ]}
            />
          </Stack>
        </PageSection>
        <PageSection surface title="Team tasks">
          <Stack gap={4}>
            <NumberField
              label="Integration failures"
              value={r.failuresForATask}
              min={1}
              max={20}
              step={1}
              suffix="in a row"
              disabled={!canManage}
              hint="Then it is a task for all People administrators."
              onChange={(v) => {
                if (v !== null) setR({ ...r, failuresForATask: v });
              }}
              className="max-w-56"
            />
            <KeyValues
              layout="stacked"
              items={[{ label: 'Import rows to check', value: 'Whoever ran the import' }]}
            />
          </Stack>
        </PageSection>
        <PageSection surface title="Who can send">
          <KeyValues
            layout="stacked"
            items={[
              { label: 'Documents that need signing', value: 'HR' },
              { label: 'Requests for details', value: 'HR and managers' },
            ]}
          />
        </PageSection>
      </div>
      <Stack gap={3} className="mt-4">
        {outcome === null ? null : outcome.ok ? (
          <Alert tone="success">Saved. The new rules apply from now on.</Alert>
        ) : (
          <Alert tone="danger" title="Not saved">
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
              loadingLabel="Saving"
            >
              Save
            </Button>
          </div>
        ) : null}
      </Stack>
    </form>
  );
}
