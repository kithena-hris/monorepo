import {
  Alert,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
} from '@reach/ui-native';
import { CheckCircle2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { ask, isEmpty, useSigned, type Value } from '../api';
import { AttributeInput } from '../attribute-input';
import { parsed } from '../review/load';
import type { PeopleScreen } from '../routes';
import { DATA_TYPE_LABEL } from './fields-model';

type Action = 'edit' | 'clear' | 'request' | 'hr' | 'leave';

interface View_ {
  readonly field: {
    readonly key: string;
    readonly label: string;
    readonly from: string;
    readonly to: string;
    readonly options: readonly { readonly value: string; readonly label: string }[];
    readonly currency: string | null;
    readonly encrypted: boolean;
  };
  readonly withValue: number;
  readonly converted: {
    readonly count: number;
    readonly samples: readonly { before: string; after: string }[];
  };
  readonly unchanged: number;
  readonly unfit: readonly { personId: string; name: string; before: string; reason: string }[];
  readonly actions: readonly Action[];
  readonly defaultAction: Action;
  readonly hidden: boolean;
  readonly alsoPublished: number;
  readonly blockedBy: string | null;
}

const ACTION: Readonly<Record<Action, { label: string; means: string }>> = {
  edit: { label: 'Type the right value', means: 'Written now, as a correction.' },
  clear: { label: 'Remove it', means: 'Cleared. History keeps what it was.' },
  request: {
    label: 'Ask the employee',
    means: 'Cleared, and they’re asked for it on their profile and by email.',
  },
  hr: { label: 'HR fills it in later', means: 'Cleared, and listed for HR in Data health.' },
  leave: { label: 'Leave it empty', means: 'Cleared, and nobody is asked.' },
};

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * A field's type or format changed: every value it holds checked first, read
 * again as the new type with nothing written. For each value that does not
 * fit, type the right one, remove it, ask the employee, keep it for HR or
 * leave it empty. Publishing applies the new version and every decision
 * together.
 */
export function FieldChange({ navigation, route }: PeopleScreen<'FieldChange'>): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct();
  const [view, setView] = useState<View_ | string | null>(null);
  const [chosen, setChosen] = useState<Readonly<Record<string, Action>>>({});
  const [typed, setTyped] = useState<Readonly<Record<string, Value>>>({});
  const [all, setAll] = useState<Action | ''>('');
  const [shown, setShown] = useState(false);

  useEffect(() => {
    void ask<string>(signed, 'FieldChange', { field: route.params.key, to: route.params.to }).then(
      (answer) => {
        setView(
          answer.ok
            ? ((parsed(answer.data) as View_ | null) ?? 'People did not answer.')
            : answer.message,
        );
      },
    );
  }, [signed, route.params.key, route.params.to]);

  const back = { label: 'Fields', onPress: navigation.goBack };
  if (view === null) {
    return (
      <Page title="Change a field" back={back}>
        <Loading label="Checking every value" />
      </Page>
    );
  }
  if (typeof view === 'string') {
    return (
      <Page title="Change a field" back={back}>
        <Failed
          message={view}
          onRetry={() => {
            setView(null);
          }}
        />
      </Page>
    );
  }
  const { field } = view;
  const actionOf = (personId: string): Action => chosen[personId] ?? view.defaultAction;
  const missing = view.unfit.filter(
    (u) => actionOf(u.personId) === 'edit' && isEmpty(typed[u.personId] ?? null),
  );
  const asInput = {
    key: field.key,
    label: field.label,
    description: null,
    dataType: field.to,
    options: field.options,
    required: false,
    missing: null,
    readOnly: false,
    currency: field.currency,
    ownedBy: null,
    keptIn: null,
    sensitive: field.encrypted,
    askable: null,
  };

  return (
    <Page
      title={`To ${(DATA_TYPE_LABEL[field.to] ?? field.to).toLowerCase()}`}
      back={back}
      foot={
        <Button
          className="flex-1"
          fullWidth
          variant="primary"
          disabled={view.blockedBy !== null}
          loading={busy === 'ApplyFieldChange'}
          onPress={() => {
            setShown(true);
            if (missing.length > 0) return;
            const decisions = view.unfit.map((u) => {
              const action = actionOf(u.personId);
              return action === 'edit'
                ? { personId: u.personId, action, value: typed[u.personId] ?? null }
                : { personId: u.personId, action };
            });
            void act(
              'ApplyFieldChange',
              { field: field.key, input: JSON.stringify({ to: field.to, decisions }) },
              `${field.label} changed and published`,
            ).then((done) => {
              if (done !== null) navigation.goBack();
            });
          }}
        >
          Publish the change
        </Button>
      }
    >
      <Text tone="muted">
        {`${field.label}: ${(DATA_TYPE_LABEL[field.from] ?? field.from).toLowerCase()} to ${(DATA_TYPE_LABEL[field.to] ?? field.to).toLowerCase()}. Every value is checked first; nothing changes for anybody until you publish.`}
      </Text>
      {view.blockedBy === null ? null : (
        <Alert tone="warning" title={`${view.blockedBy} changes type or format too`}>
          Review its values first: a publish includes every change in the draft.
        </Alert>
      )}
      {view.hidden ? (
        <Alert tone="info" title="Values are masked">
          {field.encrypted
            ? 'This field is encrypted, so only the last four characters are shown. Each value is opened only to convert it.'
            : 'You can’t read this field, so values are masked. They are still checked and converted.'}
        </Alert>
      ) : null}
      <Card>
        <Stack gap={2}>
          <CardTitle>
            {view.withValue === 0
              ? 'Nobody has a value yet'
              : `${plural(view.withValue, 'person has', 'people have')} a value`}
          </CardTitle>
          <Text variant="subhead" tone="muted">
            {`${plural(view.converted.count, 'converts', 'convert')}, ${plural(view.unchanged, 'stays as it is', 'stay as they are')}, ${plural(view.unfit.length, 'does not fit', 'do not fit')}.`}
          </Text>
          {view.converted.samples.map((s) => (
            <Text key={s.before} variant="footnote">{`${s.before} → ${s.after}`}</Text>
          ))}
        </Stack>
      </Card>
      {view.unfit.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Every value fits"
          description="Publishing converts them all."
        />
      ) : (
        <>
          <Field>
            <FieldLabel>For all of them</FieldLabel>
            <Select
              value={all}
              onValueChange={(value) => {
                const action = value as Action;
                setAll(action);
                setChosen(Object.fromEntries(view.unfit.map((u) => [u.personId, action])));
              }}
            >
              <SelectTrigger
                size="sm"
                accessibilityLabel="What to do with every value that doesn’t fit"
              >
                <SelectValue placeholder="Choose one at a time below" />
              </SelectTrigger>
              <SelectContent>
                {view.actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {ACTION[a].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {view.unfit.map((u) => {
            const action = actionOf(u.personId);
            return (
              <Card key={u.personId} variant="outline">
                <Stack gap={2}>
                  <Field>
                    <FieldLabel>{`What to do with ${u.name}’s value`}</FieldLabel>
                    <Select
                      value={action}
                      onValueChange={(value) => {
                        setChosen((c) => ({ ...c, [u.personId]: value as Action }));
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        accessibilityLabel={`What to do with ${u.name}’s value`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {view.actions.map((a) => (
                          <SelectItem key={a} value={a}>
                            {ACTION[a].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {action === 'edit' ? (
                    <AttributeInput
                      field={{ ...asInput, label: `${u.name}’s ${field.label.toLowerCase()}` }}
                      value={typed[u.personId]}
                      personId={u.personId}
                      onChange={(value) => {
                        setTyped((t) => ({ ...t, [u.personId]: value }));
                      }}
                      problem={
                        shown && isEmpty(typed[u.personId] ?? null)
                          ? 'Type the new value, or choose something else.'
                          : undefined
                      }
                    />
                  ) : (
                    <Text variant="footnote" tone="muted">
                      {ACTION[action].means}
                    </Text>
                  )}
                </Stack>
              </Card>
            );
          })}
        </>
      )}
      <Text variant="footnote" tone="muted">
        {`Publishing writes the new version${
          view.alsoPublished === 0
            ? '.'
            : `, and ${plural(view.alsoPublished, 'other change', 'other changes')} in the draft ${view.alsoPublished === 1 ? 'is' : 'are'} published with it.`
        }`}
      </Text>
      {shown && missing.length > 0 ? (
        <Alert tone="danger" title="Nothing was published">
          {`${plural(missing.length, 'value still needs', 'values still need')} typing in.`}
        </Alert>
      ) : null}
    </Page>
  );
}
