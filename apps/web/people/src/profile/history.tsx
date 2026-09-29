import {
  Alert,
  Avatar,
  Badge,
  Button,
  DatePicker,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  PageHeader,
  PageSection,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Timeline,
  TimelineItem,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { useHeld } from '../held';
import { Loaded, type Loadable } from '../load';
import { DisplayValue, longDate } from '../record/display';
import type { AttributeValue, RecordField, RecordSection, Values } from '../record/model';
import { SensitiveMark } from '../record/pending';

/** One recorded change (PEO-064). A sealed field's reads `{ last4: null }`: it changed, nothing more. */
export interface HistoryChange {
  readonly id: string;
  readonly key: string;
  readonly value: AttributeValue;
  /** When it takes effect. */
  readonly effectiveFrom: string;
  /** When it was recorded, an instant. */
  readonly recordedAt: string;
  /** Who recorded it, in words. */
  readonly by: string;
  /** Who, to draw: a person and their photo, or the product or an integration. Absent: a person. */
  readonly actor?: {
    /** person, integration or system. */
    readonly kind: string;
    readonly avatarUrl: string | null;
  };
  /** The change this one corrects. */
  readonly supersedes: string | null;
  /** The correction that replaced this one. */
  readonly supersededBy: string | null;
}

export interface HistoryState {
  readonly person: { readonly id: string; readonly name: string };
  /** The date read as of; null is today. */
  readonly asOf: string | null;
  /** Already filtered: only fields this viewer may read now. */
  readonly sections: readonly RecordSection[];
  /** Keys with an "as of". The rest have changes and no value on a past date. */
  readonly dated: readonly string[];
  readonly values: Values;
  /** Newest in effect first. */
  readonly changes: readonly HistoryChange[];
}

export interface PersonHistoryProps {
  readonly load: Loadable<HistoryState>;
  /** Read the record as of another date; null is today. */
  readonly onAsOf: (asOf: string | null) => void;
  /** Back to the profile. */
  readonly onBack?: () => void;
  /** The one field the history is narrowed to (`?field=`), held by the host; null for every field. */
  readonly field?: string | null;
  readonly onFieldChange?: (field: string | null) => void;
}

const ALL = 'all';

/**
 * The viewer's own zone, once the page is in their browser. The server and
 * the first browser render agree on UTC, so hydration matches; the effect
 * then redraws every time on the viewer's clock.
 */
function useViewerZone(): string | undefined {
  const [zone, setZone] = useState<string | undefined>('UTC');
  useEffect(() => {
    setZone(undefined);
  }, []);
  return zone;
}

const dayKey = (iso: string, zone: string | undefined): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));

/**
 * "What did this look like in March" (PEO-064, PRD §8.5), read as a story:
 * every change, newest first, grouped by the day it was made, each saying
 * what changed, from what to what, who did it and when on the viewer's clock.
 *
 * The effective date is printed only where it differs from the day it was
 * recorded, because a raise recorded on the 15th and effective the 1st is not
 * explicable without it and a phone number changed today needs no second
 * date. A correction is its own entry naming what it replaced, never the old
 * value quietly changing, so a typo fixed in June does not read as a pay cut
 * followed by a raise. The record as it stood on a past date is one date
 * picker away. What the viewer may not read now is not in `load` at all, and a
 * sealed field shows only that it changed.
 */
export function PersonHistory({ load, ...props }: PersonHistoryProps): JSX.Element {
  return (
    <Loaded load={load} what="this history">
      {(state) => <History state={state} {...props} />}
    </Loaded>
  );
}

function History({
  state,
  onAsOf,
  onBack,
  field,
  onFieldChange,
}: Omit<PersonHistoryProps, 'load'> & { readonly state: HistoryState }): JSX.Element {
  const [chosen, choose] = useHeld<string | null>(field, onFieldChange, null);
  const zone = useViewerZone();
  const fields = new Map<string, RecordField>(
    state.sections.flatMap((s) => s.fields.map((f) => [f.key, f] as const)),
  );
  // A field this viewer may read, or every field.
  const only = chosen !== null && fields.has(chosen) ? chosen : ALL;
  const setOnly = (next: string): void => {
    choose(next === ALL ? null : next);
  };
  const dated = new Set(state.dated);
  const sections = state.sections
    .map((s) => ({ ...s, fields: s.fields.filter((f) => only === ALL || f.key === only) }))
    .filter((s) => s.fields.length > 0);
  const byId = new Map(state.changes.map((c) => [c.id, c]));
  // Newest first by when it was done: the top of the page is what just happened.
  const changes = state.changes
    .filter((c) => fields.has(c.key) && (only === ALL || c.key === only))
    .toSorted((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const days = new Map<string, HistoryChange[]>();
  for (const c of changes) {
    const day = dayKey(c.recordedAt, zone);
    days.set(day, [...(days.get(day) ?? []), c]);
  }
  const today = dayKey(new Date().toISOString(), zone);
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString(), zone);
  const dayTitle = (day: string): string =>
    day === today ? 'Today' : day === yesterday ? 'Yesterday' : longDate(day);

  return (
    <Stack gap={6}>
      <PageHeader
        title="History"
        description={`Every change to ${state.person.name}’s record, newest first.`}
        actions={onBack === undefined ? undefined : <Button onClick={onBack}>Profile</Button>}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>Field</FieldLabel>
          <Select value={only} onValueChange={setOnly}>
            <FieldControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              <SelectItem value={ALL}>All fields</SelectItem>
              {[...fields.values()].map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DatePicker label="See the record as it was on" value={state.asOf} onChange={onAsOf} />
      </div>
      {state.asOf === null ? null : (
        <>
          <Alert
            tone="info"
            title={`As it stood on ${longDate(state.asOf)}`}
            action={
              <Button
                size="sm"
                onClick={() => {
                  onAsOf(null);
                }}
              >
                Today
              </Button>
            }
          >
            Includes later corrections. Fields without dates, like phone number, show only their changes.
          </Alert>
          {sections.map((section) => (
            <PageSection key={section.key} surface title={section.label}>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,auto)_1fr]">
                {section.fields.map((field) => (
                  <div key={field.key} className="contents">
                    <dt className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                      {field.label}
                      <SensitiveMark field={field} />
                    </dt>
                    <dd className="text-sm">
                      {!dated.has(field.key) ? (
                        <span className="text-fg-muted">Not kept by date</span>
                      ) : (
                        <DisplayValue field={field} value={state.values[field.key]} />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </PageSection>
          ))}
        </>
      )}
      <PageSection surface title="Changes">
        {changes.length === 0 ? (
          <EmptyState title="No changes recorded" />
        ) : (
          <Stack gap={6}>
            {[...days].map(([day, items]) => (
              <section key={day} aria-labelledby={`day-${day}`} className="flex flex-col gap-3">
                <h3 id={`day-${day}`} className="text-sm font-medium text-fg-muted">
                  {dayTitle(day)}
                </h3>
                <Timeline aria-label={`Changes, ${dayTitle(day)}`}>
                  {items.map((c, i) => (
                    <Change
                      key={c.id}
                      change={c}
                      field={fields.get(c.key) as RecordField}
                      previous={previousOf(c, state.changes, byId)}
                      corrected={c.supersedes === null ? undefined : byId.get(c.supersedes)}
                      replacement={c.supersededBy === null ? undefined : byId.get(c.supersededBy)}
                      dated={dated.has(c.key)}
                      zone={zone}
                      last={i === items.length - 1}
                    />
                  ))}
                </Timeline>
              </section>
            ))}
          </Stack>
        )}
      </PageSection>
    </Stack>
  );
}

/**
 * What stood before a change: for a correction, what it corrects; otherwise
 * the value of the same field in force just before it, corrections applied.
 */
function previousOf(
  change: HistoryChange,
  all: readonly HistoryChange[],
  byId: ReadonlyMap<string, HistoryChange>,
): HistoryChange | undefined {
  if (change.supersedes !== null) return byId.get(change.supersedes);
  return all
    .filter(
      (c) =>
        c.key === change.key &&
        c.id !== change.id &&
        c.supersededBy === null &&
        (c.effectiveFrom < change.effectiveFrom ||
          (c.effectiveFrom === change.effectiveFrom && c.recordedAt < change.recordedAt)),
    )
    .toSorted(
      (a, b) =>
        a.effectiveFrom.localeCompare(b.effectiveFrom) || a.recordedAt.localeCompare(b.recordedAt),
    )
    .at(-1);
}

const empty = (value: AttributeValue | undefined): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

function Change({
  change,
  field,
  previous,
  corrected,
  replacement,
  dated,
  zone,
  last,
}: {
  readonly change: HistoryChange;
  readonly field: RecordField;
  readonly previous: HistoryChange | undefined;
  readonly corrected: HistoryChange | undefined;
  readonly replacement: HistoryChange | undefined;
  readonly dated: boolean;
  readonly zone: string | undefined;
  readonly last: boolean;
}): JSX.Element {
  const kind = change.actor?.kind ?? 'person';
  const title = corrected
    ? `${field.label} corrected`
    : empty(change.value)
      ? `${field.label} cleared`
      : previous === undefined || empty(previous.value)
        ? `${field.label} added`
        : `${field.label} changed`;
  const at = new Date(change.recordedAt);
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  const full = new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(at);
  const recordedDay = change.recordedAt.slice(0, 10);
  const marker =
    kind === 'person' ? (
      <Avatar size="sm" name={change.by} src={change.actor?.avatarUrl ?? undefined} />
    ) : (
      <Avatar
        size="sm"
        name={change.by}
        fallback={kind === 'system' ? <icons.system aria-hidden /> : <icons.link aria-hidden />}
      />
    );

  return (
    <TimelineItem
      last={last}
      marker={marker}
      title={title}
      timestamp={
        <time dateTime={change.recordedAt} title={full}>
          {time}
        </time>
      }
    >
      <Stack gap={1}>
        <p className="text-sm text-fg">
          {previous === undefined || empty(previous.value) ? null : (
            <>
              <span className="text-fg-muted line-through">
                <DisplayValue field={field} value={previous.value} />
              </span>{' '}
              <span aria-hidden>→</span>
              <span className="sr-only">to</span>{' '}
            </>
          )}
          <span className={replacement ? 'line-through' : 'font-medium'}>
            <DisplayValue field={field} value={change.value} />
          </span>
        </p>
        <p className="text-xs text-fg-muted">
          {kind === 'system' ? 'Done automatically' : `By ${change.by}`}
          {dated && change.effectiveFrom !== recordedDay
            ? ` · effective ${longDate(change.effectiveFrom)}`
            : null}
        </p>
        {corrected ? (
          <span className="inline-flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <Badge size="sm" tone="warning">
              Correction
            </Badge>
            <span>A mistake fixed: it replaces the value recorded {longDate(corrected.recordedAt.slice(0, 10))}.</span>
          </span>
        ) : replacement ? (
          <span className="inline-flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <Badge size="sm">Superseded</Badge>
            <span>Corrected on {longDate(replacement.recordedAt.slice(0, 10))}</span>
          </span>
        ) : null}
      </Stack>
    </TimelineItem>
  );
}
