import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  FieldLabel,
  List,
  ListItem,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  Textarea,
} from '@reach/ui-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Heading, Loading, Page } from '../frame';
import { ask, useRead, useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';

/**
 * Onboarding on the phone (ONB-013, design MO3–MO5): a manager's, a buddy's,
 * IT's and HR's tasks, a plan to tick, a check-in and the probation review.
 * The new hire's own page (MO1, MO2) is the welcome page on Kithena Jobs,
 * opened from their email before they have an account.
 */

const day = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

interface Tasks {
  readonly rows: readonly {
    planId: string;
    taskId: string;
    name: string;
    title: string;
    dueOn: string;
    late: boolean;
  }[];
}

export function OnboardingTasks({
  navigation,
}: PeopleScreen<'OnboardingTasks'>): React.JSX.Element {
  const { load, reload } = useRead<Tasks>('OnboardingTasks', {}, 'onboarding');
  const back = { label: 'More', onPress: navigation.goBack };
  if (load.status !== 'ready')
    return (
      <Page title="Onboarding" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading your onboarding tasks" />
        )}
      </Page>
    );
  const byPlan = new Map<string, Tasks['rows'][number][]>();
  for (const r of load.data.rows) byPlan.set(r.planId, [...(byPlan.get(r.planId) ?? []), r]);
  return (
    <Page title="Onboarding" back={back}>
      {byPlan.size === 0 ? <Text tone="muted">Nothing to do.</Text> : null}
      {[...byPlan].map(([planId, rows]) => (
        <View key={planId} className="gap-2">
          <Heading title={rows[0]?.name ?? ''} />
          <List>
            {rows.map((r) => (
              <ListItem
                key={r.taskId}
                chevron
                description={day(r.dueOn)}
                trailing={
                  r.late ? (
                    <Badge size="sm" tone="danger">
                      Late
                    </Badge>
                  ) : undefined
                }
                onPress={() => { navigation.navigate('OnboardingPlan', { planId, name: r.name }); }}
              >
                {r.title}
              </ListItem>
            ))}
          </List>
        </View>
      ))}
    </Page>
  );
}

interface Plan {
  readonly plan: {
    id: string;
    name: string;
    startDate: string;
    probationEnd: string | null;
    allowedExtensionMonths: number | null;
  };
  readonly tasks: readonly {
    id: string;
    title: string;
    dueOn: string;
    state: 'open' | 'done';
    mine: boolean;
    late: boolean;
  }[];
  readonly may: { review: boolean; checkIn: boolean };
}

export function OnboardingPlan({
  navigation,
  route,
}: PeopleScreen<'OnboardingPlan'>): React.JSX.Element {
  const signed = useSigned();
  const { load, reload } = useRead<Plan>(
    'OnboardingPlan',
    { planId: route.params.planId },
    'onboarding',
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'passed' | 'extended' | 'failed'>('passed');
  const [notes, setNotes] = useState('');
  const back = { label: 'Onboarding', onPress: navigation.goBack };
  if (load.status !== 'ready')
    return (
      <Page title={route.params.name} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the plan" />
        )}
      </Page>
    );
  const p = load.data;
  const act = (operation: string, variables: Record<string, unknown>): void => {
    void ask(signed, operation, variables, 'onboarding').then((r) => {
      if (r.ok) reload();
      else setProblem(r.message);
    });
  };
  return (
    <Page title={p.plan.name} back={back}>
      <Text tone="muted">{`Starts ${day(p.plan.startDate)}`}</Text>
      {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      <List>
        {p.tasks.map((t) => (
          <ListItem
            key={t.id}
            description={day(t.dueOn)}
            leading={
              <Checkbox
                accessibilityLabel={t.title}
                checked={t.state === 'done'}
                disabled={!t.mine}
                onCheckedChange={(on) => {
                  act(on ? 'CompleteOnboardingTask' : 'ReopenOnboardingTask', {
                    planId: p.plan.id,
                    taskId: t.id,
                  });
                }}
              />
            }
            trailing={
              t.late ? (
                <Badge size="sm" tone="danger">
                  Late
                </Badge>
              ) : undefined
            }
          >
            {t.title}
          </ListItem>
        ))}
      </List>
      {p.may.checkIn ? (
        <>
          <Heading title="Check-in" />
          <Field>
            <FieldLabel>How is it going?</FieldLabel>
            <Textarea value={notes} onChangeText={setNotes} />
          </Field>
          <Button
            disabled={notes.trim() === ''}
            onPress={() => {
              act('OnboardingCheckIn', { planId: p.plan.id, input: { day: 30, notes } });
              setNotes('');
            }}
          >
            Submit
          </Button>
        </>
      ) : null}
      {p.may.review && p.plan.probationEnd !== null ? (
        <>
          <Heading title="Probation review" />
          <Text tone="muted">{`Ends ${day(p.plan.probationEnd)}`}</Text>
          <SegmentedControl
            fullWidth
            value={outcome}
            accessibilityLabel="Outcome"
            onValueChange={(v) => { setOutcome(v === 'extended' ? 'extended' : v === 'failed' ? 'failed' : 'passed'); }
            }
          >
            <SegmentedControlItem value="passed">Passed</SegmentedControlItem>
            {(p.plan.allowedExtensionMonths ?? 0) > 0 ? (
              <SegmentedControlItem value="extended">Extend</SegmentedControlItem>
            ) : null}
            <SegmentedControlItem value="failed">Not passed</SegmentedControlItem>
          </SegmentedControl>
          <Button
            variant="primary"
            onPress={() => { act('ReviewProbation', {
                planId: p.plan.id,
                input: { outcome, extendMonths: outcome === 'extended' ? 1 : null },
              }); }
            }
          >
            Record review
          </Button>
        </>
      ) : null}
    </Page>
  );
}
