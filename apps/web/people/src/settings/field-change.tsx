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
  Skeleton,
  Stack,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import type { Loadable, Outcome } from '../load';
import { AttributeInput } from '../record/attribute-input';
import type { AttributeValue } from '../record/model';
import type { DataType } from './model';
import { DATA_TYPE_LABEL } from './words';

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

export interface FieldChangeView {
  readonly field: {
    readonly key: string;
    readonly label: string;
    readonly from: DataType;
    readonly to: DataType;
    readonly options: readonly { readonly value: string; readonly label: string }[];
    readonly currency: string | null;
    readonly encrypted: boolean;
  };
  readonly needsReview: boolean;
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
  readonly alsoPublished: number;
  readonly blockedBy: string | null;
}

export interface Decision {
  readonly personId: string;
  readonly action: ReviewAction;
  readonly value?: AttributeValue;
}

export interface FieldChangeProps {
  readonly load: Loadable<FieldChangeView>;
  /** Publish the change with these decisions; the shell goes back to the fields once it is. */
  readonly onApply: (decisions: readonly Decision[]) => Promise<Outcome>;
  readonly onBack: () => void;
}

const ACTION: Record<ReviewAction, { readonly label: string; readonly means: string }> = {
  edit: { label: 'Type the right value', means: 'Written now, as a correction.' },
  clear: { label: 'Remove it', means: 'Cleared. History keeps what it was.' },
  request: {
    label: 'Ask the employee',
    means: 'Cleared, and they’re asked for it on their profile and by email.',
  },
  hr: { label: 'HR fills it in later', means: 'Cleared, and listed for HR in Data health.' },
  leave: { label: 'Leave it empty', means: 'Cleared, and nobody is asked.' },
};

const ORDER_WORDS = {
  dmy: 'day/month/year',
  mdy: 'month/day/year',
  iso: 'year-month-day',
} as const;

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

export function FieldChange({ load, onApply, onBack }: FieldChangeProps): JSX.Element {
  if (load.status === 'loading') return <ChangeSkeleton />;
  if (load.status === 'error') {
    return (
      <Stack gap={6}>
        <PageHeader
          title="Change a field"
          actions={
            <Button variant="ghost" onClick={onBack}>
              Back to the fields
            </Button>
          }
        />
        <Alert
          tone="danger"
          title="Could not check the values"
          action={
            load.retry === undefined ? undefined : (
              <Button size="sm" onClick={load.retry}>
                Try again
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

/** The page as it will be drawn: the header, the summary, and rows to come. */
function ChangeSkeleton(): JSX.Element {
  return (
    <Stack gap={6} role="status" aria-busy="true" aria-label="Checking every value">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-36 w-full rounded-lg" />
      <Skeleton className="h-10 w-full" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-28 w-full rounded-lg" />
      ))}
    </Stack>
  );
}

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
  const [chosen, setChosen] = useState<Readonly<Record<string, ReviewAction>>>({});
  const [typed, setTyped] = useState<Readonly<Record<string, AttributeValue>>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<ReviewAction>(view.defaultAction);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const actionOf = (personId: string): ReviewAction => chosen[personId] ?? view.defaultAction;
  const empty = (v: AttributeValue | undefined) =>
    v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  const missing = view.unfit.filter(
    (u) => actionOf(u.personId) === 'edit' && empty(typed[u.personId]),
  );
  const title = `Change ${field.label} to ${DATA_TYPE_LABEL[field.to].toLowerCase()}`;
  const from =
    field.from === field.to
      ? `Its format changes.`
      : `It is ${DATA_TYPE_LABEL[field.from].toLowerCase()} now.`;
  const inputField = (name: string) => ({
    key: field.key,
    label: `New ${field.label} for ${name}`,
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
    setChosen((c) => ({ ...c, ...Object.fromEntries(rows.map((u) => [u.personId, bulk])) }));
  };

  const publish = async (): Promise<void> => {
    setShown(true);
    if (missing.length > 0 || view.blockedBy !== null) return;
    setBusy(true);
    setRefused(null);
    const outcome = await onApply(
      view.unfit.map((u) => {
        const action = actionOf(u.personId);
        return action === 'edit'
          ? { personId: u.personId, action, value: typed[u.personId] ?? null }
          : { personId: u.personId, action };
      }),
    );
    setBusy(false);
    if (!outcome.ok) setRefused(outcome.message);
  };

  const counts = view.unfit.reduce<Partial<Record<ReviewAction, number>>>((n, u) => {
    const a = actionOf(u.personId);
    return { ...n, [a]: (n[a] ?? 0) + 1 };
  }, {});

  return (
    <Stack gap={6}>
      <PageHeader
        title={title}
        description={`${from} Every value is checked first; nothing changes for anybody until you publish.`}
        actions={
          <Button variant="ghost" onClick={onBack}>
            Back to the fields
          </Button>
        }
      />

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
        <CardHeader>
          <CardTitle level={2}>
            {view.withValue === 0
              ? 'Nobody has a value yet'
              : `${plural(view.withValue, 'person has', 'people have')} a value`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Stack gap={4}>
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{plural(view.converted.count, 'converts', 'convert')}</Badge>
              <Badge>{plural(view.unchanged, 'already fits', 'already fit')}</Badge>
              <Badge tone={view.unfit.length === 0 ? 'neutral' : 'warning'}>
                {plural(view.unfit.length, 'needs you', 'need you')}
              </Badge>
            </div>
            {view.dateOrder === null || view.dateOrder === 'iso' ? null : (
              <p className="text-sm text-fg-muted">
                Dates are read as {ORDER_WORDS[view.dateOrder]}, the way most of them are written.
              </p>
            )}
            {view.converted.samples.length === 0 ? null : (
              <div>
                <h3 className="mb-2 text-sm font-medium">For example</h3>
                <ul className="flex flex-col gap-1.5" aria-label="Example conversions">
                  {view.converted.samples.map((s, i) => (
                    // Positional: two people may have typed the same thing.
                    <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono">{s.before}</span>
                      <icons.forward aria-label="becomes" className="size-4 text-fg-muted" />
                      <span className="font-medium">{s.after}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm text-fg-muted">
              Each converted value is written as a correction: its history keeps what was typed.
            </p>
          </Stack>
        </CardContent>
      </Card>

      <section aria-labelledby="unfit-heading" className="flex flex-col gap-4">
        <h2 id="unfit-heading" className="text-md font-semibold">
          Values that don’t fit
        </h2>
        {view.unfit.length === 0 ? (
          <EmptyState
            title="Every value fits"
            description="Nothing to decide: publishing converts them all."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="min-w-0 flex-1 basis-60">
                <FieldLabel>
                  {selected.size === 0
                    ? `For all ${String(view.unfit.length)}`
                    : `For the ${String(selected.size)} selected`}
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
              <Button onClick={applyBulk}>Apply</Button>
            </div>
            <ul className="flex flex-col gap-3" aria-label="Values that don’t fit">
              {view.unfit.map((u) => {
                const action = actionOf(u.personId);
                const problem =
                  shown && action === 'edit' && empty(typed[u.personId])
                    ? 'Type the new value, or choose something else.'
                    : undefined;
                return (
                  <li key={u.personId}>
                    <Card variant="outlined" padded>
                      <div className="flex flex-col gap-3 @container">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            aria-label={`Select ${u.name}`}
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
                            <FieldLabel>What to do with {u.name}’s value</FieldLabel>
                            <Select
                              value={action}
                              onValueChange={(v) => {
                                setChosen((c) => ({ ...c, [u.personId]: v as ReviewAction }));
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
                                setTyped((t) => ({ ...t, [u.personId]: value }));
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

      <Card variant="fill" padded>
        <Stack gap={3}>
          <p className="text-sm">
            Publishing writes the new version and, together,{' '}
            {[
              plural(view.converted.count, 'conversion', 'conversions'),
              ...(Object.entries(counts) as [ReviewAction, number][]).map(
                ([a, n]) => `${ACTION[a].label.toLowerCase()} for ${plural(n, 'person', 'people')}`,
              ),
            ].join(', ')}
            .
            {view.alsoPublished === 0
              ? ''
              : ` ${plural(view.alsoPublished, 'other change', 'other changes')} in the draft ${view.alsoPublished === 1 ? 'is' : 'are'} published with it.`}
          </p>
          {refused === null ? null : (
            <Alert tone="danger" title="Nothing was published">
              {refused}
            </Alert>
          )}
          {shown && missing.length > 0 ? (
            <Alert tone="danger">
              {plural(missing.length, 'value still needs', 'values still need')} typing in.
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={busy}
              loadingLabel="Publishing the change"
              disabled={view.blockedBy !== null}
              onClick={() => {
                void publish();
              }}
            >
              Publish the change
            </Button>
            <Button variant="ghost" onClick={onBack}>
              Not now
            </Button>
          </div>
        </Stack>
      </Card>
    </Stack>
  );
}
