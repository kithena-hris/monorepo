import { createHash } from 'node:crypto';
import * as z from 'zod';
import { FormDefinition } from '@kithena/contracts';
import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';
import { plainText, validateDefinition } from '@kithena/form-kit';

import { counts, position, sentences, type Labelled } from '../domain/sentiment.js';
import { current } from '../domain/template.js';
import { isSubmitted, standing } from '../domain/review.js';
import { audit, forbidden, hrOnly, names, notFound, type Ctx } from './context.js';
import { metric, COHORT } from './analytics.js';
import { formOf } from './forms.js';
import { load } from './reviews.js';
import { aiOn, settingsOf, type AiFeature } from './settings.js';

/**
 * Performance's AI (PRD §22, PRF-131 to PRF-146), through one door: the
 * feature must be switched on and a model configured; confidential writers
 * are renamed and private questions left out before the model reads
 * anything written about the subject; the answer is checked against the
 * feature's schema; and every output is logged with the model, the prompt's
 * version and a hash of what it read. A number is only ever a suggestion
 * with a reason, marked until a person confirms it; the score is computed.
 */

const sha = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const aiOff = (): DomainFailure =>
  failure('AI_OFF', 'This AI feature is off, or no model is configured');

async function ask<T>(
  ctx: Ctx,
  feature: AiFeature,
  spec: { version: string; instruction: string; answer: z.ZodType<T> },
  context: Record<string, unknown>,
  log: { forPerson?: string | null; on: string },
): Promise<Result<{ answer: T; logId: string }>> {
  const model = ctx.deps.model;
  if (model === undefined || !(await aiOn(ctx, feature))) return err(aiOff());
  const raw = await model.complete(ctx.caller.tenantId, { instruction: spec.instruction, context });
  let parsed: unknown = null;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const answer = spec.answer.safeParse(parsed);
  if (!answer.success)
    return err(failure('AI_UNAVAILABLE', 'The assistant could not answer just now'));
  const id = ctx.deps.newId();
  await ctx.tx.aiLog.save({
    id,
    feature,
    forPerson: log.forPerson ?? ctx.viewer.personId,
    on: log.on,
    model: model.name,
    promptVersion: `${feature}-${spec.version}`,
    inputHash: sha(context),
    output: answer.data,
    outcome: 'Shown',
    at: ctx.at,
  });
  await audit(ctx, { kind: 'ai_output', action: `Used AI: ${feature}`, target: log.on, targetId: id });
  return ok({ answer: answer.data, logId: id });
}

/* ------------------------------------------------------------- builder -- */

export async function writeTemplate(
  ctx: Ctx,
  description: string,
): Promise<Result<{ definition: FormDefinition; logId: string }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const got = await ask(
    ctx,
    'builder',
    {
      version: '1',
      instruction:
        'You design review forms. Return JSON {"title","sections":[{"id","title","questions":[{"id","type","prompt","help"?,"required"?,"options"?}]}]}. ' +
        'Types: text, scale (options [{label,value}] 1..5 rising), binary, choice (options [{id,label}]), number, performance_score (alone in a last section). ' +
        'ids are lower-case words. Follow the description; keep it short.',
      answer: FormDefinition,
    },
    { description },
    { on: 'A new template' },
  );
  if (!got.ok) return got;
  const valid = validateDefinition(got.value.answer);
  // Invalid output is refused, never patched (§11.9).
  if (!valid.ok)
    return err(failure('AI_INVALID', `The draft was not a valid form: ${valid.error.message}`));
  return ok({ definition: got.value.answer, logId: got.value.logId });
}

const Issue = z.object({
  questionId: z.string(),
  level: z.enum(['warning', 'info', 'danger']),
  title: z.string().max(200),
  detail: z.string().max(400),
  rewrite: z.string().max(500).nullable().optional(),
});

export async function checkTemplate(ctx: Ctx, templateId: string): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const t = await ctx.tx.templates.get(templateId);
  const v = t === null ? undefined : current(t);
  if (v === undefined) return err(notFound('template'));
  const got = await ask(
    ctx,
    'builder',
    {
      version: '1',
      instruction:
        'Check a review form for double-barrelled questions, leading wording, scales without anchors, and too many required text questions. ' +
        'Return JSON {"issues":[{"questionId","level":"warning"|"info"|"danger","title","detail","rewrite"}]}; rewrite is a better prompt or null.',
      answer: z.object({ issues: z.array(Issue).max(20) }),
    },
    { form: v.definition },
    { on: t?.name ?? 'A template' },
  );
  if (!got.ok) return got;
  const ids = new Set(v.definition.sections.flatMap((s) => s.questions.map((q) => q.id)));
  return ok({
    issues: got.value.answer.issues.filter((i) => ids.has(i.questionId)),
    logId: got.value.logId,
  });
}

export async function translateTemplate(
  ctx: Ctx,
  templateId: string,
  language: string,
): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const t = await ctx.tx.templates.get(templateId);
  const v = t === null ? undefined : current(t);
  if (v === undefined) return err(notFound('template'));
  const got = await ask(
    ctx,
    'builder',
    {
      version: '1',
      instruction: `Translate every title, prompt, help text and option label of this form into ${language}. Keep every id, type and value. Return the form as JSON.`,
      answer: FormDefinition,
    },
    { form: v.definition },
    { on: `${t?.name ?? ''} → ${language}` },
  );
  if (!got.ok) return got;
  // The translation is a draft a person reads before publishing; ids never move.
  const before = v.definition.sections.flatMap((s) => s.questions.map((q) => q.id)).join();
  const after = got.value.answer.sections.flatMap((s) => s.questions.map((q) => q.id)).join();
  if (before !== after)
    return err(failure('AI_INVALID', 'The translation changed the questions; nothing was kept'));
  return ok({ definition: got.value.answer, logId: got.value.logId });
}

/* ------------------------------------------------------------- writing -- */

/** What the model may read for a review's writer (§22.4): masked, cited by id. */
async function evidence(ctx: Ctx, reviewId: string) {
  const loaded = await load(ctx, reviewId);
  if (!loaded.ok) return loaded;
  const r = loaded.value.review;
  if (r.authorId !== ctx.viewer.personId)
    return err(forbidden('Only the writer asks for help with a review'));
  const name = await names(ctx);
  const sources: { id: string; label: string; text: string }[] = [];
  const peers = new Map<string, string>();
  if (r.cycleId !== null)
    for (const x of await ctx.tx.reviews.find({ cycleId: r.cycleId, subjectId: r.subjectId })) {
      if (x.id === r.id || !isSubmitted(x) || x.detached !== null) continue;
      if (r.kind !== 'manager' && !(x.kind === 'self' && r.authorId === r.subjectId)) continue;
      const form = await formOf(ctx, x);
      if (form === null) continue;
      const who =
        x.confidential || x.kind === 'peer' || x.kind === 'upward'
          ? (peers.get(x.authorId) ??
            `${x.kind === 'upward' ? 'Report' : 'Peer'} ${String(peers.size + 1)}`)
          : name(x.authorId);
      peers.set(x.authorId, who);
      const a = standing(x);
      const text = form.sections
        .flatMap((s) => s.questions)
        .map((q) => {
          const v = a[q.id]?.value;
          if (v === undefined || v === null) return null;
          const shown =
            q.type === 'scale'
              ? (q.options.find((o) => o.value === v)?.label ?? String(v))
              : typeof v === 'string'
                ? plainText(v)
                : Array.isArray(v)
                  ? v.join(', ')
                  : String(v);
          return `${q.prompt}: ${shown}`;
        })
        .filter((l): l is string => l !== null)
        .join('\n');
      sources.push({
        id: `r${String(sources.length + 1)}`,
        label: `${who}, ${x.kind} review`,
        text,
      });
    }
  for (const f of (await ctx.tx.feedback.find({ subjectId: r.subjectId }))
    .filter((f) => !f.undone && f.audience !== 'recipient')
    .slice(0, 20))
    sources.push({
      id: `f${String(sources.length + 1)}`,
      label: `Feedback ${f.at.slice(0, 10)}`,
      text: plainText(f.body),
    });
  for (const g of await ctx.tx.goals.find({ ownerId: r.subjectId }))
    sources.push({
      id: `g${String(sources.length + 1)}`,
      label: `Goal: ${g.title}`,
      text: `${g.title}; check-ins: ${g.checkIns.map((c) => `${c.confidence}${c.note === null ? '' : ` (${c.note})`}`).join('; ')}`,
    });
  return ok({
    review: r,
    sources,
    subject: r.subjectId === ctx.viewer.personId ? 'you' : 'the person',
  });
}

const Cited = z.object({ text: z.string().max(600), cites: z.array(z.string()).max(8) });

/** §13.2: a summary where every sentence cites its sources; a sentence citing nothing real is dropped. */
export async function summarise(ctx: Ctx, reviewId: string): Promise<Result<unknown>> {
  const ev = await evidence(ctx, reviewId);
  if (!ev.ok) return ev;
  const got = await ask(
    ctx,
    'summaries',
    {
      version: '1',
      instruction:
        'Summarise what others said about the person, in 2–5 sentences. Cite the ids of the sources each sentence rests on. Return JSON {"sentences":[{"text","cites":[ids]}]}.',
      answer: z.object({ sentences: z.array(Cited).max(8) }),
    },
    { sources: ev.value.sources },
    { forPerson: ev.value.review.subjectId, on: 'Review summary' },
  );
  if (!got.ok) return got;
  const known = new Map(ev.value.sources.map((s) => [s.id, s.label]));
  const kept = got.value.answer.sentences.filter(
    (s) => s.cites.length > 0 && s.cites.every((c) => known.has(c)),
  );
  return ok({
    sentences: kept,
    dropped: got.value.answer.sentences.length - kept.length,
    sources: ev.value.sources.map((s) => ({ id: s.id, label: s.label })),
    logId: got.value.logId,
  });
}

const Labels = z.object({
  labels: z
    .array(
      z.object({
        sentence: z.string(),
        label: z.union([z.literal(-2), z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]),
      }),
    )
    .max(200),
});

/** §13.6: the model labels sentences; the domain computes where the slider sits. */
export async function sentiment(ctx: Ctx, text: string, on: string): Promise<Result<unknown>> {
  const list = sentences(plainText(text)).slice(0, 120);
  if (list.length === 0) return ok({ position: null, counts: counts([]), labels: [] });
  const got = await ask(
    ctx,
    'sentiment',
    {
      version: '1',
      instruction:
        'Label each sentence from -2 (very negative) to 2 (very positive), about the work, not the person. Return JSON {"labels":[{"sentence","label"}]} with the sentences exactly as given.',
      answer: Labels,
    },
    { sentences: list },
    { on },
  );
  if (!got.ok) return got;
  const labels = got.value.answer.labels.filter((l) => list.includes(l.sentence)) as Labelled[];
  return ok({ position: position(labels), counts: counts(labels), labels, logId: got.value.logId });
}

const Prefill = z.object({
  text: z
    .array(
      z.object({
        questionId: z.string(),
        text: z.string().max(4000),
        cites: z.array(z.string()).max(8),
      }),
    )
    .max(40),
  values: z
    .array(
      z.object({
        questionId: z.string(),
        value: z.union([z.number(), z.boolean(), z.array(z.string())]),
        reason: z.string().max(300),
      }),
    )
    .max(60),
});

/**
 * §13.4: the whole review drafted from the evidence. Text answers that are
 * empty are filled and marked; numbers are suggestions with a reason, kept
 * beside the answers until the writer confirms or changes each.
 */
export async function prefill(ctx: Ctx, reviewId: string): Promise<Result<unknown>> {
  const ev = await evidence(ctx, reviewId);
  if (!ev.ok) return ev;
  const r = ev.value.review;
  const form = await formOf(ctx, r);
  if (form === null) return err(notFound('form'));
  const questions = form.sections
    .flatMap((s) => s.questions)
    .filter((q) => q.type !== 'performance_score');
  const got = await ask(
    ctx,
    'prefill',
    {
      version: '1',
      instruction:
        'Draft answers to this review form from the sources only. For text questions write 1–3 sentences citing source ids. ' +
        'For scale, goals, choice, binary and number questions suggest a value with a one-line reason. ' +
        'Return JSON {"text":[{"questionId","text","cites"}],"values":[{"questionId","value","reason"}]}.',
      answer: Prefill,
    },
    {
      form: {
        sections: form.sections.map((s) => ({
          title: s.title,
          questions: s.questions.filter((q) => q.type !== 'performance_score'),
        })),
      },
      sources: ev.value.sources,
      about: ev.value.subject,
    },
    { forPerson: r.subjectId, on: 'Prefill' },
  );
  if (!got.ok) return got;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const known = new Set(ev.value.sources.map((s) => s.id));
  const answers = { ...r.answers };
  const drafted = new Set(r.drafted);
  for (const t of got.value.answer.text) {
    const q = byId.get(t.questionId);
    if (
      q?.type !== 'text' ||
      (answers[q.id]?.value ?? '') !== '' ||
      !t.cites.every((c) => known.has(c))
    )
      continue;
    answers[q.id] = { value: `<p>${t.text.replaceAll('<', '&lt;')}</p>`, comment: null };
    drafted.add(q.id);
  }
  const suggestions = { ...r.suggestions };
  for (const v of got.value.answer.values) {
    const q = byId.get(v.questionId);
    if (q === undefined || answers[q.id] !== undefined) continue;
    const fits =
      (q.type === 'scale' &&
        typeof v.value === 'number' &&
        q.options.some((o) => o.value === v.value)) ||
      (q.type === 'goals' && typeof v.value === 'number') ||
      (q.type === 'binary' && typeof v.value === 'boolean') ||
      (q.type === 'number' && typeof v.value === 'number') ||
      (q.type === 'choice' &&
        Array.isArray(v.value) &&
        v.value.every((id) => q.options.some((o) => o.id === id)));
    if (fits) suggestions[q.id] = { value: v.value, reason: v.reason, confirmed: false };
  }
  await ctx.tx.reviews.save({
    ...r,
    answers,
    drafted: [...drafted],
    suggestions,
    revision: r.revision + 1,
    savedAt: ctx.at,
    status: r.status === 'not_started' ? 'in_progress' : r.status,
  });
  return ok({
    drafted: [...drafted],
    suggestions: Object.keys(suggestions).length,
    logId: got.value.logId,
  });
}

const Flag = z.object({
  sentence: z.string().max(600),
  level: z.enum(['danger', 'warning', 'info']),
  title: z.string().max(200),
  suggestion: z.string().max(600).nullable(),
});

/** §13.7: how it will read to its receiver, and the checks a writer can use or ignore. */
export async function howItReads(ctx: Ctx, reviewId: string): Promise<Result<unknown>> {
  const ev = await evidence(ctx, reviewId);
  if (!ev.ok) return ev;
  const text = Object.values(ev.value.review.answers)
    .map((a) => (typeof a.value === 'string' ? plainText(a.value) : ''))
    .filter((t) => t !== '')
    .join('\n');
  const got = await ask(
    ctx,
    'writingChecks',
    {
      version: '1',
      instruction:
        'Read this draft review as its receiver would. Return JSON {"reads":"a short paragraph","flags":[{"sentence","level","title","suggestion"}]}. ' +
        'Flag wording about personality rather than behaviour, gendered or age-coded words, claims with no example, and vague praise.',
      answer: z.object({ reads: z.string().max(1200), flags: z.array(Flag).max(20) }),
    },
    { draft: text },
    { forPerson: ev.value.review.subjectId, on: 'How it reads' },
  );
  if (!got.ok) return got;
  return ok({ ...got.value.answer, logId: got.value.logId });
}

/** §12.5: tone check on feedback, advisory only. */
export async function toneCheck(ctx: Ctx, text: string): Promise<Result<unknown>> {
  const got = await ask(
    ctx,
    'toneCheck',
    {
      version: '1',
      instruction:
        'Check this feedback for sentences that read as personal, vague or harsh. Return JSON {"verdict":"one short sentence","flags":[{"sentence","level","title","suggestion"}]}.',
      answer: z.object({ verdict: z.string().max(300), flags: z.array(Flag).max(20) }),
    },
    { feedback: plainText(text) },
    { on: 'Feedback tone' },
  );
  if (!got.ok) return got;
  return ok({ ...got.value.answer, logId: got.value.logId });
}

/* --------------------------------------------------------- setup in words -- */

const Condition = z.object({
  field: z.enum(['department', 'status', 'startedBefore', 'manager', 'title', 'legalEntity']),
  value: z.string().max(120),
});

/** §8.2: participants changed in words, returned as a diff HR applies. */
export async function participantsInWords(
  ctx: Ctx,
  cycleId: string,
  text: string,
): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(cycleId);
  if (c === null) return err(notFound('cycle'));
  const departments = [...new Set((await ctx.tx.orgUnits.find()).map((u) => u.name))];
  const got = await ask(
    ctx,
    'setupByChat',
    {
      version: '1',
      instruction:
        'Change a participant filter as asked. Fields: department, status, startedBefore (YYYY-MM-DD), title. Return JSON {"filter":[{"field","value"}],"summary":["one line per change"]}.',
      answer: z.object({
        filter: z.array(Condition).max(20),
        summary: z.array(z.string().max(200)).max(10),
      }),
    },
    { request: text, current: c.participants.filter, departments },
    { on: c.name },
  );
  if (!got.ok) return got;
  return ok({
    filter: got.value.answer.filter,
    summary: got.value.answer.summary,
    logId: got.value.logId,
  });
}

const AutomationDraft = z.object({
  name: z.string().max(120),
  trigger: z.union([
    z.object({
      kind: z.literal('calendar'),
      every: z.enum(['quarter', 'half', 'year']),
      startMonth: z.int().min(1).max(12),
      leadDays: z.int().min(0).max(90),
    }),
    z.object({
      kind: z.literal('event'),
      event: z.enum(['hired', 'probation_end', 'anniversary']),
      offsetDays: z.int().min(0).max(730),
      repeatDays: z.int().min(0).max(730),
      times: z.int().min(1).max(6),
      group: z.enum(['week', 'person']),
      leadDays: z.int().min(0).max(90),
    }),
  ]),
  activities: z.array(z.enum(['self', 'manager', 'peer', 'upward', 'skip'])).min(1),
  summary: z.array(z.string().max(200)).max(10),
});

export async function automationInWords(ctx: Ctx, text: string): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const got = await ask(
    ctx,
    'automationsInWords',
    {
      version: '1',
      instruction:
        'Turn the request into an automation that creates review cycles. Return JSON {"name","trigger":{...},"activities":[...],"summary":[lines]}.',
      answer: AutomationDraft,
    },
    { request: text },
    { on: 'An automation' },
  );
  if (!got.ok) return got;
  return ok({ draft: got.value.answer, logId: got.value.logId });
}

/* -------------------------------------------------------------- charts -- */

const Plan = z.object({
  metric: z.enum(['completion', 'score', 'onTime', 'submitted']),
  by: z.enum(['department', 'manager', 'kind', 'none']),
  kind: z.enum(['self', 'manager', 'peer', 'upward']).nullable(),
  chart: z.enum(['bars', 'columns']),
  title: z.string().max(120),
});

/** §18.5: the model plans by name; Kithena computes; insights read aggregates above the minimum only. */
export async function askChart(
  ctx: Ctx,
  question: string,
  cycleId: string | null,
): Promise<Result<unknown>> {
  if (!ctx.viewer.hr) return err(forbidden('Analytics are for HR and calibrators'));
  const got = await ask(
    ctx,
    'charts',
    {
      version: '1',
      instruction:
        'Plan a chart. Metrics: completion (% submitted), score (average performance score), onTime (% on time), submitted (count). Breakdowns: department, manager, kind, none. Return JSON {"metric","by","kind","chart","title"}.',
      answer: Plan,
    },
    { question },
    { on: 'Ask for a chart' },
  );
  if (!got.ok) return got;
  const plan = got.value.answer;
  const data = await metric(ctx, {
    metric: plan.metric,
    by: plan.by,
    cycleId,
    ...(plan.kind === null ? {} : { kind: plan.kind }),
  });
  let insights: string[] = [];
  const shown = data.filter((d) => d.value !== null && d.n >= COHORT);
  if (shown.length > 1 && ctx.deps.model !== undefined) {
    const words = await ask(
      ctx,
      'charts',
      {
        version: '1',
        instruction:
          'Say in at most 2 sentences what stands out in these numbers. Return JSON {"insights":[...]}.',
        answer: z.object({ insights: z.array(z.string().max(300)).max(3) }),
      },
      { title: plan.title, data: shown },
      { on: plan.title },
    );
    if (words.ok) insights = words.value.answer.insights;
  }
  return ok({ plan, data, insights, logId: got.value.logId });
}

export async function saveChart(
  ctx: Ctx,
  input: { title: string; plan: unknown },
): Promise<Result<{ id: string }>> {
  const id = ctx.deps.newId();
  await ctx.tx.charts.save({
    id,
    owner: ctx.viewer.personId ?? ctx.viewer.accountId,
    title: input.title,
    plan: input.plan,
    at: ctx.at,
  });
  return ok({ id });
}

/* ------------------------------------------- learning and calibration -- */

export async function learningSuggestions(ctx: Ctx, personId: string): Promise<Result<unknown>> {
  if (personId !== ctx.viewer.personId && !ctx.viewer.org.has(personId) && !ctx.viewer.hr)
    return err(forbidden());
  const items = await ctx.tx.items.find();
  const goals = (await ctx.tx.goals.find({ ownerId: personId })).map((g) => g.title);
  const got = await ask(
    ctx,
    'learningSuggestions',
    {
      version: '1',
      instruction:
        'Pick up to 3 catalogue items that fit these goals. Return JSON {"items":[{"id","why"}]}.',
      answer: z.object({
        items: z.array(z.object({ id: z.string(), why: z.string().max(200) })).max(3),
      }),
    },
    { goals, catalogue: items.map((i) => ({ id: i.id, title: i.title, skills: i.skills })) },
    { forPerson: personId, on: 'Learning suggestions' },
  );
  if (!got.ok) return got;
  const known = new Map(items.map((i) => [i.id, i]));
  return ok({
    items: got.value.answer.items
      .filter((i) => known.has(i.id))
      .map((i) => ({ ...i, title: known.get(i.id)?.title ?? '' })),
    logId: got.value.logId,
  });
}

export async function calibrationSuggestions(
  ctx: Ctx,
  sessionId: string,
): Promise<Result<unknown>> {
  const s = await ctx.tx.calibrations.get(sessionId);
  if (s === null || (!ctx.viewer.hr && !s.calibrators.includes(ctx.viewer.personId ?? '')))
    return err(notFound('calibration session'));
  const name = await names(ctx);
  const scale = (await settingsOf(ctx)).general.scale;
  const rows = [];
  for (const p of s.subjects) {
    const rs = (await ctx.tx.reviews.find({ cycleId: s.cycleId, subjectId: p })).filter(
      isSubmitted,
    );
    const mgr = rs.find((r) => r.kind === 'manager');
    rows.push({
      id: p,
      name: name(p),
      score: (mgr?.submitted.at(-1)?.scoreHundredths ?? 0) / 100,
      peers: rs.filter((r) => r.kind === 'peer').length,
    });
  }
  const got = await ask(
    ctx,
    'calibrationSuggestions',
    {
      version: '1',
      instruction: `Suggest at most 3 score changes on a ${String(scale[0]?.value ?? 1)}–${String(scale.at(-1)?.value ?? 5)} scale that bring the group nearer a sensible distribution or fit the evidence. Return JSON {"proposals":[{"personId","now","reason"}]}.`,
      answer: z.object({
        proposals: z
          .array(z.object({ personId: z.string(), now: z.number(), reason: z.string().max(300) }))
          .max(3),
      }),
    },
    { people: rows },
    { on: s.name },
  );
  if (!got.ok) return got;
  const ids = new Set(s.subjects);
  return ok({
    proposals: got.value.answer.proposals
      .filter((p) => ids.has(p.personId))
      .map((p) => ({ ...p, name: name(p.personId), nowHundredths: Math.round(p.now * 100) })),
    logId: got.value.logId,
  });
}

/** S7b: the AI output log, for HR. */
export async function aiLogScreen(ctx: Ctx): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const name = await names(ctx);
  return ok({
    rows: (await ctx.tx.aiLog.find())
      .toSorted((a, b) => b.at.localeCompare(a.at))
      .slice(0, 200)
      .map((l) => ({
        id: l.id,
        at: l.at,
        feature: l.feature,
        for: name(l.forPerson),
        on: l.on,
        prompt: l.promptVersion,
        outcome: l.outcome,
        model: l.model,
      })),
  });
}
