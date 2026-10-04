import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { effectiveRoles } from '../../domain/access/roles.js';
import type { PlanBudget } from '../../domain/import/new-fields.js';
import {
  answerByRules,
  answeredFrom,
  ASK_INSTRUCTION,
  askContext,
  filled,
  forRecipient,
  leaversByTeam,
  PERIOD_KINDS,
  periodOf,
  PHRASE_INSTRUCTION,
  phraseContext,
  phrasedFrom,
  shortDay,
  shortened,
  shortMonth,
  SPAN_LIMIT,
  summarise,
  titleOf,
  wordsFor,
  type Answer,
  type FilledPoint,
  type Figures,
  type Period,
  type PeriodWords,
  type PointKey,
  type Summary,
} from '../../domain/insights/what-changed.js';
import { Decimal, maySeePay } from '../../domain/pay/pay.js';
import { mayManage } from '../../domain/report/schedule.js';
import { cohortMinimum } from '../analytics/access.js';
import {
  addMonths,
  completeness,
  completenessByDay,
  composition,
  flowsByDepartment,
  headcountTrend,
  movementWaterfall,
  percentComplete,
  spanOfControl,
} from '../analytics/queries.js';
import type { AssistantPort } from '../assistant/assistant-port.js';
import { summaryPdf } from '../export/pdf.js';
import type { ReminderCompany } from '../completeness/reminders.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import type { Accounts } from '../reports/scheduled.js';
import {
  chartScope,
  labeller,
  minusMonths,
  payView,
  type AnalyticsView,
  type ChartScope,
} from './analytics.js';
import type { ScreenDeps, Tx } from './record.js';
import { segmentsFor } from './segments.js';

/**
 * "What changed", the first tab of Insights (design AI5, AI6, MA4, MA5):
 * a period's points, a follow-up question, and the summary exported or sent,
 * rewritten for whoever receives it (`domain/insights/what-changed.ts`).
 *
 * **The figures are the charts' own**, read as `analyticsView` reads them —
 * as this viewer, under the segment in the address, the cohort minimum
 * applied — so a point can say nothing a chart would not show. For somebody
 * else the same figures are read again *as them*, and only the points that
 * come out the same are kept.
 *
 * **The model**, where there is one, words the points and answers a
 * follow-up: it is shown People's sentences with every figure and team held
 * back as a placeholder, and the viewer's question, through the AI gateway in
 * its `aggregates` mode, which refuses any number. Its answer is checked and
 * filled in here. With no model, no budget left this hour, a refusal, a
 * timeout or an answer that fails the check, People's own words stand, and
 * `byModel` says which the viewer is reading.
 *
 * **Sending** is HR's (as scheduled reports are), stores the document as
 * sent, and emails the recipient a link to it through `platform/messaging`:
 * never the summary itself. Only the recipient and the sender open it, for
 * seven days.
 */

export interface Phraser {
  readonly assistant: AssistantPort;
  readonly budget: PlanBudget;
}

/** A summary as it was sent: what the recipient opens. */
export interface SummaryDocument {
  readonly company: string | null;
  /** "What changed in September". */
  readonly title: string;
  readonly preparedBy: string;
  /** "1 Oct 2026". */
  readonly preparedOn: string;
  readonly points: readonly {
    readonly key: PointKey;
    readonly figure: string;
    readonly text: string;
    readonly audience: string | null;
  }[];
  /** Headcount by month, when the charts were asked for. */
  readonly chart: readonly { readonly label: string; readonly value: number }[] | null;
  /** "Written by Kithena from 412 records. Checked by Ada Lovelace." */
  readonly madeLine: string | null;
}

export interface SharedSummary {
  readonly id: string;
  readonly senderAccountId: string;
  readonly recipientAccountId: string;
  readonly format: 'pdf' | 'email';
  readonly document: SummaryDocument;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface SharedSummaryStore {
  insert(tx: Tx, tenantId: string, shared: SharedSummary): Promise<void>;
  get(tx: Tx, tenantId: string, id: string): Promise<SharedSummary | null>;
}

/** The email that says a summary waits: an address, a link, never the summary. */
export interface SummaryMailer {
  send(
    tenantId: string,
    company: ReminderCompany,
    mail: { readonly email: string; readonly url: string; readonly dedupeKey: string },
  ): Promise<void>;
}

export interface SummaryShares {
  readonly store: SharedSummaryStore;
  /** Absent, nothing is sent and Send is not offered. */
  readonly mailer?: SummaryMailer;
  readonly company: (tx: Tx, tenantId: string) => Promise<ReminderCompany | null>;
  readonly accounts: Accounts;
  readonly newId: () => string;
}

export type SummaryDeps = ScreenDeps & {
  readonly phraser?: Phraser;
  readonly shares?: SummaryShares;
};

/** How long a sent summary opens. */
const KEPT_DAYS = 7;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

/** The period and segment in the address. */
export const PeriodAsk = z.strictObject({
  period: z.enum(PERIOD_KINDS).default('month'),
  from: Day.optional(),
  to: Day.optional(),
  segment: z.uuid().optional(),
});
export type PeriodAsk = z.infer<typeof PeriodAsk>;

export const FollowUpAsk = PeriodAsk.extend({ question: z.string().trim().min(1).max(300) });
export type FollowUpAsk = z.infer<typeof FollowUpAsk>;

/** The export dialog's choices: who it is for, how long, and the sentences as edited. */
export const SummaryAsk = PeriodAsk.extend({
  /** An account; absent, it is for the viewer. */
  recipient: z.uuid().optional(),
  tone: z.enum(['short', 'detailed']).default('short'),
  charts: z.boolean().default(true),
  madeLine: z.boolean().default(true),
  edits: z
    .array(
      z.strictObject({
        key: z.enum(['headcount', 'leavers', 'completeness', 'span', 'pay']),
        text: z.string().trim().min(1).max(600),
      }),
    )
    .max(10)
    .default([]),
});
export type SummaryAsk = z.infer<typeof SummaryAsk>;

export const ShareAsk = SummaryAsk.extend({
  recipient: z.uuid(),
  format: z.enum(['pdf', 'email']).default('pdf'),
});
export type ShareAsk = z.infer<typeof ShareAsk>;

export interface WhatChangedView {
  readonly asOf: string;
  readonly period: Period & PeriodWords & { readonly compared: string };
  /** "September in five points". */
  readonly title: string;
  /** When People wrote it, the tenant's time: "08:00". */
  readonly writtenAt: string;
  readonly minimum: number;
  readonly segment: AnalyticsView['segment'];
  readonly segments: AnalyticsView['segments'];
  readonly points: readonly FilledPoint[];
  /** The assistant may word the points: ask `worded`. */
  readonly phrasable: boolean;
  readonly headcount: {
    readonly value: number;
    readonly change: number;
    readonly trend: readonly { readonly label: string; readonly value: number }[];
  } | null;
  readonly leavers: ReturnType<typeof leaversByTeam>;
  /** Whom it may be sent to; empty for anybody who may not send it. */
  readonly recipients: readonly { readonly accountId: string; readonly name: string }[];
  readonly canSend: boolean;
}

const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** "1 Oct 2026". */
const longDay = (day: string): string => `${shortDay(day)} ${day.slice(0, 4)}`;

function periodFor(ask: PeriodAsk, today: string): Result<Period> {
  return periodOf(
    ask.period,
    today,
    ask.from !== undefined && ask.to !== undefined ? { from: ask.from, to: ask.to } : undefined,
  );
}

/**
 * Everything a period's points are drawn from, as this viewer may see it. A
 * figure they may not see is null and its point is not written.
 */
async function figuresOf(
  scope: ChartScope,
  asking: Asking,
  period: Period,
): Promise<Result<Figures>> {
  const { ctx, filters } = scope;
  const under = filters === undefined ? {} : { filters };
  const opening = addDays(period.from, -1);
  const moved = await movementWaterfall(ctx, { from: opening, to: period.to, ...under });
  // The one figure every viewer gets: a segment they may not use stops here.
  if (!moved.ok) return moved;
  const previous = await movementWaterfall(ctx, {
    from: addDays(period.before.from, -1),
    to: period.before.to,
    ...under,
  });
  const flows = await flowsByDepartment(ctx, { from: opening, to: period.to, ...under });
  const made = await composition(ctx, { asOf: period.to, by: ['department'], ...under });
  const minimum = cohortMinimum(ctx.cohortMinimum);
  const department = labeller(scope.definitions, 'org_unit', scope.departments);
  const groups = (pick: 'joiners' | 'leavers') =>
    flows.ok
      ? [...new Set(flows.value.cells.map((c) => c.department))].map((value) => ({
          value,
          label: department(value),
          count: flows.value.cells
            .filter((c) => c.department === value)
            .reduce((n, c) => n + c[pick], 0),
        }))
      : null;

  const days = await completenessByDay(ctx, { from: opening, to: period.to, ...under });
  const counted = days.ok ? days.value.filter((d) => d.complete + d.incomplete > 0) : [];
  const first = counted[0];
  const last = counted.at(-1);
  const missing = (d: (typeof counted)[number]) => 100 - (percentComplete(d) ?? 100);
  let gap: string | null = null;
  if (last !== undefined && ctx.viewer.kind === 'hr' && filters === undefined) {
    const states = await completeness(ctx, { asOf: last.day });
    const bySection = new Map<string, number>();
    for (const f of states.ok ? (states.value.byField ?? []) : []) {
      bySection.set(f.sectionKey, (bySection.get(f.sectionKey) ?? 0) + f.missing);
    }
    const [worst] = [...bySection].filter(([, n]) => n > 0).toSorted((a, b) => b[1] - a[1]);
    gap = worst === undefined ? null : (scope.sections.get(worst[0]) ?? worst[0]);
  }

  let span: Figures['span'] = null;
  if (filters === undefined) {
    const over = async (asOf: string) => {
      const spans = await spanOfControl(ctx, { asOf });
      return spans.ok
        ? spans.value.spans
            .filter((s) => s.reports > SPAN_LIMIT)
            .reduce((n, s) => n + s.managers, 0)
        : null;
    };
    const now = await over(period.to);
    if (now !== null) span = { over: now, before: await over(opening), limit: SPAN_LIMIT };
  }

  let pay: Figures['pay'] = null;
  if (filters === undefined && maySeePay(asking.viewer.roles)) {
    const view = await payView(ctx, asking, scope.definitions);
    if (view !== null) {
      // Minor units as decimals, never floats: a median may sit between two cents.
      const banded = view.grade.flatMap((g) =>
        g.status === 'ok' && g.median !== null && g.band !== null
          ? [{ median: new Decimal(g.median), band: g.band }]
          : [],
      );
      pay = {
        above: banded.filter((g) => g.median.gt(g.band.maximumMinor)).length,
        below: banded.filter((g) => g.median.lt(g.band.minimumMinor)).length,
      };
    }
  }

  return ok({
    minimum,
    movement: {
      opening: moved.value.opening,
      closing: moved.value.closing,
      joiners: moved.value.joiners,
      leavers: moved.value.leavers,
    },
    previous: previous.ok
      ? { joiners: previous.value.joiners, leavers: previous.value.leavers }
      : null,
    joinersBy: groups('joiners'),
    leaversBy: groups('leavers'),
    named:
      made.ok && made.value.status === 'ok'
        ? made.value.cells.filter((c) => c.count >= minimum).map((c) => c.keys[0] ?? null)
        : [],
    complete:
      first !== undefined && last !== undefined && first.day !== last.day
        ? { before: missing(first), after: missing(last) }
        : null,
    gap,
    span,
    pay,
  });
}

/** As somebody else: their roles as the rows hold them, and their scope. Null: no Insights. */
async function scopeAs(
  deps: SummaryDeps,
  accounts: Accounts,
  tx: Tx,
  asking: Asking,
  accountId: string,
  segmentId: string | undefined,
): Promise<{ readonly scope: ChartScope; readonly asking: Asking } | null> {
  const holdings = await accounts.holdings(tx, asking.tenantId);
  const as: Asking = {
    tenantId: asking.tenantId,
    viewer: { accountId, roles: effectiveRoles(holdings.get(accountId) ?? []) },
    correlationId: asking.correlationId,
  };
  const scope = await chartScope(deps, tx, as, segmentId);
  return scope.ok ? { scope: scope.value, asking: as } : null;
}

const timeIn = (instant: string, zone: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: zone,
  }).format(new Date(instant));

/** The tab: the period's points in People's words, the two charts beside them. */
export async function whatChangedView(
  deps: SummaryDeps,
  asking: Asking,
  ask: PeriodAsk,
): Promise<Result<WhatChangedView>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const scoped = await chartScope(deps, tx, asking, ask.segment);
    if (!scoped.ok) return scoped;
    const scope = scoped.value;
    const period = periodFor(ask, scope.today);
    if (!period.ok) return period;
    const figures = await figuresOf(scope, asking, period.value);
    if (!figures.ok) return figures;
    const summary = summarise(figures.value, period.value);
    const words = wordsFor(period.value);
    const { ctx, filters } = scope;
    const under = filters === undefined ? {} : { filters };

    const trend = await headcountTrend(ctx, {
      from: minusMonths(period.value.to, 6),
      to: period.value.to,
      ...under,
    });
    const months = [-2, -1, 0].map((n) => addMonths(period.value.to.slice(0, 7), n));
    const flows = await flowsByDepartment(ctx, {
      from: addDays(`${months[0] ?? ''}-01`, -1),
      to: period.value.to,
      ...under,
    });
    const department = labeller(scope.definitions, 'org_unit', scope.departments);
    const m = figures.value.movement;

    const shares = deps.shares;
    const canSend =
      shares?.mailer !== undefined &&
      mayManage(asking.viewer.roles) &&
      (await shares.company(tx, asking.tenantId)) !== null;
    const recipients = canSend
      ? (await shares.accounts.candidates(tx, asking.tenantId)).flatMap((c) =>
          c.accountId === asking.viewer.accountId || c.workEmail === null
            ? []
            : [{ accountId: c.accountId, name: c.name ?? c.workEmail }],
        )
      : [];
    const calendar = await deps.calendars.load(tx, asking.tenantId);

    return ok({
      asOf: scope.today,
      period: {
        ...period.value,
        ...words,
        compared: `${words.title} compared with ${words.against}`,
      },
      title: titleOf(summary, period.value),
      writtenAt: timeIn(deps.clock.instant(), calendar.defaultZone),
      minimum: figures.value.minimum,
      segment: scope.segment,
      segments: (await segmentsFor(deps, tx, asking))
        .filter((s) => s.usableIn.analytics)
        .map((s) => ({ id: s.id, name: s.name })),
      points: filled(summary),
      phrasable: deps.phraser !== undefined && summary.points.length > 0,
      headcount:
        m === null
          ? null
          : {
              value: m.closing,
              change: m.closing - m.opening,
              trend: trend.ok
                ? trend.value.points.map((p) => ({
                    label: shortMonth(p.month),
                    value: p.headcount,
                  }))
                : [],
            },
      leavers: flows.ok
        ? leaversByTeam(
            flows.value.cells.map((c) => ({
              month: c.month,
              value: c.department,
              label: department(c.department),
              count: c.leavers,
            })),
            figures.value.named,
            months,
          )
        : null,
      recipients: recipients.toSorted((a, b) => a.name.localeCompare(b.name)),
      canSend,
    });
  });
}

/** This viewer's summary of a period, and nothing else: what the model calls start from. */
async function summaryOf(
  deps: SummaryDeps,
  asking: Asking,
  ask: PeriodAsk,
): Promise<Result<{ readonly summary: Summary; readonly period: Period }>> {
  return run(deps.service, asking.tenantId, async (tx) => {
    const scoped = await chartScope(deps, tx, asking, ask.segment);
    if (!scoped.ok) return scoped;
    const period = periodFor(ask, scoped.value.today);
    if (!period.ok) return period;
    const figures = await figuresOf(scoped.value, asking, period.value);
    return figures.ok
      ? ok({ summary: summarise(figures.value, period.value), period: period.value })
      : figures;
  });
}

/** One call to the model, or null: no model, no budget, a refusal, no answer in time, not JSON. */
async function askModel(
  deps: SummaryDeps,
  asking: Asking,
  instruction: string,
  context: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const phraser = deps.phraser;
  if (phraser === undefined) return null;
  if (!phraser.budget.take(asking.tenantId, deps.clock.instant()).ok) return null;
  const loaded = await run(deps.service, asking.tenantId, async (tx) => {
    await phraser.assistant.loadPolicies(tx, asking.tenantId);
    return ok(null);
  });
  if (!loaded.ok) return null;
  try {
    const answered = await phraser.assistant.complete(asking.tenantId, {
      instruction,
      context,
      about: 'aggregates',
    });
    return answered.ok ? (JSON.parse(answered.value) as unknown) : null;
  } catch {
    return null;
  }
}

/** The points in the assistant's words where there is one; People's otherwise. */
export async function wordedPoints(
  deps: SummaryDeps,
  asking: Asking,
  request: PeriodAsk,
): Promise<Result<{ readonly points: readonly FilledPoint[]; readonly byModel: boolean }>> {
  const asked = await summaryOf(deps, asking, request);
  if (!asked.ok) return asked;
  const { summary, period } = asked.value;
  const ours = { points: filled(summary), byModel: false };
  if (summary.points.length === 0) return ok(ours);
  const answer = await askModel(deps, asking, PHRASE_INSTRUCTION, phraseContext(summary, period));
  const phrased = answer === null ? null : phrasedFrom(summary, answer);
  return ok(phrased === null ? ours : { points: filled(phrased), byModel: true });
}

/** A follow-up question, answered from the points and nothing else. */
export async function followUp(
  deps: SummaryDeps,
  asking: Asking,
  request: FollowUpAsk,
): Promise<Result<Answer & { readonly byModel: boolean }>> {
  const asked = await summaryOf(deps, asking, request);
  if (!asked.ok) return asked;
  const { summary } = asked.value;
  const rules = answerByRules(summary, request.question);
  // What the rules refuse is never put to a model.
  if (rules.kind === 'refused' || summary.points.length === 0) {
    return ok({ ...rules, byModel: false });
  }
  const answer = await askModel(
    deps,
    asking,
    ASK_INSTRUCTION,
    askContext(summary, request.question),
  );
  const read = answer === null ? null : answeredFrom(summary, request.question, answer);
  return ok(read === null ? { ...rules, byModel: false } : { ...read, byModel: true });
}

export interface SummaryDraft {
  readonly recipient: { readonly accountId: string; readonly name: string } | null;
  /** Why each point the recipient does not get was left out, and what was kept. */
  readonly notes: readonly string[];
  readonly document: SummaryDocument;
}

/**
 * The summary as it would go to `recipient` (or to the viewer): their points,
 * the sender's edits laid over the points that are kept, the charts and the
 * line on how it was made when asked for. Writes nothing.
 */
async function draft(
  deps: SummaryDeps,
  tx: Tx,
  asking: Asking,
  request: SummaryAsk,
): Promise<Result<SummaryDraft>> {
  const scoped = await chartScope(deps, tx, asking, request.segment);
  if (!scoped.ok) return scoped;
  const scope = scoped.value;
  const period = periodFor(request, scope.today);
  if (!period.ok) return period;
  const mine = await figuresOf(scope, asking, period.value);
  if (!mine.ok) return mine;

  const shares = deps.shares;
  const people = shares === undefined ? [] : await shares.accounts.candidates(tx, asking.tenantId);
  const nameOf = (accountId: string) => {
    const c = people.find((p) => p.accountId === accountId);
    return c?.name ?? c?.workEmail ?? null;
  };

  let recipient: SummaryDraft['recipient'] = null;
  let notes: readonly string[] = [];
  let summary: Summary;
  let theirs: { scope: ChartScope; asking: Asking } | null = { scope, asking };
  if (request.recipient === undefined || request.recipient === asking.viewer.accountId) {
    summary = summarise(mine.value, period.value);
  } else {
    // Choosing who it is for lists the company's people: HR's, as the picker is.
    if (shares === undefined || !mayManage(asking.viewer.roles)) {
      return err(failure('FORBIDDEN', 'Only HR prepares a summary for somebody else'));
    }
    const name = nameOf(request.recipient);
    if (name === null) {
      return err(failure('NOT_FOUND', 'There is nobody with that account here', ['recipient']));
    }
    recipient = { accountId: request.recipient, name };
    theirs = await scopeAs(deps, shares.accounts, tx, asking, request.recipient, request.segment);
    const figures =
      theirs === null ? null : await figuresOf(theirs.scope, theirs.asking, period.value);
    const rewritten = forRecipient(
      mine.value,
      figures?.ok === true ? figures.value : null,
      period.value,
      name,
    );
    summary = rewritten.summary;
    notes = rewritten.notes;
  }

  const shown = filled(shortened(summary, request.tone));
  const edits = new Map(request.edits.map((e) => [e.key, e.text]));
  let chart: SummaryDocument['chart'] = null;
  if (request.charts && theirs !== null && shown.length > 0) {
    const trend = await headcountTrend(theirs.scope.ctx, {
      from: minusMonths(period.value.to, 6),
      to: period.value.to,
      ...(theirs.scope.filters === undefined ? {} : { filters: theirs.scope.filters }),
    });
    chart = trend.ok
      ? trend.value.points.map((p) => ({ label: shortMonth(p.month), value: p.headcount }))
      : null;
  }
  const preparedBy = nameOf(asking.viewer.accountId) ?? 'you';
  const records = mine.value.movement?.closing ?? null;
  const company = shares === undefined ? null : await shares.company(tx, asking.tenantId);
  return ok({
    recipient,
    notes,
    document: {
      company: company?.name ?? null,
      title: `What changed ${wordsFor(period.value).inWords}`,
      preparedBy,
      preparedOn: longDay(scope.today),
      points: shown.map((p) => ({
        key: p.key,
        figure: p.figure,
        text: edits.get(p.key) ?? p.text,
        audience: p.audience,
      })),
      chart: chart !== null && chart.length > 1 ? chart : null,
      madeLine:
        request.madeLine && records !== null
          ? `Written by Kithena from ${records.toLocaleString('en-GB')} records. Checked by ${preparedBy}.`
          : null,
    },
  });
}

/** The export dialog's preview. */
export async function summaryDraft(
  deps: SummaryDeps,
  asking: Asking,
  request: SummaryAsk,
): Promise<Result<SummaryDraft>> {
  return run(deps.service, asking.tenantId, (tx) => draft(deps, tx, asking, request));
}

/**
 * Send it, step one: HR's, to somebody who signs in here with a work email,
 * and only with something in it — stored as it will be opened. The email is
 * step two, `announceSummary`, after this has committed: a summary that was
 * rolled back is never announced.
 */
export async function storeSummary(
  deps: SummaryDeps,
  asking: Asking,
  request: ShareAsk,
): Promise<Result<{ readonly id: string }>> {
  const shares = deps.shares;
  if (shares?.mailer === undefined) {
    return err(failure('UNAVAILABLE', 'Sending a summary is not configured'));
  }
  if (!mayManage(asking.viewer.roles)) {
    return err(failure('FORBIDDEN', 'Only HR sends a summary to somebody else'));
  }
  return run(deps.service, asking.tenantId, async (tx) => {
    if ((await shares.company(tx, asking.tenantId)) === null) {
      return err(failure('UNAVAILABLE', 'The company has no address yet'));
    }
    const prepared = await draft(deps, tx, asking, request);
    if (!prepared.ok) return prepared;
    if (prepared.value.document.points.length === 0) {
      return err(failure('NOTHING_TO_SEND', prepared.value.notes.join(' ') || 'Nothing to send'));
    }
    const email = (await shares.accounts.candidates(tx, asking.tenantId)).find(
      (c) => c.accountId === request.recipient,
    )?.workEmail;
    if (email == null) {
      return err(failure('NO_EMAIL', 'They have no work email to send it to', ['recipient']));
    }
    const at = deps.clock.instant();
    const id = shares.newId();
    await shares.store.insert(tx, asking.tenantId, {
      id,
      senderAccountId: asking.viewer.accountId,
      recipientAccountId: request.recipient,
      format: request.format,
      document: prepared.value.document,
      createdAt: at,
      expiresAt: new Date(Date.parse(at) + KEPT_DAYS * 86_400_000).toISOString(),
    });
    return ok({ id });
  });
}

/**
 * Send it, step two: the email saying a summary waits, with a link to it on
 * the company's own origin. Keyed by the summary, so a retried send is one
 * email. False when it could not be sent; the summary still waits.
 */
export async function announceSummary(
  deps: SummaryDeps,
  asking: Asking,
  id: string,
): Promise<boolean> {
  const shares = deps.shares;
  const mailer = shares?.mailer;
  if (shares === undefined || mailer === undefined) return false;
  const found = await run(deps.service, asking.tenantId, async (tx) => {
    const shared = await shares.store.get(tx, asking.tenantId, id);
    const company = await shares.company(tx, asking.tenantId);
    const email = (await shares.accounts.candidates(tx, asking.tenantId)).find(
      (c) => c.accountId === shared?.recipientAccountId,
    )?.workEmail;
    return shared === null || shared.senderAccountId !== asking.viewer.accountId
      ? err(failure('NOT_FOUND', 'No such summary'))
      : company === null || email == null
        ? err(failure('UNAVAILABLE', 'Nowhere to send it'))
        : ok({ company, email });
  });
  if (!found.ok) return false;
  const url = new URL('/people/insights/what-changed', found.value.company.origin);
  url.searchParams.set('shared', id);
  try {
    await mailer.send(asking.tenantId, found.value.company, {
      email: found.value.email,
      url: url.toString(),
      dedupeKey: `summary/${id}`,
    });
    return true;
  } catch {
    return false;
  }
}

/** A sent summary, to its recipient or its sender, while it lasts. */
export async function sharedSummary(
  deps: SummaryDeps,
  asking: Asking,
  id: string,
): Promise<Result<SharedSummary>> {
  const shares = deps.shares;
  if (shares === undefined) {
    return err(failure('UNAVAILABLE', 'Shared summaries are not configured'));
  }
  return run(deps.service, asking.tenantId, async (tx) => {
    const found = await shares.store.get(tx, asking.tenantId, id);
    const mine =
      found !== null &&
      (found.recipientAccountId === asking.viewer.accountId ||
        found.senderAccountId === asking.viewer.accountId) &&
      found.expiresAt > deps.clock.instant();
    return mine
      ? ok(found)
      : err(failure('NOT_FOUND', 'This summary is gone, or was not sent to you'));
  });
}

export interface SummaryFile {
  readonly bytes: Uint8Array;
  readonly filename: string;
}

const fileName = (title: string): string =>
  `${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')}.pdf`;

const paper = async (deps: SummaryDeps, d: SummaryDocument): Promise<SummaryFile> => ({
  bytes: await summaryPdf({ ...d, generatedAt: deps.clock.instant() }),
  filename: fileName(d.title),
});

/** The export dialog's Download: the preview, as edited, on paper. */
export async function summaryFile(
  deps: SummaryDeps,
  asking: Asking,
  request: SummaryAsk,
): Promise<Result<SummaryFile>> {
  const prepared = await summaryDraft(deps, asking, request);
  if (!prepared.ok) return prepared;
  if (prepared.value.document.points.length === 0) {
    return err(failure('NOTHING_TO_SEND', 'There is nothing in this summary to download'));
  }
  return ok(await paper(deps, prepared.value.document));
}

/** A sent summary on paper, for its recipient. */
export async function sharedSummaryFile(
  deps: SummaryDeps,
  asking: Asking,
  id: string,
): Promise<Result<SummaryFile>> {
  const found = await sharedSummary(deps, asking, id);
  return found.ok ? ok(await paper(deps, found.value.document)) : found;
}
