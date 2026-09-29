import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldControl,
  FieldLabel,
  KeyValues,
  NumberField,
  PageHeader,
  Stack,
  Switch,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';

/**
 * Completeness, reminders and the directory (S20): when people are reminded
 * about missing details, who hears about it, how small a group reports may
 * describe, and what the directory shows.
 *
 * The reminder schedule is People's own rule today (the day a detail goes
 * missing, then weekly, in the person's working hours), so it is stated, not
 * offered as a choice. The digest and the directory settings are drawn only
 * when the server sends them: a section with nothing behind it is left out
 * rather than shown with made-up values.
 */
export interface ReminderSchedule {
  /** "The day a detail goes missing, then once a week". */
  readonly cadence: string;
  /** "09:00 to 18:00 on their own clock". */
  readonly window: string;
  /** Also sent in a connected chat app, when its notice is on. */
  readonly inChat: boolean;
}

export interface HrDigest {
  readonly recipients: readonly string[];
  /** "Monday 08:00". */
  readonly when: string;
}

export interface DirectoryPolicy {
  readonly photos: boolean;
  readonly everyone: boolean;
  readonly searchable: readonly string[];
}

export interface ReminderSettingsState {
  readonly canManage: boolean;
  readonly reminders: ReminderSchedule;
  /** The smallest group analytics describes; raised, never lowered. */
  readonly cohortMinimum: number;
  readonly digest?: HrDigest | null;
  readonly directory?: DirectoryPolicy | null;
}

export interface ReminderSettingsProps {
  readonly load: Loadable<ReminderSettingsState>;
  readonly onCohortMinimum: (minimum: number) => Promise<Outcome>;
  readonly onDirectory?: (policy: DirectoryPolicy) => Promise<Outcome>;
}

export function ReminderSettings(props: ReminderSettingsProps): JSX.Element {
  return (
    <Stack gap={6}>
      <PageHeader
        title="Completeness and reminders"
        description="When people are reminded about missing details, and who hears about it."
      />
      <Loaded load={props.load} what="the reminder settings">
        {(state) => <Sections {...props} state={state} />}
      </Loaded>
    </Stack>
  );
}

function Sections({
  state,
  onCohortMinimum,
  onDirectory,
}: ReminderSettingsProps & { readonly state: ReminderSettingsState }): JSX.Element {
  const { reminders, digest, directory } = state;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 @3xl/page:grid-cols-2">
      <Card variant="outlined">
        <CardHeader>
          <CardTitle level={2}>Reminders to employees</CardTitle>
          <CardDescription>
            By email, at most once a week, until their profile is complete.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KeyValues
            aria-label="How reminders are sent"
            items={[
              { label: 'When', value: reminders.cadence },
              { label: 'At', value: reminders.window },
              { label: 'In chat', value: reminders.inChat ? 'Also, when connected' : 'Email only' },
            ]}
          />
        </CardContent>
      </Card>
      {digest == null ? null : (
        <Card variant="outlined">
          <CardHeader>
            <CardTitle level={2}>HR digest</CardTitle>
            <CardDescription>
              New gaps, overdue reminders, and records that are blocking payroll.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KeyValues
              aria-label="HR digest"
              items={[
                { label: 'Who gets it', value: digest.recipients.join(', ') || 'Nobody yet' },
                { label: 'Every', value: digest.when },
              ]}
            />
          </CardContent>
        </Card>
      )}
      <Privacy state={state} onSave={onCohortMinimum} />
      {directory == null ? null : (
        <Directory policy={directory} canManage={state.canManage} onSave={onDirectory} />
      )}
    </div>
  );
}

/** Raised, never lowered: People refuses a lower minimum, and so does its database. */
function Privacy({
  state,
  onSave,
}: {
  readonly state: ReminderSettingsState;
  readonly onSave: (minimum: number) => Promise<Outcome>;
}): JSX.Element {
  const [minimum, setMinimum] = useState<number | null>(state.cohortMinimum);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const lowered = minimum === null || minimum < state.cohortMinimum;
  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle level={2}>Reporting privacy</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          aria-label="Reporting privacy"
          onSubmit={(event) => {
            event.preventDefault();
            if (lowered || minimum === state.cohortMinimum) return;
            setBusy(true);
            void onSave(minimum).then((result) => {
              setBusy(false);
              setOutcome(result);
            });
          }}
        >
          <Stack gap={4}>
            <NumberField
              label="Smallest group shown in reports"
              value={minimum}
              min={state.cohortMinimum}
              step={1}
              disabled={!state.canManage}
              invalid={lowered}
              hint={`Can be raised. Can’t be lowered below ${String(state.cohortMinimum)}.`}
              onChange={setMinimum}
            />
            <Alert tone="info" title="Why there’s a floor">
              In a smaller group, people can be picked out from an average.
            </Alert>
            {outcome === null ? null : outcome.ok ? (
              <Alert tone="success">Saved.</Alert>
            ) : (
              <Alert tone="danger" title="Not saved">
                {outcome.message}
              </Alert>
            )}
            {state.canManage ? (
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  loadingLabel="Saving"
                  disabled={lowered || minimum === state.cohortMinimum}
                >
                  Save
                </Button>
              </div>
            ) : null}
          </Stack>
        </form>
      </CardContent>
    </Card>
  );
}

function Directory({
  policy,
  canManage,
  onSave,
}: {
  readonly policy: DirectoryPolicy;
  readonly canManage: boolean;
  readonly onSave: ReminderSettingsProps['onDirectory'];
}): JSX.Element {
  const editable = canManage && onSave !== undefined;
  const [refused, setRefused] = useState<string | null>(null);
  const toggle = (next: DirectoryPolicy): void => {
    if (onSave === undefined) return;
    setRefused(null);
    void onSave(next).then((outcome) => {
      if (!outcome.ok) setRefused(outcome.message);
    });
  };
  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle level={2}>Directory</CardTitle>
      </CardHeader>
      <CardContent>
        <Stack gap={4}>
          <Field orientation="horizontal" className="items-center justify-between gap-4">
            <FieldLabel>Show photos</FieldLabel>
            <FieldControl>
              <Switch
                checked={policy.photos}
                disabled={!editable}
                onCheckedChange={(photos) => {
                  toggle({ ...policy, photos });
                }}
              />
            </FieldControl>
          </Field>
          <Field orientation="horizontal" className="items-center justify-between gap-4">
            <FieldLabel>Everyone can see the directory</FieldLabel>
            <FieldControl>
              <Switch
                checked={policy.everyone}
                disabled={!editable}
                onCheckedChange={(everyone) => {
                  toggle({ ...policy, everyone });
                }}
              />
            </FieldControl>
          </Field>
          <KeyValues
            aria-label="Directory search"
            items={[{ label: 'Searchable fields', value: policy.searchable.join(', ') }]}
          />
          {refused === null ? null : (
            <Alert tone="danger" title="Not saved">
              {refused}
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
