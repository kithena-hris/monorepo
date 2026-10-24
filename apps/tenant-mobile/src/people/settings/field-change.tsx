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
import { t as tr } from '../../i18n';

type Action = 'edit' | 'clear' | 'request' | 'hr' | 'leave';

/** One field's values, read again as its new type. */
interface Review_ {
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
}

interface View_ extends Review_ {
  readonly alsoPublished: number;
  /** Every other field changing type in the draft: reviewed here, published together. */
  readonly others: readonly Review_[];
}

type Chosen = Readonly<Record<string, Action>>;
type Typed = Readonly<Record<string, Value>>;

const ACTION = (): Readonly<Record<Action, { label: string; means: string }>> => ({
  edit: {
    label: tr('people.settings.field-change.type_the_right_value', 'Type the right value'),
    means: tr(
      'people.settings.field-change.written_now_as_a_correction',
      'Written now, as a correction.',
    ),
  },
  clear: {
    label: tr('people.settings.field-change.remove_it', 'Remove it'),
    means: tr(
      'people.settings.field-change.cleared_history_keeps_what_it_was',
      'Cleared. History keeps what it was.',
    ),
  },
  request: {
    label: tr('people.settings.field-change.ask_the_employee', 'Ask the employee'),
    means: tr(
      'people.settings.field-change.cleared_and_theyre_asked_for_it',
      'Cleared, and they’re asked for it on their profile and by email.',
    ),
  },
  hr: {
    label: tr('people.settings.field-change.hr_fills_it_in_later', 'HR fills it in later'),
    means: tr(
      'people.settings.field-change.cleared_and_listed_for_hr_in',
      'Cleared, and listed for HR in Data health.',
    ),
  },
  leave: {
    label: tr('people.settings.field-change.leave_it_empty', 'Leave it empty'),
    means: tr(
      'people.settings.field-change.cleared_and_nobody_is_asked',
      'Cleared, and nobody is asked.',
    ),
  },
});

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

const typeName = (t: string): string => (DATA_TYPE_LABEL[t] ?? t).toLowerCase();

/**
 * A field's type or format changed: every value it holds checked first, read
 * again as the new type with nothing written, and every other field changing
 * type in the draft beside it. For each value that does not fit, type the
 * right one, remove it, ask the employee, keep it for HR or leave it empty.
 * Publishing applies the new version and every decision together.
 */
export function FieldChange({ navigation, route }: PeopleScreen<'FieldChange'>): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct();
  const [view, setView] = useState<View_ | string | null>(null);
  const [chosen, setChosen] = useState<Readonly<Record<string, Chosen>>>({});
  const [typed, setTyped] = useState<Readonly<Record<string, Typed>>>({});
  const [shown, setShown] = useState(false);

  useEffect(() => {
    void ask<string>(signed, 'FieldChange', { field: route.params.key, to: route.params.to }).then(
      (answer) => {
        setView(
          answer.ok
            ? ((parsed(answer.data) as View_ | null) ??
                tr('people.settings.field-change.people_did_not_answer', 'People did not answer.'))
            : answer.message,
        );
      },
    );
  }, [signed, route.params.key, route.params.to]);

  const back = {
    label: tr('people.settings.field-change.fields', 'Fields'),
    onPress: navigation.goBack,
  };
  if (view === null) {
    return (
      <Page title={tr('people.settings.field-change.change_a_field', 'Change a field')} back={back}>
        <Loading
          label={tr('people.settings.field-change.checking_every_value', 'Checking every value')}
        />
      </Page>
    );
  }
  if (typeof view === 'string') {
    return (
      <Page title={tr('people.settings.field-change.change_a_field', 'Change a field')} back={back}>
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
  const reviews: readonly Review_[] = [view, ...view.others];
  const actionOf = (r: Review_, personId: string): Action =>
    chosen[r.field.key]?.[personId] ?? r.defaultAction;
  const missing = reviews.flatMap((r) =>
    r.unfit.filter(
      (u) =>
        actionOf(r, u.personId) === 'edit' && isEmpty(typed[r.field.key]?.[u.personId] ?? null),
    ),
  );
  const decisionsOf = (r: Review_) =>
    r.unfit.map((u) => {
      const action = actionOf(r, u.personId);
      return action === 'edit'
        ? { personId: u.personId, action, value: typed[r.field.key]?.[u.personId] ?? null }
        : { personId: u.personId, action };
    });

  return (
    <Page
      title={tr('people.settings.field-change.to', 'To {{typeName}}', {
        typeName: typeName(field.to),
      })}
      back={back}
      foot={
        <Button
          className="flex-1"
          fullWidth
          variant="primary"
          loading={busy === 'ApplyFieldChange'}
          onPress={() => {
            setShown(true);
            if (missing.length > 0) return;
            const others = Object.fromEntries(
              view.others.map((o) => [o.field.key, decisionsOf(o)]),
            );
            void act(
              'ApplyFieldChange',
              {
                field: field.key,
                input: JSON.stringify({ to: field.to, decisions: decisionsOf(view), others }),
              },
              `${[field, ...view.others.map((o) => o.field)].map((f) => f.label).join(', ')} changed and published`,
            ).then((done) => {
              if (done !== null) navigation.goBack();
            });
          }}
        >
          {tr('people.settings.field-change.publish_the_change', 'Publish the change')}
        </Button>
      }
    >
      <Text tone="muted">
        {`${field.label}: ${typeName(field.from)} to ${typeName(field.to)}. Every value is checked first; nothing changes for anybody until you publish.`}
      </Text>
      {view.others.length === 0 ? null : (
        <Alert
          tone="info"
          title={tr(
            'people.settings.field-change.type_too',
            { one: '{{join}} changes type too', other: '{{join}} change type too' },
            { count: view.others.length, join: view.others.map((o) => o.field.label).join(', ') },
          )}
        >
          {tr(
            'people.settings.field-change.each_is_reviewed_below_and_published',
            'Each is reviewed below and published with this one.',
          )}
        </Alert>
      )}
      {reviews.map((r, i) => (
        <FieldValues
          key={r.field.key}
          review={r}
          second={i > 0}
          chosen={chosen[r.field.key] ?? {}}
          typed={typed[r.field.key] ?? {}}
          shown={shown}
          onChoose={(next) => {
            setChosen((c) => ({ ...c, [r.field.key]: { ...c[r.field.key], ...next } }));
          }}
          onType={(next) => {
            setTyped((t) => ({ ...t, [r.field.key]: { ...t[r.field.key], ...next } }));
          }}
        />
      ))}
      <Text variant="footnote" tone="muted">
        {tr(
          'people.settings.field-change.publishing_writes_the_new_version',
          'Publishing writes the new version{{value}}',
          {
            value:
              view.alsoPublished === 0
                ? '.'
                : `, and ${plural(view.alsoPublished, 'other change', 'other changes')} in the draft ${view.alsoPublished === 1 ? 'is' : 'are'} published with it.`,
          },
        )}
      </Text>
      {shown && missing.length > 0 ? (
        <Alert
          tone="danger"
          title={tr('people.settings.field-change.nothing_was_published', 'Nothing was published')}
        >
          {tr('people.settings.field-change.typing_in', '{{plural}} typing in.', {
            plural: plural(missing.length, 'value still needs', 'values still need'),
          })}
        </Alert>
      ) : null}
    </Page>
  );
}

/** One field's values: what converts, and what becomes of each value that doesn't fit. */
function FieldValues({
  review,
  second,
  chosen,
  typed,
  shown,
  onChoose,
  onType,
}: {
  readonly review: Review_;
  /** Reviewed below another field: it gets its own heading, and its controls name it. */
  readonly second: boolean;
  readonly chosen: Chosen;
  readonly typed: Typed;
  readonly shown: boolean;
  readonly onChoose: (next: Chosen) => void;
  readonly onType: (next: Typed) => void;
}): React.JSX.Element {
  const { field } = review;
  const [all, setAll] = useState<Action | ''>('');
  const of = second ? ` (${field.label})` : '';
  const actionOf = (personId: string): Action => chosen[personId] ?? review.defaultAction;
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
    <Stack gap={3}>
      {second ? (
        <Text variant="headline">
          {tr('people.settings.field-change.to_2', '{{label}}: {{typeName}} to {{typeName2}}', {
            label: field.label,
            typeName: typeName(field.from),
            typeName2: typeName(field.to),
          })}
        </Text>
      ) : null}
      {review.hidden ? (
        <Alert
          tone="info"
          title={tr('people.settings.field-change.values_are_masked', 'Values are masked')}
        >
          {field.encrypted
            ? tr(
                'people.settings.field-change.this_field_is_encrypted_so_only',
                'This field is encrypted, so only the last four characters are shown. Each value is opened only to convert it.',
              )
            : tr(
                'people.settings.field-change.you_cant_read_this_field_so',
                'You can’t read this field, so values are masked. They are still checked and converted.',
              )}
        </Alert>
      ) : null}
      <Card>
        <Stack gap={2}>
          <CardTitle>
            {review.withValue === 0
              ? tr('people.settings.field-change.nobody_has_a_value_yet', 'Nobody has a value yet')
              : tr('people.settings.field-change.a_value', '{{plural}} a value', {
                  plural: plural(review.withValue, 'person has', 'people have'),
                })}
          </CardTitle>
          <Text variant="subhead" tone="muted">
            {`${plural(review.converted.count, 'converts', 'convert')}, ${plural(review.unchanged, 'stays as it is', 'stay as they are')}, ${plural(review.unfit.length, 'does not fit', 'do not fit')}.`}
          </Text>
          {review.converted.samples.map((s) => (
            <Text key={s.before} variant="footnote">{`${s.before} → ${s.after}`}</Text>
          ))}
        </Stack>
      </Card>
      {review.unfit.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={tr('people.settings.field-change.every_value_fits', 'Every value fits')}
          description={tr(
            'people.settings.field-change.publishing_converts_them_all',
            'Publishing converts them all.',
          )}
        />
      ) : (
        <>
          <Field>
            <FieldLabel>
              {tr('people.settings.field-change.for_all_of_them', 'For all of them{{of}}', { of })}
            </FieldLabel>
            <Select
              value={all}
              onValueChange={(value) => {
                const action = value as Action;
                setAll(action);
                onChoose(Object.fromEntries(review.unfit.map((u) => [u.personId, action])));
              }}
            >
              <SelectTrigger
                size="sm"
                accessibilityLabel={tr(
                  'people.settings.field-change.what_to_do_with_every_value',
                  'What to do with every value that doesn’t fit{{of}}',
                  { of },
                )}
              >
                <SelectValue
                  placeholder={tr(
                    'people.settings.field-change.choose_one_at_a_time_below',
                    'Choose one at a time below',
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {review.actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {ACTION()[a].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {all === 'edit' ? (
            // One value, given to each of them; any one can still be changed below.
            <AttributeInput
              field={{
                ...asInput,
                label: tr(
                  'people.settings.field-change.for_all_of_them_2',
                  '{{label}} for all of them',
                  { label: field.label },
                ),
              }}
              value={typed[review.unfit[0]?.personId ?? ''] ?? null}
              personId={null}
              onChange={(value) => {
                onType(Object.fromEntries(review.unfit.map((u) => [u.personId, value])));
              }}
            />
          ) : null}
          {review.unfit.map((u) => {
            const action = actionOf(u.personId);
            return (
              <Card key={u.personId} variant="outline">
                <Stack gap={2}>
                  <Field>
                    <FieldLabel>
                      {tr(
                        'people.settings.field-change.what_to_do_with_s_value',
                        'What to do with {{name}}’s value{{of}}',
                        { name: u.name, of },
                      )}
                    </FieldLabel>
                    <Select
                      value={action}
                      onValueChange={(value) => {
                        onChoose({ [u.personId]: value as Action });
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        accessibilityLabel={tr(
                          'people.settings.field-change.what_to_do_with_s_value',
                          'What to do with {{name}}’s value{{of}}',
                          { name: u.name, of },
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {review.actions.map((a) => (
                          <SelectItem key={a} value={a}>
                            {ACTION()[a].label}
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
                        onType({ [u.personId]: value });
                      }}
                      problem={
                        shown && isEmpty(typed[u.personId] ?? null)
                          ? tr(
                              'people.settings.field-change.type_the_new_value_or_choose',
                              'Type the new value, or choose something else.',
                            )
                          : undefined
                      }
                    />
                  ) : (
                    <Text variant="footnote" tone="muted">
                      {ACTION()[action].means}
                    </Text>
                  )}
                </Stack>
              </Card>
            );
          })}
        </>
      )}
    </Stack>
  );
}
