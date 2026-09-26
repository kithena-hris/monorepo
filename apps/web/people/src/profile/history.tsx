import {
  Alert,
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
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { DisplayValue, longDate } from '../record/display';
import type { AttributeValue, RecordField, RecordSection, Values } from '../record/model';

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
}

const ALL = 'all';

/** An instant, the same on the server and in the browser. */
const when = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/**
 * "What did this look like in March" (PEO-064, PRD §8.5): one person's record
 * as it stood on a date, and every change behind it, one field at a time if
 * asked.
 *
 * Both dates are printed on every change, because a raise recorded on the
 * 15th and effective the 1st is not explicable with one. A correction is shown
 * as what it is — a new row naming the one it replaces — never as the old
 * value quietly changing, so a typo fixed in June does not read as a pay cut
 * followed by a raise. What the viewer may not read now is not in `load` at
 * all, and a sealed field shows only that it changed.
 */
export function PersonHistory({ load, onAsOf, onBack }: PersonHistoryProps): JSX.Element {
  return (
    <Loaded load={load} what="this history">
      {(state) => <History state={state} onAsOf={onAsOf} onBack={onBack} />}
    </Loaded>
  );
}

function History({
  state,
  onAsOf,
  onBack,
}: {
  readonly state: HistoryState;
  readonly onAsOf: PersonHistoryProps['onAsOf'];
  readonly onBack: PersonHistoryProps['onBack'];
}): JSX.Element {
  const [only, setOnly] = useState(ALL);
  const fields = new Map<string, RecordField>(
    state.sections.flatMap((s) => s.fields.map((f) => [f.key, f] as const)),
  );
  const dated = new Set(state.dated);
  const sections = state.sections
    .map((s) => ({ ...s, fields: s.fields.filter((f) => only === ALL || f.key === only) }))
    .filter((s) => s.fields.length > 0);
  const changes = state.changes.filter(
    (c) => fields.has(c.key) && (only === ALL || c.key === only),
  );
  const byId = new Map(state.changes.map((c) => [c.id, c]));

  return (
    <Stack gap={6}>
      <PageHeader
        title={`${state.person.name}: history`}
        description="What the record held on a date, and every change behind it."
        actions={onBack === undefined ? undefined : <Button onClick={onBack}>Profile</Button>}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <DatePicker
          label={state.asOf === null ? 'As of today' : 'As of'}
          value={state.asOf}
          onChange={onAsOf}
        />
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
      </div>
      {state.asOf === null ? null : (
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
          Corrections made since are applied: this is what we now know was true that day. A field
          kept without dates, like a phone number, has no value on a past day, only its changes.
        </Alert>
      )}
      {sections.map((section) => (
        <PageSection key={section.key} surface title={section.label}>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,auto)_1fr]">
            {section.fields.map((field) => (
              <div key={field.key} className="contents">
                <dt className="text-sm text-fg-muted">{field.label}</dt>
                <dd className="text-sm">
                  {state.asOf !== null && !dated.has(field.key) ? (
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
      <PageSection surface title="Changes">
        {changes.length === 0 ? (
          <EmptyState title="No changes recorded" />
        ) : (
          <Timeline aria-label="Changes, newest in effect first">
            {changes.map((c, i) => {
              const field = fields.get(c.key) as RecordField;
              const corrected = c.supersedes === null ? undefined : byId.get(c.supersedes);
              const replacement = c.supersededBy === null ? undefined : byId.get(c.supersededBy);
              return (
                <TimelineItem
                  key={c.id}
                  last={i === changes.length - 1}
                  tone={corrected ? 'warning' : replacement ? 'neutral' : 'accent'}
                  title={
                    <>
                      {field.label}:{' '}
                      <span className={replacement ? 'line-through' : undefined}>
                        <DisplayValue field={field} value={c.value} />
                      </span>
                    </>
                  }
                  timestamp={`Recorded ${when(c.recordedAt)} by ${c.by}`}
                  effectiveFrom={dated.has(c.key) ? longDate(c.effectiveFrom) : undefined}
                >
                  {corrected ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <Badge size="sm" tone="warning">
                        Correction
                      </Badge>
                      <span>
                        Replaces <DisplayValue field={field} value={corrected.value} />, recorded{' '}
                        {when(corrected.recordedAt)}
                      </span>
                    </span>
                  ) : replacement ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <Badge size="sm">Superseded</Badge>
                      <span>Corrected on {when(replacement.recordedAt)}</span>
                    </span>
                  ) : null}
                </TimelineItem>
              );
            })}
          </Timeline>
        )}
      </PageSection>
    </Stack>
  );
}
