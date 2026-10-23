import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Stack,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Loadable, Outcome } from '../load';
import { AttributeInput } from '../record/attribute-input';
import type { AttributeValue } from '../record/model';
import type { DataType } from './model';
import { DATA_TYPE_LABEL } from './words';
import { t as tr } from '../i18n';

/**
 * Changing a field's type or format, with every value it holds reviewed
 * first (`/settings/people/fields/<key>/change?to=date`).
 *
 * People has read each value again as the new type and written nothing: how
 * many convert, a few examples, and every value that does not fit, with
 * whose it is and why. For each of those — one at a time or all at once —
 * HR types a new value, removes it, asks the employee, keeps it for HR to
 * fill in from Data health, or leaves it empty. Publishing applies the new
 * version and every one of those decisions together; until then nothing
 * anybody sees has changed.
 */

export type ReviewAction = 'edit' | 'clear' | 'request' | 'hr' | 'leave';

/** One field's values, read again as its new type. */
export interface FieldReview {
  readonly field: {
    readonly key: string;
    readonly label: string;
    readonly from: DataType;
    readonly to: DataType;
    readonly options: readonly { readonly value: string; readonly label: string }[];
    readonly currency: string | null;
    readonly encrypted: boolean;
  };
  readonly withValue: number;
  readonly dateOrder: 'iso' | 'dmy' | 'mdy' | null;
  readonly converted: {
    readonly count: number;
    readonly samples: readonly { readonly before: string; readonly after: string }[];
  };
  readonly unchanged: number;
  readonly unfit: readonly {
    readonly personId: string;
    readonly name: string;
    readonly before: string;
    readonly reason: string;
  }[];
  readonly actions: readonly ReviewAction[];
  readonly defaultAction: ReviewAction;
  readonly hidden: boolean;
}

export interface FieldChangeView extends FieldReview {
  readonly needsReview: boolean;
  /** Other draft changes published with it, not counting `others`. */
  readonly alsoPublished: number;
  /** Every other field changing type in the draft: reviewed here, published together. */
  readonly others: readonly FieldReview[];
}

export interface Decision {
  readonly personId: string;
  readonly action: ReviewAction;
  readonly value?: AttributeValue;
}

export interface FieldChangeProps {
  readonly load: Loadable<FieldChangeView>;
  /**
   * Publish the change with these decisions, and each other field's by its
   * key; the shell goes back to the fields once it is.
   */
  readonly onApply: (
    decisions: readonly Decision[],
    others: Readonly<Record<string, readonly Decision[]>>,
  ) => Promise<Outcome>;
  readonly onBack: () => void;
}

const ACTION: Record<ReviewAction, { readonly label: string; readonly means: string }> = {
  edit: {
    label: tr('settings.field-change.type_the_right_value', 'Type the right value'),
    means: tr('settings.field-change.written_now_as_a_correction', 'Written now, as a correction.'),
  },
  clear: {
    label: tr('settings.field-change.remove_it', 'Remove it'),
    means: tr(
      'settings.field-change.cleared_history_keeps_what_it_was',
      'Cleared. History keeps what it was.',
    ),
  },
  request: {
    label: tr('settings.field-change.ask_the_employee', 'Ask the employee'),
    means: tr(
      'settings.field-change.cleared_and_theyre_asked_for_it',
      'Cleared, and they’re asked for it on their profile and by email.',
    ),
  },
  hr: {
    label: tr('settings.field-change.hr_fills_it_in_later', 'HR fills it in later'),
    means: tr(
      'settings.field-change.cleared_and_listed_for_hr_in',
      'Cleared, and listed for HR in Data health.',
    ),
  },
  leave: {
    label: tr('settings.field-change.leave_it_empty', 'Leave it empty'),
    means: tr('settings.field-change.cleared_and_nobody_is_asked', 'Cleared, and nobody is asked.'),
  },
};

const ORDER_WORDS = {
  dmy: 'day/month/year',
  mdy: 'month/day/year',
  iso: 'year-month-day',
} as const;

const plural = (n: number, one: string, many: string) =>
  tr('settings.field-change.text', '{{toLocaleString}} {{value}}', {
    toLocaleString: n.toLocaleString('en-GB'),
    value: n === 1 ? one : many,
  });

export function FieldChange({ load, onApply, onBack }: FieldChangeProps): JSX.Element {
  if (load.status === 'loading')
    return (
      <Spinner label={tr('settings.field-change.checking_every_value', 'Checking every value')} />
    );
  if (load.status === 'error') {
    return (
      <Stack gap={6}>
        <PageHeader
          title={tr('settings.field-change.change_a_field', 'Change a field')}
          actions={
            <Button variant="ghost" onClick={onBack}>
              {tr('settings.field-change.back_to_the_fields', 'Back to the fields')}
            </Button>
          }
        />
        <Alert
          tone="danger"
          title={tr(
            'settings.field-change.could_not_check_the_values',
            'Could not check the values',
          )}
          action={
            load.retry === undefined ? undefined : (
              <Button size="sm" onClick={load.retry}>
                {tr('settings.field-change.try_again', 'Try again')}
              </Button>
            )
          }
        >
          {load.message}
        </Alert>
      </Stack>
    );
  }
  return <Review view={load.data} onApply={onApply} onBack={onBack} />;
}

type Chosen = Readonly<Record<string, ReviewAction>>;
type Typed = Readonly<Record<string, AttributeValue>>;

const empty = (v: AttributeValue | undefined) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function Review({
  view,
  onApply,
  onBack,
}: {
  readonly view: FieldChangeView;
  readonly onApply: FieldChangeProps['onApply'];
  readonly onBack: () => void;
}): JSX.Element {
  const { field } = view;
  const reviews: readonly FieldReview[] = [view, ...view.others];
  // Each field's choices, by its key: one page, one publish, every field its own.
  const [chosen, setChosen] = useState<Readonly<Record<string, Chosen>>>({});
  const [typed, setTyped] = useState<Readonly<Record<string, Typed>>>({});
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const actionOf = (r: FieldReview, personId: string): ReviewAction =>
    chosen[r.field.key]?.[personId] ?? r.defaultAction;
  const missing = reviews.flatMap((r) =>
    r.unfit.filter(
      (u) => actionOf(r, u.personId) === 'edit' && empty(typed[r.field.key]?.[u.personId]),
    ),
  );
  const title = tr('settings.field-change.change_to', 'Change {{label}} to {{DATA_TYPE_LABEL}}', {
    label: field.label,
    DATA_TYPE_LABEL: DATA_TYPE_LABEL[field.to].toLowerCase(),
  });
  const from =
    field.from === field.to
      ? tr('settings.field-change.its_format_changes', 'Its format changes.')
      : tr('settings.field-change.it_is_now', 'It is {{DATA_TYPE_LABEL}} now.', {
          DATA_TYPE_LABEL: DATA_TYPE_LABEL[field.from].toLowerCase(),
        });

  const decisionsOf = (r: FieldReview): Decision[] =>
    r.unfit.map((u) => {
      const action = actionOf(r, u.personId);
      return action === 'edit'
        ? { personId: u.personId, action, value: typed[r.field.key]?.[u.personId] ?? null }
        : { personId: u.personId, action };
    });

  const publish = async (): Promise<void> => {
    setShown(true);
    if (missing.length > 0) return;
    setBusy(true);
    setRefused(null);
    const outcome = await onApply(
      decisionsOf(view),
      Object.fromEntries(view.others.map((o) => [o.field.key, decisionsOf(o)])),
    );
    setBusy(false);
    if (!outcome.ok) setRefused(outcome.message);
  };

  const counts = reviews
    .flatMap((r) => r.unfit.map((u) => actionOf(r, u.personId)))
    .reduce<Partial<Record<ReviewAction, number>>>((n, a) => ({ ...n, [a]: (n[a] ?? 0) + 1 }), {});
  const conversions = reviews.reduce((n, r) => n + r.converted.count, 0);

  return (
    <Stack gap={6}>
      <PageHeader
        title={title}
        description={tr(
          'settings.field-change.every_value_is_checked_first_nothing',
          '{{from}} Every value is checked first; nothing changes for anybody until you publish.',
          { from },
        )}
        actions={
          <Button variant="ghost" onClick={onBack}>
            {tr('settings.field-change.back_to_the_fields', 'Back to the fields')}
          </Button>
        }
      />

      {view.others.length === 0 ? null : (
        <Alert
          tone="info"
          title={tr('settings.field-change.type_too', '{{listed}} {{value}} type too', {
            listed: listed(view.others.map((o) => o.field.label)),
            value: view.others.length === 1 ? 'changes' : 'change',
          })}
        >
          {tr(
            'settings.field-change.each_is_reviewed_below_and_published',
            'Each is reviewed below and published with this one.',
          )}
        </Alert>
      )}

      {reviews.map((r, i) => (
        <FieldValues
          key={r.field.key}
          review={r}
          heading={
            i === 0
              ? null
              : tr(
                  'settings.field-change.to',
                  '{{label}}: {{DATA_TYPE_LABEL}} to {{DATA_TYPE_LABEL2}}',
                  {
                    label: r.field.label,
                    DATA_TYPE_LABEL: DATA_TYPE_LABEL[r.field.from].toLowerCase(),
                    DATA_TYPE_LABEL2: DATA_TYPE_LABEL[r.field.to].toLowerCase(),
                  },
                )
          }
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

      <Card variant="fill" padded>
        <Stack gap={3}>
          <p className="text-sm">
            {tr(
              'settings.field-change.publishing_writes_the_new_version_and',
              'Publishing writes the new version and, together,',
            )}{' '}
            {[
              plural(conversions, 'conversion', 'conversions'),
              ...(Object.entries(counts) as [ReviewAction, number][]).map(([a, n]) =>
                tr('settings.field-change.for', '{{label}} for {{n}}', {
                  label: ACTION[a].label.toLowerCase(),
                  n: plural(n, 'value', 'values'),
                }),
              ),
            ].join(', ')}
            .
            {view.alsoPublished === 0
              ? ''
              : ' ' +
                tr(
                  'settings.field-change.in_the_draft_published_with_it',
                  '{{alsoPublished}} in the draft {{value}} published with it.',
                  {
                    alsoPublished: plural(
                      view.alsoPublished,
                      tr('settings.field-change.other_change', 'other change'),
                      tr('settings.field-change.other_changes', 'other changes'),
                    ),
                    value: view.alsoPublished === 1 ? 'is' : 'are',
                  },
                )}
          </p>
          {refused === null ? null : (
            <Alert
              tone="danger"
              title={tr('settings.field-change.nothing_was_published', 'Nothing was published')}
            >
              {refused}
            </Alert>
          )}
          {shown && missing.length > 0 ? (
            <Alert tone="danger">
              {plural(
                missing.length,
                tr('settings.field-change.value_still_needs', 'value still needs'),
                tr('settings.field-change.values_still_need', 'values still need'),
              )}{' '}
              {tr('settings.field-change.typing_in', 'typing in.')}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={busy}
              loadingLabel={tr(
                'settings.field-change.publishing_the_change',
                'Publishing the change',
              )}
              onClick={() => {
                void publish();
              }}
            >
              {tr('settings.field-change.publish_the_change', 'Publish the change')}
            </Button>
            <Button variant="ghost" onClick={onBack}>
              {tr('settings.field-change.not_now', 'Not now')}
            </Button>
          </div>
        </Stack>
      </Card>
    </Stack>
  );
}

/** "Department and Job Family", "A, B and C". */
const listed = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : tr('settings.field-change.and', '{{join}} and {{value}}', {
        join: names.slice(0, -1).join(', '),
        value: names.at(-1) ?? '',
      });

/**
 * One field's values: what converts, and each value that doesn't fit with
 * what becomes of it, one at a time or many at once.
 */
function FieldValues({
  review,
  heading,
  chosen,
  typed,
  shown,
  onChoose,
  onType,
}: {
  readonly review: FieldReview;
  /** The field's own heading, for one reviewed below another; null for the page's own. */
  readonly heading: string | null;
  readonly chosen: Chosen;
  readonly typed: Typed;
  readonly shown: boolean;
  readonly onChoose: (next: Chosen) => void;
  readonly onType: (next: Typed) => void;
}): JSX.Element {
  const view = review;
  const { field } = view;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<ReviewAction>(view.defaultAction);
  /** "Type the right value" for many at once: one value, given to each of them. */
  const [bulkValue, setBulkValue] = useState<AttributeValue>(null);
  const actionOf = (personId: string): ReviewAction => chosen[personId] ?? view.defaultAction;
  const inputField = (name: string) => ({
    key: field.key,
    label: tr('settings.field-change.new_for', 'New {{label}} for {{name}}', {
      label: field.label,
      name,
    }),
    description: null,
    dataType: field.to,
    options: field.options,
    required: false,
    readOnly: false,
    ...(field.currency === null ? {} : { currency: field.currency }),
  });
  const applyBulk = (): void => {
    const rows =
      selected.size === 0 ? view.unfit : view.unfit.filter((u) => selected.has(u.personId));
    onChoose(Object.fromEntries(rows.map((u) => [u.personId, bulk])));
    if (bulk === 'edit' && !empty(bulkValue)) {
      onType(Object.fromEntries(rows.map((u) => [u.personId, bulkValue])));
    }
  };
  const id = `unfit-${field.key}`;
  // A second field's controls name it: the same person can be in both lists.
  const of = heading === null ? '' : ` (${field.label})`;

  return (
    <section
      aria-labelledby={heading === null ? undefined : `${id}-field`}
      className="flex flex-col gap-4"
    >
      {heading === null ? null : (
        <h2 id={`${id}-field`} className="text-lg font-semibold">
          {heading}
        </h2>
      )}
      {view.hidden ? (
        <Alert
          tone="info"
          title={tr('settings.field-change.values_are_masked', 'Values are masked')}
        >
          {field.encrypted
            ? tr(
                'settings.field-change.this_field_is_encrypted_so_only',
                'This field is encrypted, so only the last four characters are shown. Each value is opened only to convert it.',
              )
            : tr(
                'settings.field-change.you_cant_read_this_field_so',
                'You can’t read this field, so values are masked. They are still checked and converted.',
              )}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle level={heading === null ? 2 : 3}>
            {view.withValue === 0
              ? tr('settings.field-change.nobody_has_a_value_yet', 'Nobody has a value yet')
              : tr('settings.field-change.a_value', '{{withValue}} a value', {
                  withValue: plural(
                    view.withValue,
                    tr('settings.field-change.person_has', 'person has'),
                    tr('settings.field-change.people_have', 'people have'),
                  ),
                })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Stack gap={4}>
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{plural(view.converted.count, 'converts', 'convert')}</Badge>
              <Badge>
                {plural(
                  view.unchanged,
                  tr('settings.field-change.already_fits', 'already fits'),
                  tr('settings.field-change.already_fit', 'already fit'),
                )}
              </Badge>
              <Badge tone={view.unfit.length === 0 ? 'neutral' : 'warning'}>
                {plural(
                  view.unfit.length,
                  tr('settings.field-change.needs_you', 'needs you'),
                  tr('settings.field-change.need_you', 'need you'),
                )}
              </Badge>
            </div>
            {view.dateOrder === null || view.dateOrder === 'iso' ? null : (
              <p className="text-sm text-fg-muted">
                {tr(
                  'settings.field-change.dates_are_read_as_the_way',
                  'Dates are read as {{ORDER_WORDS}}, the way most of them are written.',
                  { ORDER_WORDS: ORDER_WORDS[view.dateOrder] },
                )}
              </p>
            )}
            {view.converted.samples.length === 0 ? null : (
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  {tr('settings.field-change.for_example', 'For example')}
                </h3>
                <ul
                  className="flex flex-col gap-1.5"
                  aria-label={tr(
                    'settings.field-change.example_conversions',
                    'Example conversions',
                  )}
                >
                  {view.converted.samples.map((s, i) => (
                    // Positional: two people may have typed the same thing.
                    <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono">{s.before}</span>
                      <icons.forward
                        aria-label={tr('settings.field-change.becomes', 'becomes')}
                        className="size-4 text-fg-muted"
                      />
                      <span className="font-medium">{s.after}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm text-fg-muted">
              {tr(
                'settings.field-change.each_converted_value_is_written_as',
                'Each converted value is written as a correction: its history keeps what was typed.',
              )}
            </p>
          </Stack>
        </CardContent>
      </Card>

      <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
        <h3 id={`${id}-heading`} className="text-md font-semibold">
          {tr('settings.field-change.values_that_dont_fit', 'Values that don’t fit{{of}}', { of })}
        </h3>
        {view.unfit.length === 0 ? (
          <EmptyState
            title={tr('settings.field-change.every_value_fits', 'Every value fits')}
            description={tr(
              'settings.field-change.nothing_to_decide_publishing_converts_them',
              'Nothing to decide: publishing converts them all.',
            )}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="min-w-0 flex-1 basis-60">
                <FieldLabel>
                  {selected.size === 0
                    ? tr('settings.field-change.for_all', 'For all {{length}}{{of}}', {
                        length: String(view.unfit.length),
                        of,
                      })
                    : tr(
                        'settings.field-change.for_the_selected',
                        'For the {{size}} selected{{of}}',
                        { size: String(selected.size), of },
                      )}
                </FieldLabel>
                <Select
                  value={bulk}
                  onValueChange={(v) => {
                    setBulk(v as ReviewAction);
                  }}
                >
                  <FieldControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FieldControl>
                  <SelectContent>
                    {view.actions.map((a) => (
                      <SelectItem key={a} value={a}>
                        {ACTION[a].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {bulk === 'edit' ? (
                <div className="min-w-0 flex-1 basis-60">
                  <AttributeInput
                    field={{
                      ...inputField(''),
                      label:
                        selected.size === 0
                          ? `${field.label} for all ${String(view.unfit.length)}`
                          : `${field.label} for the ${String(selected.size)} selected`,
                    }}
                    value={bulkValue}
                    onChange={setBulkValue}
                  />
                </div>
              ) : null}
              <Button
                onClick={applyBulk}
                disabled={bulk === 'edit' && empty(bulkValue)}
                {...(of === ''
                  ? {}
                  : { 'aria-label': tr('settings.field-change.apply_2', 'Apply{{of}}', { of }) })}
              >
                {tr('settings.field-change.apply', 'Apply')}
              </Button>
            </div>
            <ul
              className="flex flex-col gap-3"
              aria-label={tr(
                'settings.field-change.values_that_dont_fit',
                'Values that don’t fit{{of}}',
                { of },
              )}
            >
              {view.unfit.map((u) => {
                const action = actionOf(u.personId);
                const problem =
                  shown && action === 'edit' && empty(typed[u.personId])
                    ? tr(
                        'settings.field-change.type_the_new_value_or_choose',
                        'Type the new value, or choose something else.',
                      )
                    : undefined;
                return (
                  <li key={u.personId}>
                    <Card variant="outlined" padded>
                      <div className="flex flex-col gap-3 @container">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            aria-label={tr(
                              'settings.field-change.select',
                              'Select {{name}}{{of}}',
                              { name: u.name, of },
                            )}
                            checked={selected.has(u.personId)}
                            onCheckedChange={(on) => {
                              setSelected((s) => {
                                const next = new Set(s);
                                if (on === true) next.add(u.personId);
                                else next.delete(u.personId);
                                return next;
                              });
                            }}
                          />
                          <Avatar size="md" name={u.name} />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">{u.name}</p>
                            <p className="text-sm">
                              <span className="font-mono break-all">{u.before}</span>
                            </p>
                            <p className="text-sm text-fg-muted">{u.reason}</p>
                          </div>
                        </div>
                        <div className="grid gap-3 @md:grid-cols-2">
                          <Field>
                            <FieldLabel>
                              {tr(
                                'settings.field-change.what_to_do_with_s_value',
                                'What to do with {{name}}’s value{{of}}',
                                { name: u.name, of },
                              )}
                            </FieldLabel>
                            <Select
                              value={action}
                              onValueChange={(v) => {
                                onChoose({ [u.personId]: v as ReviewAction });
                              }}
                            >
                              <FieldControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FieldControl>
                              <SelectContent>
                                {view.actions.map((a) => (
                                  <SelectItem key={a} value={a}>
                                    {ACTION[a].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-fg-muted">{ACTION[action].means}</p>
                          </Field>
                          {action === 'edit' ? (
                            <AttributeInput
                              field={inputField(u.name)}
                              value={typed[u.personId] ?? null}
                              problem={problem}
                              onChange={(value) => {
                                onType({ [u.personId]: value });
                              }}
                            />
                          ) : null}
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </section>
  );
}
