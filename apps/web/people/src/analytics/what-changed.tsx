import {
  Alert,
  AssistantCard,
  Badge,
  Button,
  Card,
  ChartCard,
  Checkbox,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  PageHeader,
  SegmentedControl,
  SegmentedControlItem,
  Separator,
  Skeleton,
  Spinner,
  Stack,
  StackedBarChart,
  Textarea,
  TrendChart,
  icons,
  type ChartPoint,
} from '@reach/ui';
import { useEffect, useId, useState, type SyntheticEvent, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import type { ReportSchedulesState } from '../reports/report-schedules';
import type { SegmentRef } from '../segments';
import { InsightsHeader } from './analytics';
import type { ScheduleActions } from './schedules';

/**
 * What changed (design AI5, AI6, MA4, MA5): the first tab of Insights.
 *
 * A period's changes as a handful of points, each with its figure, its
 * sentence and the records it came from, a follow-up question, and the
 * summary exported or sent to somebody, rewritten for what they may see,
 * every sentence editable first.
 *
 * Every figure and name in a point is People's, from the same snapshots as
 * the charts, marked in bold where it was filled in. The assistant, where
 * there is one, only words the sentences and answers from them; the card
 * says which wrote what the reader is reading. Under a finger the card holds
 * the first three points and the export becomes Share (MA4, MA5).
 *
 * The period, the question and the export dialog's choices live in the
 * address; the sentences edited in the preview are a draft until it is sent.
 */

/** Where a point's records are. */
export type Source =
  | { readonly kind: 'joiners'; readonly label: string; readonly from: string; readonly to: string }
  | { readonly kind: 'group'; readonly label: string; readonly value: string }
  | {
      readonly kind:
        'section' | 'headcount' | 'turnover' | 'completeness' | 'org-chart' | 'span' | 'pay';
      readonly label: string;
    };

/** A run of a sentence: People's words, or a figure or name it filled in. */
export interface Part {
  readonly text: string;
  readonly strong: boolean;
}

export interface Point {
  readonly key: string;
  /** "+14", "−6 pts". */
  readonly figure: string;
  readonly text: string;
  readonly parts: readonly Part[];
  readonly sources: readonly Source[];
  /** "Finance only", where fewer may read it than read Insights. */
  readonly audience: string | null;
}

export interface WhatChangedState {
  readonly asOf: string;
  readonly period: {
    readonly kind: string;
    readonly from: string;
    readonly to: string;
    readonly partial: boolean;
    /** "September". */
    readonly name: string;
    /** "in September". */
    readonly inWords: string;
    /** "September 2026 compared with August". */
    readonly compared: string;
  };
  /** "September in five points". */
  readonly title: string;
  /** "08:00". */
  readonly writtenAt: string;
  readonly minimum: number;
  readonly segment: SegmentRef | null;
  readonly segments: readonly SegmentRef[];
  readonly points: readonly Point[];
  /** The assistant may word the points (`onWorded`). */
  readonly phrasable: boolean;
  readonly headcount: {
    readonly value: number;
    readonly change: number;
    readonly trend: readonly ChartPoint[];
  } | null;
  readonly leavers: {
    readonly categories: readonly string[];
    readonly series: readonly { readonly label: string; readonly values: readonly number[] }[];
  } | null;
  /** Whom it may be sent to; empty for anybody who may not send it. */
  readonly recipients: readonly { readonly accountId: string; readonly name: string }[];
  readonly canSend: boolean;
  readonly schedules?: ReportSchedulesState | null;
}

/** A summary as it goes, or went, to somebody. */
export interface SummaryDocument {
  readonly company: string | null;
  readonly title: string;
  readonly preparedBy: string;
  readonly preparedOn: string;
  readonly points: readonly {
    readonly key: string;
    readonly figure: string;
    readonly text: string;
    readonly audience: string | null;
  }[];
  readonly chart: readonly ChartPoint[] | null;
  readonly madeLine: string | null;
}

export interface SummaryDraft {
  readonly recipient: { readonly accountId: string; readonly name: string } | null;
  readonly notes: readonly string[];
  readonly document: SummaryDocument;
}

/** A summary somebody sent, as its recipient opens it. */
export interface SharedSummary {
  readonly id: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly document: SummaryDocument;
}

export interface FollowUpAnswer {
  readonly kind: 'answer' | 'refused' | 'unknown';
  readonly sentences: readonly (readonly Part[])[];
  readonly keys: readonly string[];
  readonly byModel: boolean;
}

/** An answer that crossed as JSON: the object, or why there is none. */
export type Parsed =
  { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly message: string };

/** The export dialog's choices, in the address. */
export interface ExportChoices {
  readonly format: 'pdf' | 'email';
  /** An account; null is the viewer. */
  readonly recipient: string | null;
  readonly tone: 'short' | 'detailed';
  readonly charts: boolean;
  readonly madeLine: boolean;
}

/** What the dialog sends People: its choices and the sentences as edited. */
export interface SummaryInput {
  readonly recipient?: string;
  readonly tone: 'short' | 'detailed';
  readonly charts: boolean;
  readonly madeLine: boolean;
  readonly format?: 'pdf' | 'email';
  readonly edits: readonly { readonly key: string; readonly text: string }[];
}

export interface WhatChangedProps {
  readonly load: Loadable<WhatChangedState | { readonly shared: SharedSummary | null }>;
  readonly schedules?: ScheduleActions;
  /** Applied by the shell, server-side: `?segment=<id>`. */
  readonly segmentId?: string | null;
  readonly onSegmentChange?: (segmentId: string | null) => void;
  /** A new period: a navigation, People answers again. */
  readonly onPeriodChange?: (period: {
    readonly kind: string;
    readonly from?: string;
    readonly to?: string;
  }) => void;
  /** The follow-up in the address (`?ask=`). */
  readonly question?: string | null;
  readonly onQuestionChange?: (question: string | null) => void;
  readonly onAsk?: (question: string) => Promise<Parsed>;
  /** The points in the assistant's words, or null when they could not be had. */
  readonly onWorded?: () => Promise<unknown>;
  /** The export dialog, open, and its choices; null when closed. */
  readonly exporting?: ExportChoices | null;
  readonly onExportingChange?: (next: ExportChoices | null) => void;
  readonly onDraft?: (input: SummaryInput) => Promise<Parsed>;
  readonly onDownload?: (input: SummaryInput) => Promise<Outcome>;
  readonly onSend?: (input: SummaryInput & { readonly recipient: string }) => Promise<Parsed>;
}

const FIRST_ON_A_PHONE = 3;

/** "You" in the recipient picker: the summary for the viewer themself. */
const ME = '__me';

const CLOSED: ExportChoices = {
  format: 'pdf',
  recipient: null,
  tone: 'short',
  charts: true,
  madeLine: true,
};

const directory = (conditions: readonly object[]): string =>
  `/people/directory/list?conditions=${encodeURIComponent(JSON.stringify(conditions))}`;

/** Where a source's records are, in this app. */
export function sourceHref(source: Source, segmentId: string | null): string {
  const insights = (tab: string) =>
    `/people/insights/${tab}${segmentId === null ? '' : `?segment=${encodeURIComponent(segmentId)}`}`;
  switch (source.kind) {
    case 'joiners':
      return directory([{ key: 'hire_date', op: 'between', values: [source.from, source.to] }]);
    case 'group':
      return directory([{ key: 'org_unit', op: 'is', values: [source.value] }]);
    case 'headcount':
      return insights('headcount');
    case 'turnover':
    case 'span':
      return insights('turnover');
    case 'pay':
      return insights('pay');
    case 'org-chart':
      return '/people/directory/org-chart';
    default:
      return '/people/review/waiting?kind=missing';
  }
}

const signed = (n: number): string =>
  n > 0 ? `+${n.toLocaleString()}` : n < 0 ? `−${(-n).toLocaleString()}` : '0';

const firstName = (name: string): string => name.split(' ')[0] ?? name;

function Sentence({ parts }: { readonly parts: readonly Part[] }): JSX.Element {
  return (
    <>
      {parts.map((p, i) =>
        p.strong ? (
          <strong key={i} className="font-semibold">
            {p.text}
          </strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const isState = (data: unknown): data is WhatChangedState =>
  typeof data === 'object' && data !== null && 'points' in data;

export function WhatChanged(props: WhatChangedProps): JSX.Element {
  return (
    <Loaded load={props.load} what="what changed">
      {(data) =>
        isState(data) ? (
          <Summary state={data} {...props} />
        ) : (
          <Shared shared={'shared' in data ? data.shared : null} />
        )
      }
    </Loaded>
  );
}

function Summary({
  state,
  schedules,
  segmentId = null,
  onSegmentChange,
  onPeriodChange,
  question = null,
  onQuestionChange,
  onAsk,
  onWorded,
  exporting = null,
  onExportingChange,
  onDraft,
  onDownload,
  onSend,
}: WhatChangedProps & { readonly state: WhatChangedState }): JSX.Element {
  const reports =
    schedules !== undefined && state.schedules != null && state.schedules.canManage
      ? state.schedules
      : null;
  const asked = `${state.period.from}|${state.period.to}|${state.segment?.id ?? ''}`;
  const [worded, setWorded] = useState<{
    readonly asked: string;
    readonly points: readonly Point[];
    readonly byModel: boolean;
  } | null>(null);
  const wording = state.phrasable && onWorded !== undefined;
  useEffect(() => {
    if (!wording) return undefined;
    let live = true;
    void onWorded()
      .catch(() => null)
      .then((answer) => {
        const a = answer as { points?: Point[]; byModel?: boolean } | null;
        if (live && a?.points !== undefined && a.byModel === true) {
          setWorded({ asked, points: a.points, byModel: true });
        }
      });
    return () => {
      live = false;
    };
    // `asked` stands for the period and the segment together.
  }, [asked, wording]);
  const shown = worded?.asked === asked ? worded : null;
  const points = shown?.points ?? state.points;
  const [more, setMore] = useState(false);
  const open = (): void => {
    onExportingChange?.(CLOSED);
  };
  const exportable = onExportingChange !== undefined && state.points.length > 0;

  return (
    <Stack gap={6}>
      <InsightsHeader
        description={`${state.asOf}${state.segment ? ` · ${state.segment.name}` : ''} · From nightly snapshots. Groups under ${String(state.minimum)} people are hidden.`}
        segments={state.segments}
        segmentId={segmentId}
        onSegmentChange={onSegmentChange}
        reports={reports}
        schedules={schedules}
        exportAction={
          exportable ? (
            <Button
              variant="primary"
              startIcon={<icons.download aria-hidden />}
              className="touch:hidden"
              onClick={open}
            >
              Export
            </Button>
          ) : null
        }
      />
      {state.segment ? (
        <Alert tone="info">
          Showing the people you may see in {state.segment.name}. Span of control and pay are not
          described for a segment.
        </Alert>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 @5xl/page:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <AssistantCard
          level={2}
          title={state.title}
          action={<Badge tone="assistant">Written {state.writtenAt}</Badge>}
          note={`Every number links to the records behind it. Groups under ${String(state.minimum)} people are never described. ${
            shown === null
              ? 'Worded by Kithena’s own rules from the figures.'
              : 'Worded by the assistant; every figure is Kithena’s.'
          }`}
        >
          <PeriodControl state={state} onPeriodChange={onPeriodChange} />
          {points.length === 0 ? (
            <p className="text-fg-muted">
              Nothing Kithena can describe changed {state.period.inWords}, or none of it is yours to
              see.
            </p>
          ) : (
            <ul aria-label={state.title} aria-busy={wording && shown === null ? true : undefined}>
              {points.map((p, i) => (
                <li
                  key={p.key}
                  className={i >= FIRST_ON_A_PHONE && !more ? 'touch:hidden' : undefined}
                >
                  {i === 0 ? null : <Separator />}
                  <PointRow point={p} segmentId={state.segment?.id ?? null} />
                </li>
              ))}
            </ul>
          )}
          {points.length > FIRST_ON_A_PHONE && !more ? (
            <Button
              variant="ghost"
              size="sm"
              className="hidden touch:inline-flex"
              onClick={() => {
                setMore(true);
              }}
            >
              Show {points.length - FIRST_ON_A_PHONE} more
            </Button>
          ) : null}
          {onAsk === undefined || state.points.length === 0 ? null : (
            <FollowUp
              state={state}
              question={question}
              onQuestionChange={onQuestionChange}
              onAsk={onAsk}
              onExport={exportable ? open : undefined}
            />
          )}
        </AssistantCard>

        <div className="flex flex-col gap-3.5 touch:hidden">
          {state.headcount === null ? null : (
            <ChartCard
              title="Headcount"
              value={state.headcount.value.toLocaleString()}
              description={
                state.headcount.change === 0
                  ? `No change ${state.period.inWords}`
                  : `${signed(state.headcount.change)} ${state.period.inWords}`
              }
            >
              {state.headcount.trend.length > 1 ? (
                <TrendChart
                  label="Headcount by month"
                  height={110}
                  area
                  showLastPoint
                  series={[{ label: 'Headcount', data: state.headcount.trend }]}
                />
              ) : null}
            </ChartCard>
          )}
          {state.leavers === null ? null : (
            <ChartCard title="Leavers by team, 3 months">
              <StackedBarChart
                label="Leavers by team and month"
                height={160}
                categories={state.leavers.categories}
                series={state.leavers.series}
              />
            </ChartCard>
          )}
        </div>
      </div>

      {exportable ? (
        <Button
          fullWidth
          variant="primary"
          startIcon={<icons.share aria-hidden />}
          className="hidden touch:inline-flex"
          onClick={open}
        >
          Share summary
        </Button>
      ) : null}

      {exporting === null || onExportingChange === undefined ? null : (
        <ExportDialog
          state={state}
          choices={exporting}
          onChoicesChange={onExportingChange}
          onDraft={onDraft}
          onDownload={onDownload}
          onSend={onSend}
        />
      )}
    </Stack>
  );
}

const PERIODS = [
  ['week', 'This week'],
  ['month', 'This month'],
  ['quarter', 'This quarter'],
  ['custom', 'Custom'],
] as const;

/** This week, month or quarter, or two dates; and what it is compared with. */
function PeriodControl({
  state,
  onPeriodChange,
}: {
  readonly state: WhatChangedState;
  readonly onPeriodChange: WhatChangedProps['onPeriodChange'];
}): JSX.Element {
  const { period } = state;
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const id = useId();
  const apply = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (from !== '' && to !== '') onPeriodChange?.({ kind: 'custom', from, to });
  };
  return (
    // Under a finger the card is the month's, as the design draws it (MA4).
    <div className="flex flex-col gap-2.5 touch:hidden">
      <div className="flex flex-wrap items-center gap-2.5">
        <SegmentedControl
          aria-label="Period"
          size="sm"
          value={period.kind}
          onValueChange={(kind) => {
            onPeriodChange?.(
              kind === 'custom' ? { kind, from: period.from, to: period.to } : { kind },
            );
          }}
        >
          {PERIODS.map(([value, label]) => (
            <SegmentedControlItem key={value} value={value}>
              {label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <p className="ms-auto text-sm text-fg-muted">{period.compared}</p>
      </div>
      {period.kind === 'custom' ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={apply}
          aria-label="Custom period"
        >
          <Field>
            <FieldLabel htmlFor={`${id}-from`}>From</FieldLabel>
            <FieldControl>
              <Input
                id={`${id}-from`}
                type="date"
                size="sm"
                value={from}
                max={to}
                onChange={(e) => {
                  setFrom(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-to`}>To</FieldLabel>
            <FieldControl>
              <Input
                id={`${id}-to`}
                type="date"
                size="sm"
                value={to}
                min={from}
                onChange={(e) => {
                  setTo(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <Button type="submit" size="sm">
            Show
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** One point: its figure, its sentence, and the records it came from. */
function PointRow({
  point,
  segmentId,
}: {
  readonly point: Point;
  readonly segmentId: string | null;
}): JSX.Element {
  const [first] = point.sources;
  return (
    <div className="flex gap-3.5 py-3.5">
      <Badge size="lg" tone="neutral" className="min-w-14 justify-center font-bold tabular-nums">
        {point.figure}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-pretty">
          <Sentence parts={point.parts} />
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {point.sources.map((s) => (
            <Button key={`${s.kind}:${s.label}`} asChild size="xs" variant="secondary">
              <a href={sourceHref(s, segmentId)}>{s.label}</a>
            </Button>
          ))}
          {point.audience === null ? null : (
            <Badge size="sm" tone="neutral">
              <icons.locked aria-hidden />
              {point.audience}
            </Badge>
          )}
        </div>
      </div>
      {first === undefined ? null : (
        <Button asChild variant="ghost" size="xs" className="touch:hidden">
          <a href={sourceHref(first, segmentId)} aria-label={`Open ${first.label}`}>
            <icons.externalLink aria-hidden />
          </a>
        </Button>
      )}
    </div>
  );
}

/** A follow-up question, answered from the points, and the way to export them. */
function FollowUp({
  state,
  question,
  onQuestionChange,
  onAsk,
  onExport,
}: {
  readonly state: WhatChangedState;
  readonly question: string | null;
  readonly onQuestionChange: WhatChangedProps['onQuestionChange'];
  readonly onAsk: NonNullable<WhatChangedProps['onAsk']>;
  readonly onExport: (() => void) | undefined;
}): JSX.Element {
  const [text, setText] = useState(question ?? '');
  const [answer, setAnswer] = useState<{
    readonly asked: string;
    readonly result: FollowUpAnswer | string;
  } | null>(null);
  const asked = `${question ?? ''}|${state.period.from}|${state.period.to}|${state.segment?.id ?? ''}`;
  useEffect(() => {
    if (question === null) return undefined;
    let live = true;
    void onAsk(question)
      .catch(() => ({ ok: false as const, message: 'People could not be asked' }))
      .then((a) => {
        if (live) setAnswer({ asked, result: a.ok ? (a.data as FollowUpAnswer) : a.message });
      });
    return () => {
      live = false;
    };
    // `asked` stands for the question, the period and the segment.
  }, [asked]);
  const team = state.points
    .find((p) => p.key === 'leavers')
    ?.sources.find((s) => s.kind === 'group')?.label;
  const example = team === undefined ? 'what grew the headcount?' : `why is ${team} losing people?`;
  const result = answer?.asked === asked ? answer.result : null;
  return (
    <div className="flex flex-col gap-3 touch:hidden">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const q = text.trim();
          onQuestionChange?.(q === '' ? null : q);
        }}
      >
        <Input
          size="sm"
          containerClassName="flex-1"
          aria-label="Ask a follow-up"
          placeholder={`Ask a follow-up, like “${example}”`}
          startAdornment={<icons.assistant aria-hidden className="text-accent-fg" />}
          endAdornment={
            question !== null && result === null ? (
              <Spinner size="sm" label="Working it out" />
            ) : undefined
          }
          value={text}
          maxLength={300}
          enterKeyHint="send"
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        {onExport === undefined ? null : (
          <Button size="sm" startIcon={<icons.download aria-hidden />} onClick={onExport}>
            Export summary
          </Button>
        )}
      </form>
      <div role="status" aria-live="polite">
        {question === null ? null : result === null ? (
          <span className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </span>
        ) : typeof result === 'string' ? (
          <Alert tone="danger" title="No answer">
            {result}
          </Alert>
        ) : result.kind === 'refused' ? (
          <Alert
            tone="info"
            icon={<icons.permission aria-hidden />}
            title="Not something Kithena answers"
          >
            {result.sentences.map((s) => s.map((p) => p.text).join('')).join(' ')}
          </Alert>
        ) : (
          <div className="flex flex-col gap-1.5">
            {result.sentences.map((s, i) => (
              <p key={i} className="text-pretty">
                <Sentence parts={s} />
              </p>
            ))}
            <p className="text-xs text-fg-subtle">
              {result.kind === 'unknown'
                ? 'Answered from this summary’s points only.'
                : result.byModel
                  ? 'Answered by the assistant from these points; every figure is Kithena’s.'
                  : 'Answered by Kithena’s own rules from these points.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Exporting or sharing the summary (AI6, MA5): the format, who it is for and
 * how long; what was rewritten for them and why; and the document itself,
 * every sentence editable. Under a finger it is a bottom sheet with the
 * format, the person, what changed for them and the send.
 */
function ExportDialog({
  state,
  choices,
  onChoicesChange,
  onDraft,
  onDownload,
  onSend,
}: {
  readonly state: WhatChangedState;
  readonly choices: ExportChoices;
  readonly onChoicesChange: (next: ExportChoices | null) => void;
  readonly onDraft: WhatChangedProps['onDraft'];
  readonly onDownload: WhatChangedProps['onDownload'];
  readonly onSend: WhatChangedProps['onSend'];
}): JSX.Element {
  const set = (patch: Partial<ExportChoices>): void => {
    onChoicesChange({ ...choices, ...patch });
  };
  const asked = JSON.stringify([choices.recipient, choices.tone, choices.charts, choices.madeLine]);
  const [draft, setDraft] = useState<{
    readonly asked: string;
    readonly result: SummaryDraft | string;
  } | null>(null);
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState<'download' | 'send' | null>(null);
  const [done, setDone] = useState<{
    readonly tone: 'success' | 'danger';
    readonly text: string;
  } | null>(null);
  const base = {
    tone: choices.tone,
    charts: choices.charts,
    madeLine: choices.madeLine,
    ...(choices.recipient === null ? {} : { recipient: choices.recipient }),
  };
  useEffect(() => {
    if (onDraft === undefined) return undefined;
    let live = true;
    setDone(null);
    void onDraft({ ...base, edits: [] })
      .catch(() => ({ ok: false as const, message: 'People could not be asked' }))
      .then((a) => {
        if (live) setDraft({ asked, result: a.ok ? (a.data as SummaryDraft) : a.message });
      });
    return () => {
      live = false;
    };
    // `asked` stands for every choice the draft depends on.
  }, [asked]);
  const current = draft?.asked === asked ? draft.result : null;
  const doc = current !== null && typeof current !== 'string' ? current.document : null;
  const changed = (doc?.points ?? []).flatMap((p) => {
    const text = edits[p.key];
    return text === undefined || text.trim() === p.text || text.trim() === ''
      ? []
      : [{ key: p.key, text: text.trim() }];
  });
  const recipient = state.recipients.find((r) => r.accountId === choices.recipient) ?? null;
  const to = recipient === null ? null : firstName(recipient.name);
  const nothing = doc !== null && doc.points.length === 0;

  const download = async (): Promise<void> => {
    if (onDownload === undefined) return;
    setBusy('download');
    const outcome = await onDownload({ ...base, edits: changed });
    setBusy(null);
    if (!outcome.ok) setDone({ tone: 'danger', text: outcome.message });
  };
  const send = async (): Promise<void> => {
    if (onSend === undefined || recipient === null) return;
    setBusy('send');
    const sent = await onSend({
      ...base,
      recipient: recipient.accountId,
      format: choices.format,
      edits: changed,
    });
    setBusy(null);
    const emailed = sent.ok && (sent.data as { emailed?: boolean }).emailed === true;
    setDone(
      !sent.ok
        ? { tone: 'danger', text: sent.message }
        : emailed
          ? {
              tone: 'success',
              text: `Sent to ${recipient.name}. They get an email with a link that opens only for them, for seven days.`,
            }
          : {
              tone: 'danger',
              text: `Saved for ${recipient.name}, but the email did not go. Try again in a minute.`,
            },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onChoicesChange(null);
      }}
    >
      <DialogContent className="max-w-[61.25rem]">
        <DialogHeader>
          <DialogTitle>
            <span className="touch:hidden">Export the {state.period.name} summary</span>
            <span className="hidden touch:inline">Share the {state.period.name} summary</span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose the format and who it is for; anything they may not see is left out or
            summarised.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex gap-6 touch:flex-col touch:gap-3">
            <Stack gap={4} className="w-[21.25rem] flex-none touch:w-full">
              <Field>
                <FieldLabel>Format</FieldLabel>
                <SegmentedControl
                  aria-label="Format"
                  fullWidth
                  value={choices.format}
                  onValueChange={(format) => {
                    set({ format: format === 'email' ? 'email' : 'pdf' });
                  }}
                >
                  <SegmentedControlItem value="pdf">
                    <icons.document aria-hidden />
                    PDF
                  </SegmentedControlItem>
                  <SegmentedControlItem value="email">
                    <icons.email aria-hidden />
                    <span className="touch:hidden">Email</span>
                    <span className="hidden touch:inline">Message</span>
                  </SegmentedControlItem>
                </SegmentedControl>
              </Field>
              <Field>
                <FieldLabel>Who it’s for</FieldLabel>
                <FieldControl>
                  <Combobox
                    label="Who it’s for"
                    placeholder="You"
                    disabled={state.recipients.length === 0}
                    options={[
                      { value: ME, label: 'You' },
                      ...state.recipients.map((r) => ({ value: r.accountId, label: r.name })),
                    ]}
                    value={choices.recipient ?? ME}
                    onChange={(value) => {
                      setEdits({});
                      set({
                        recipient: typeof value === 'string' && value !== ME ? value : null,
                      });
                    }}
                  />
                </FieldControl>
                {state.recipients.length === 0 ? (
                  <FieldDescription>For you. HR can send it to somebody else.</FieldDescription>
                ) : null}
              </Field>
              <Field className="touch:hidden">
                <FieldLabel>Tone</FieldLabel>
                <SegmentedControl
                  aria-label="Tone"
                  fullWidth
                  value={choices.tone}
                  onValueChange={(tone) => {
                    set({ tone: tone === 'detailed' ? 'detailed' : 'short' });
                  }}
                >
                  <SegmentedControlItem value="short">Short</SegmentedControlItem>
                  <SegmentedControlItem value="detailed">Detailed</SegmentedControlItem>
                </SegmentedControl>
              </Field>
              {current === null ? (
                <Skeleton className="h-20 w-full rounded-lg" />
              ) : typeof current === 'string' ? (
                <Alert tone="danger" title="Could not prepare it">
                  {current}
                </Alert>
              ) : (
                <Alert
                  tone="info"
                  icon={<icons.permission aria-hidden />}
                  title={
                    to === null ? (
                      'Written for you'
                    ) : (
                      <>
                        <span className="touch:hidden">Written for these readers</span>
                        <span className="hidden touch:inline">Rewritten for {to}</span>
                      </>
                    )
                  }
                >
                  {current.notes.length > 0
                    ? current.notes.join(' ')
                    : recipient === null
                      ? 'Only what you can see yourself.'
                      : `${recipient.name} can see all of it, so nothing was changed.`}
                </Alert>
              )}
              <Field orientation="horizontal" className="justify-start touch:hidden">
                <FieldControl>
                  <Checkbox
                    checked={choices.charts}
                    onCheckedChange={(on) => {
                      set({ charts: on === true });
                    }}
                  />
                </FieldControl>
                <FieldLabel>Include the charts</FieldLabel>
              </Field>
              <Field orientation="horizontal" className="justify-start touch:hidden">
                <FieldControl>
                  <Checkbox
                    checked={choices.madeLine}
                    onCheckedChange={(on) => {
                      set({ madeLine: on === true });
                    }}
                  />
                </FieldControl>
                <FieldLabel>Add a line on how this was made</FieldLabel>
                {doc?.madeLine == null ? null : (
                  <FieldDescription>“{doc.madeLine}”</FieldDescription>
                )}
              </Field>
            </Stack>
            <Preview doc={doc} edits={edits} onEdit={setEdits} />
          </div>
          {done === null ? null : (
            <Alert tone={done.tone} className="mt-4">
              {done.text}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <p className="me-auto text-sm text-fg-muted touch:hidden">
            You can edit any sentence in the preview before sending.
          </p>
          {choices.format === 'pdf' && onDownload !== undefined ? (
            <Button
              variant="secondary"
              startIcon={<icons.download aria-hidden />}
              className="touch:hidden"
              disabled={doc === null || nothing}
              loading={busy === 'download'}
              loadingLabel="Preparing the PDF"
              onClick={() => {
                void download();
              }}
            >
              Download
            </Button>
          ) : null}
          {state.canSend && recipient !== null && to !== null && onSend !== undefined ? (
            <Button
              variant="primary"
              startIcon={<icons.send aria-hidden />}
              className="touch:w-full"
              disabled={doc === null || nothing || done?.tone === 'success'}
              loading={busy === 'send'}
              loadingLabel="Sending"
              onClick={() => {
                void send();
              }}
            >
              Send to {to}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The document as it will read: the company, the title, who prepared it,
 * each point with its figure — every sentence an editable field at a desk —
 * the chart, and the line on how it was made. Under a finger, the start of it.
 */
function Preview({
  doc,
  edits,
  onEdit,
}: {
  readonly doc: SummaryDocument | null;
  readonly edits: Readonly<Record<string, string>>;
  readonly onEdit: (next: Readonly<Record<string, string>>) => void;
}): JSX.Element {
  if (doc === null) {
    return (
      <Card variant="elevated" padded className="min-w-0 flex-1" aria-busy="true">
        <span className="sr-only">Preparing the preview</span>
        <Stack gap={3}>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-3 w-56" />
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-12 w-full" />
          ))}
        </Stack>
      </Card>
    );
  }
  const text = (p: SummaryDocument['points'][number]): string => edits[p.key] ?? p.text;
  return (
    <Card variant="elevated" padded className="min-w-0 flex-1" aria-label="Preview">
      <p className="text-[0.6875rem] font-bold tracking-[0.08em] text-fg-muted uppercase">
        {doc.company === null ? '' : `${doc.company} · `}People report
      </p>
      <h3 className="mt-2 font-display text-2xl leading-tight font-bold touch:text-md">
        {doc.title}
      </h3>
      <p className="mt-1 text-xs text-fg-muted touch:hidden">
        Prepared by {doc.preparedBy} · {doc.preparedOn}
      </p>
      {doc.points.length === 0 ? (
        <p className="mt-3.5 text-fg-muted">Nothing in this summary is theirs to see.</p>
      ) : (
        <>
          <ol className="mt-3.5 flex flex-col gap-3 touch:hidden">
            {doc.points.map((p) => (
              <li key={p.key} className="flex items-start gap-2.5">
                <strong className="min-w-11 pt-2 tabular-nums">{p.figure}</strong>
                <Textarea
                  aria-label={`The sentence for ${p.figure}`}
                  autoResize
                  rows={2}
                  maxLength={600}
                  value={text(p)}
                  onChange={(e) => {
                    onEdit({ ...edits, [p.key]: e.target.value });
                  }}
                />
              </li>
            ))}
          </ol>
          <p className="mt-2 line-clamp-3 hidden text-sm touch:block">
            {doc.points.map(text).join(' ')}
          </p>
        </>
      )}
      {doc.chart === null ? null : (
        <div className="mt-4 touch:hidden">
          <TrendChart
            label="Headcount by month"
            height={70}
            area
            series={[{ label: 'Headcount', data: doc.chart }]}
          />
        </div>
      )}
      {doc.madeLine === null ? null : (
        <p className="mt-3 text-xs text-fg-muted touch:hidden">{doc.madeLine}</p>
      )}
    </Card>
  );
}

/** A summary somebody sent the viewer, as they sent it, and the same on paper. */
function Shared({ shared }: { readonly shared: SharedSummary | null }): JSX.Element {
  const header = <PageHeader title="Insights" description="A summary sent to you" />;
  if (shared === null) {
    return (
      <Stack gap={6}>
        {header}
        <EmptyState
          icon={<icons.analytics />}
          title="This summary is not here"
          description="It was sent to somebody else, or it is more than seven days old."
        />
      </Stack>
    );
  }
  const doc = shared.document;
  return (
    <Stack gap={6}>
      {header}
      <AssistantCard
        level={2}
        title={doc.title}
        action={<Badge tone="assistant">Sent to you</Badge>}
        note={`Prepared by ${doc.preparedBy} on ${doc.preparedOn}, written for what you’re allowed to see. ${doc.madeLine ?? ''}`.trim()}
      >
        <ul aria-label={doc.title}>
          {doc.points.map((p, i) => (
            <li key={p.key}>
              {i === 0 ? null : <Separator />}
              <div className="flex gap-3.5 py-3.5">
                <Badge
                  size="lg"
                  tone="neutral"
                  className="min-w-14 justify-center font-bold tabular-nums"
                >
                  {p.figure}
                </Badge>
                <p className="min-w-0 flex-1 text-pretty">{p.text}</p>
              </div>
            </li>
          ))}
        </ul>
        <Button
          asChild
          variant="secondary"
          startIcon={<icons.download aria-hidden />}
          className="self-start touch:self-stretch"
        >
          <a href={`/people/downloads/summary?shared=${encodeURIComponent(shared.id)}`} download>
            Download PDF
          </a>
        </Button>
      </AssistantCard>
    </Stack>
  );
}
