import {
  DEFAULT_SCALE,
  FormDefinition,
  type FormActivity,
  type FormAnswers,
  type FormDefinitionInput,
} from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { diff, questionsFor, score, subjectView } from '@kithena/form-kit';

import {
  createTemplate,
  current,
  draftOf,
  editDraft,
  mayDelete,
  publish,
  published,
  version,
  type Template,
} from '../domain/template.js';
import { audit, event, hrOnly, notFound, publish as emit, type Ctx } from './context.js';
import { settingsOf } from './settings.js';

/**
 * Form templates (PRD §11, PRF-040): the list, the builder, previews as each
 * reader sees the form, history with what changed, publishing and archiving.
 * Only HR writes templates.
 */

const def = (input: FormDefinitionInput): FormDefinition => FormDefinition.parse(input);

const five = DEFAULT_SCALE;
const SEED: readonly { name: string; purpose: FormActivity[]; definition: FormDefinition }[] = [
  {
    name: 'Self review, standard',
    purpose: ['self'],
    definition: def({
      title: 'Self review',
      sections: [
        {
          id: 'results',
          title: 'Results',
          questions: [
            {
              id: 'results',
              type: 'text',
              prompt: 'What were your most important results this period?',
            },
            {
              id: 'goals',
              type: 'scale',
              prompt: 'How did your results compare with the goals set at the start?',
              options: five,
            },
          ],
        },
        {
          id: 'how',
          title: 'How you work',
          questions: [
            { id: 'delivers', type: 'scale', prompt: 'Delivers what you commit to', options: five },
            {
              id: 'collaborates',
              type: 'scale',
              prompt: 'Collaborates across teams',
              options: five,
              allowComment: true,
            },
          ],
        },
        {
          id: 'growth',
          title: 'Growth',
          questions: [
            {
              id: 'grow',
              type: 'text',
              prompt: 'What would help you grow next period?',
              required: false,
            },
          ],
        },
      ],
    }),
  },
  {
    name: 'Manager review, standard',
    purpose: ['manager'],
    definition: def({
      title: 'Manager review',
      sections: [
        {
          id: 'results',
          title: 'Results',
          questions: [
            {
              id: 'results',
              type: 'text',
              prompt: 'What were their most important results this period?',
            },
            {
              id: 'goals',
              type: 'scale',
              prompt: 'How did their results compare with the goals set at the start?',
              options: five,
            },
          ],
        },
        {
          id: 'how',
          title: 'How they work',
          questions: [
            {
              id: 'delivers',
              type: 'scale',
              prompt: 'Delivers what they commit to',
              options: five.map((o, i) => ({
                ...o,
                description:
                  [
                    'Missed most commitments; needed others to finish',
                    'Delivered some; slips weren’t flagged early',
                    'Delivered what was agreed, on time',
                    'Delivered more than agreed, and unblocked others',
                    'Changed what the team could deliver',
                  ][i] ?? null,
              })),
            },
            {
              id: 'collaborates',
              type: 'scale',
              prompt: 'Collaborates across teams',
              help: 'Think of work that needed another team to land.',
              options: five,
              allowComment: true,
            },
            { id: 'early', type: 'text', prompt: 'Raises problems early', required: false },
          ],
        },
        {
          id: 'growth',
          title: 'Growth',
          questions: [
            { id: 'keep', type: 'text', prompt: 'What should they keep doing?' },
            { id: 'next', type: 'text', prompt: 'What would help them grow next period?' },
            {
              id: 'potential',
              type: 'scale',
              prompt: 'Potential to grow into a bigger role',
              options: five,
              private: true,
            },
            {
              id: 'retention',
              type: 'choice',
              prompt: 'Retention risk',
              private: true,
              required: false,
              options: [
                { id: 'low', label: 'Low' },
                { id: 'medium', label: 'Medium' },
                { id: 'high', label: 'High' },
              ],
            },
          ],
        },
        {
          id: 'score',
          title: 'Performance score',
          questions: [{ id: 'score', type: 'performance_score', prompt: 'Performance score' }],
        },
      ],
    }),
  },
  {
    name: 'Peer review, four questions',
    purpose: ['peer'],
    definition: def({
      title: 'Peer review',
      sections: [
        {
          id: 'peer',
          title: 'Peer review',
          questions: [
            { id: 'keep', type: 'text', prompt: 'What should they keep doing?' },
            {
              id: 'rely',
              type: 'choice',
              prompt: 'How often do you rely on their work?',
              options: [
                { id: 'week', label: 'Every week' },
                { id: 'month', label: 'Every month' },
                { id: 'rarely', label: 'Rarely' },
              ],
            },
            {
              id: 'collaborates',
              type: 'scale',
              prompt: 'Collaborates across teams',
              options: five,
            },
            { id: 'grow', type: 'text', prompt: 'What would help them grow?', required: false },
            {
              id: 'manager',
              type: 'text',
              prompt: 'Anything only their manager should know?',
              required: false,
              private: true,
            },
          ],
        },
      ],
    }),
  },
  {
    name: 'Upward review',
    purpose: ['upward'],
    definition: def({
      title: 'Upward review',
      sections: [
        {
          id: 'upward',
          title: 'Your manager',
          questions: [
            {
              id: 'support',
              type: 'scale',
              prompt: 'Gives me the support I need to do my best work',
              options: five,
            },
            {
              id: 'clarity',
              type: 'scale',
              prompt: 'Is clear about what is expected of me',
              options: five,
            },
            {
              id: 'change',
              type: 'text',
              prompt: 'What one thing should they change?',
              required: false,
            },
          ],
        },
      ],
    }),
  },
  {
    name: 'Probation review',
    purpose: ['self', 'manager'],
    definition: def({
      title: 'Probation review',
      sections: [
        {
          id: 'settling',
          title: 'Settling in',
          questions: [
            { id: 'going', type: 'text', prompt: 'How are the first months going?' },
            {
              id: 'expectations',
              type: 'scale',
              prompt: 'Meets the expectations of the role',
              options: five,
            },
            {
              id: 'confirm',
              type: 'binary',
              prompt: 'Recommend confirming the role',
              activities: ['manager'],
            },
          ],
        },
        {
          id: 'score',
          title: 'Performance score',
          questions: [{ id: 'score', type: 'performance_score', prompt: 'Performance score' }],
        },
      ],
    }),
  },
  {
    name: 'After a project',
    purpose: ['feedback'],
    definition: def({
      title: 'After a project',
      sections: [
        {
          id: 'project',
          title: 'The project',
          questions: [
            { id: 'well', type: 'text', prompt: 'What went well?' },
            { id: 'change', type: 'text', prompt: 'What would you change next time?' },
            {
              id: 'again',
              type: 'binary',
              prompt: 'Would you work with them on a project like this again?',
            },
            { id: 'more', type: 'text', prompt: 'Anything else?', required: false },
          ],
        },
      ],
    }),
  },
];

/** A new company's starting forms, published, once (§11). */
export async function ensureSeeded(ctx: Ctx): Promise<void> {
  if ((await ctx.tx.settings.get('seeded')) !== null) return;
  const defaults: Record<string, string> = {};
  for (const s of SEED) {
    const made = createTemplate({ id: ctx.deps.newId(), ...s, by: 'Kithena', at: ctx.at });
    if (!made.ok) continue;
    const live = publish(made.value, ctx.at);
    if (!live.ok) continue;
    await ctx.tx.templates.save(live.value);
    for (const p of s.purpose) defaults[p] ??= live.value.id;
  }
  const reviews = ((await ctx.tx.settings.get('reviews')) as Record<string, unknown> | null) ?? {};
  await ctx.tx.settings.set('reviews', { ...reviews, templates: defaults });
  await ctx.tx.settings.set('seeded', { at: ctx.at });
}

/** How many cycles use each template, and which: one read over every cycle. */
async function usage(
  ctx: Ctx,
): Promise<Map<string, { id: string; name: string; state: string; version: number | null }[]>> {
  const out = new Map<
    string,
    { id: string; name: string; state: string; version: number | null }[]
  >();
  for (const c of await ctx.tx.cycles.find())
    for (const [kind, a] of Object.entries(c.activities)) {
      if (!a.on || a.templateId === null) continue;
      const pinned =
        c.snapshot?.pinned[kind as keyof typeof c.snapshot.pinned]?.version ?? a.pinnedVersion;
      const list = out.get(a.templateId) ?? [];
      if (!list.some((x) => x.id === c.id))
        list.push({ id: c.id, name: c.name, state: c.state, version: pinned });
      out.set(a.templateId, list);
    }
  return out;
}

const versionLabel = (t: Template): string => {
  const p = published(t);
  const d = draftOf(t);
  if (p !== undefined && d !== undefined)
    return `v${String(p.version)} · v${String(d.version)} draft`;
  return `v${String((p ?? d ?? t.versions.at(-1))?.version ?? 1)}`;
};

const stateOf = (t: Template): string =>
  t.archived ? 'Archived' : published(t) !== undefined ? 'Published' : 'Draft';

export async function templatesScreen(
  ctx: Ctx,
  filter: { q?: string | undefined; show?: string | undefined },
): Promise<{ readonly rows: readonly unknown[]; readonly hr: boolean }> {
  await ensureSeeded(ctx);
  const used = await usage(ctx);
  const q = (filter.q ?? '').toLowerCase();
  const rows = (await ctx.tx.templates.find())
    .filter((t) => (filter.show === 'archived' ? t.archived : !t.archived))
    .filter((t) => {
      if (filter.show === 'reviews')
        return t.purpose.some((p) => !['feedback', 'quiz'].includes(p));
      if (filter.show === 'feedback') return t.purpose.includes('feedback');
      if (filter.show === 'quizzes') return t.purpose.includes('quiz');
      return true;
    })
    .filter((t) => q === '' || t.name.toLowerCase().includes(q))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((t) => ({
      id: t.id,
      name: t.name,
      purpose: [...t.purpose],
      version: versionLabel(t),
      state: stateOf(t),
      inCycles: used.get(t.id)?.length ?? 0,
      updatedAt: t.updatedAt,
      canDelete: !t.everUsed && (used.get(t.id)?.length ?? 0) === 0,
      questions: (current(t)?.definition.sections ?? []).reduce(
        (n, s) => n + s.questions.length,
        0,
      ),
      published: published(t)?.version ?? null,
      hasScore: (current(t)?.definition.sections ?? []).some((s) =>
        s.questions.some((x) => x.type === 'performance_score'),
      ),
    }));
  return { rows, hr: ctx.viewer.hr };
}

export async function templateScreen(ctx: Ctx, id: string): Promise<Result<unknown>> {
  const t = await ctx.tx.templates.get(id);
  if (t === null) return err(notFound('template'));
  const used = (await usage(ctx)).get(id) ?? [];
  const cur = current(t);
  const settings = await settingsOf(ctx);
  return ok({
    id: t.id,
    name: t.name,
    purpose: [...t.purpose],
    archived: t.archived,
    state: stateOf(t),
    current: cur,
    published: published(t)?.version ?? null,
    draft: draftOf(t)?.version ?? null,
    versions: t.versions.map((v) => ({
      version: v.version,
      state: v.state,
      by: v.by,
      at: v.at,
      publishedAt: v.publishedAt,
      pinnedBy: used
        .filter((c) => c.version === v.version || (c.version === null && v.state === 'published'))
        .map((c) => c.name),
    })),
    cycles: used,
    scale: settings.general.scale,
    canDelete: !t.everUsed && used.length === 0,
    hr: ctx.viewer.hr,
  });
}

/** Sample answers so a preview shows a filled form (design PF2b). */
function sample(definition: FormDefinition): FormAnswers {
  const out: FormAnswers = {};
  for (const q of definition.sections.flatMap((s) => s.questions)) {
    if (q.type === 'text')
      out[q.id] = {
        value: '<p>Shipped the ledger migration with zero data loss.</p>',
        comment: null,
      };
    if (q.type === 'scale')
      out[q.id] = {
        value: q.options[Math.min(3, q.options.length - 1)]?.value ?? 0,
        comment: null,
      };
    if (q.type === 'binary') out[q.id] = { value: true, comment: null };
    if (q.type === 'choice') out[q.id] = { value: [q.options[0]?.id ?? ''], comment: null };
    if (q.type === 'number') out[q.id] = { value: q.min ?? 1, comment: null };
  }
  return out;
}

/** The whole form as one reader sees it (§11.6): the reviewer, the subject or a calibrator. */
export async function previewScreen(
  ctx: Ctx,
  id: string,
  opts: { version?: number; as?: string; activity?: string },
): Promise<Result<unknown>> {
  const t = await ctx.tx.templates.get(id);
  if (t === null) return err(notFound('template'));
  const v = opts.version === undefined ? current(t) : version(t, opts.version);
  if (v === undefined) return err(notFound('version'));
  const activity = (opts.activity ?? t.purpose[0] ?? 'manager') as FormActivity;
  const asked = questionsFor(v.definition, activity);
  const answers = sample(asked);
  const scale = (await settingsOf(ctx)).general.scale;
  const seen = opts.as === 'subject' ? subjectView(asked, answers) : { definition: asked, answers };
  const removed = asked.sections.flatMap((s) =>
    s.questions
      .filter((q) => q.private)
      .map((q) => ({
        id: q.id,
        prompt: q.prompt,
        why: 'Private: managers, HR and calibrators only.',
      })),
  );
  return ok({
    name: t.name,
    version: v.version,
    as: opts.as ?? 'reviewer',
    activity,
    definition: seen.definition,
    answers: seen.answers,
    score: score(seen.definition, seen.answers, scale),
    removed: opts.as === 'subject' ? removed : [],
    emptyRemoved: v.definition.sections.length - asked.sections.length,
  });
}

export async function historyScreen(ctx: Ctx, id: string): Promise<Result<unknown>> {
  const t = await ctx.tx.templates.get(id);
  if (t === null) return err(notFound('template'));
  const versions = t.versions.toSorted((a, b) => b.version - a.version);
  return ok({
    name: t.name,
    changes: versions.map((v) => {
      const before = t.versions.filter((x) => x.version < v.version).at(-1);
      return {
        version: v.version,
        state: v.state,
        by: v.by,
        at: v.at,
        changes: before === undefined ? [] : diff(before.definition, v.definition),
      };
    }),
  });
}

/** What publishing would move (§11.7): draft and scheduled cycles follow; launched ones keep theirs. */
interface CycleUse {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly version: number | null;
}

export async function publishImpact(
  ctx: Ctx,
  id: string,
): Promise<{ readonly move: readonly CycleUse[]; readonly stay: readonly CycleUse[] }> {
  const used = (await usage(ctx)).get(id) ?? [];
  return {
    move: used.filter((c) => ['draft', 'scheduling', 'scheduled'].includes(c.state)),
    stay: used.filter((c) => !['draft', 'scheduling', 'scheduled'].includes(c.state)),
  };
}

export async function newTemplate(
  ctx: Ctx,
  input: { name: string; purpose: FormActivity[]; definition: FormDefinition | null },
): Promise<Result<{ id: string }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const made = createTemplate({
    id: ctx.deps.newId(),
    name: input.name,
    purpose: input.purpose,
    definition:
      input.definition ??
      def({
        title: input.name,
        sections: [
          {
            id: 'section-1',
            title: 'Section 1',
            questions: [{ id: 'q1', type: 'text', prompt: 'Your first question' }],
          },
        ],
      }),
    by: ctx.viewer.name,
    at: ctx.at,
  });
  if (!made.ok) return made;
  await ctx.tx.templates.save(made.value);
  await audit(ctx, {
    kind: 'template',
    action: 'Created a template',
    target: input.name,
    targetId: made.value.id,
  });
  return ok({ id: made.value.id });
}

/**
 * The performance score a draft would give the answers HR tries in the builder,
 * on the company's scale: the builder's own rows show what a reviewer will see,
 * the number included, without anything being saved.
 */
export async function scoreSample(
  ctx: Ctx,
  input: { definition: FormDefinition; answers: FormAnswers },
): Promise<Result<{ score: ReturnType<typeof score> }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const scale = (await settingsOf(ctx)).general.scale;
  return ok({ score: score(input.definition, input.answers, scale) });
}

export async function saveTemplate(
  ctx: Ctx,
  id: string,
  input: { name?: string; purpose?: FormActivity[]; definition: FormDefinition },
): Promise<Result<{ version: number; removed: readonly string[] }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const t = await ctx.tx.templates.get(id);
  if (t === null) return err(notFound('template'));
  const edited = editDraft(t, { ...input, by: ctx.viewer.name, at: ctx.at });
  if (!edited.ok) return edited;
  await ctx.tx.templates.save(edited.value.template);
  return ok({
    version: draftOf(edited.value.template)?.version ?? 1,
    removed: edited.value.removed,
  });
}

export async function publishTemplate(ctx: Ctx, id: string): Promise<Result<{ version: number }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const t = await ctx.tx.templates.get(id);
  if (t === null) return err(notFound('template'));
  const done = publish(t, ctx.at);
  if (!done.ok) return done;
  await ctx.tx.templates.save(done.value);
  const v = published(done.value)?.version ?? 1;
  // Draft and scheduled cycles follow the published version until they launch: nothing to rewrite.
  await emit(
    ctx,
    event(
      ctx,
      'performance.template.published',
      { type: 'template', id },
      { templateId: id, version: v },
    ),
  );
  await audit(ctx, {
    kind: 'template',
    action: 'Published a template',
    target: `${t.name} v${String(v)}`,
    targetId: id,
  });
  return ok({ version: v });
}

export async function archiveTemplate(
  ctx: Ctx,
  id: string,
  archived: boolean,
): Promise<Result<{ ok: true }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const t = await ctx.tx.templates.get(id);
  if (t === null) return err(notFound('template'));
  await ctx.tx.templates.save({
    ...t,
    archived,
    updatedAt: ctx.at,
    versions: t.versions.map((v) =>
      archived && v.state === 'published'
        ? { ...v, state: 'archived' }
        : !archived && v.state === 'archived'
          ? { ...v, state: 'published' }
          : v,
    ),
  });
  await audit(ctx, {
    kind: 'template',
    action: archived ? 'Archived a template' : 'Unarchived a template',
    target: t.name,
    targetId: id,
  });
  return ok({ ok: true });
}

export async function deleteTemplate(ctx: Ctx, id: string): Promise<Result<{ ok: true }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const t = await ctx.tx.templates.get(id);
  if (t === null) return err(notFound('template'));
  if (((await usage(ctx)).get(id)?.length ?? 0) > 0)
    return err(failure('IN_USE', 'A cycle uses this template, so it can only be archived'));
  const allowed = mayDelete(t);
  if (!allowed.ok) return allowed;
  await ctx.tx.templates.remove(id);
  await audit(ctx, {
    kind: 'template',
    action: 'Deleted a template',
    target: t.name,
    targetId: id,
  });
  return ok({ ok: true });
}

export async function duplicateTemplate(
  ctx: Ctx,
  id: string,
  from?: number,
): Promise<Result<{ id: string }>> {
  const t = await ctx.tx.templates.get(id);
  if (t === null) return err(notFound('template'));
  const v = from === undefined ? current(t) : version(t, from);
  if (v === undefined) return err(notFound('version'));
  return newTemplate(ctx, {
    name: `${t.name} (copy)`,
    purpose: [...t.purpose],
    definition: v.definition,
  });
}

/** A version copied back into the draft ("restore", §11.7). */
export async function restoreVersion(
  ctx: Ctx,
  id: string,
  from: number,
): Promise<Result<{ version: number; removed: readonly string[] }>> {
  const t = await ctx.tx.templates.get(id);
  if (t === null) return err(notFound('template'));
  const v = version(t, from);
  if (v === undefined) return err(notFound('version'));
  return saveTemplate(ctx, id, { definition: v.definition });
}

/** Published templates for a picker (§8.3): latest version, question count, whether scored. */
export async function publishedTemplates(ctx: Ctx): Promise<
  {
    readonly id: string;
    readonly name: string;
    readonly purpose: FormActivity[];
    readonly published: number | null;
    readonly questions: number;
  }[]
> {
  await ensureSeeded(ctx);
  return (await ctx.tx.templates.find())
    .filter((t) => !t.archived)
    .map((t) => {
      const p = published(t);
      return {
        id: t.id,
        name: t.name,
        purpose: [...t.purpose],
        published: p?.version ?? null,
        questions: (p?.definition.sections ?? []).reduce((n, s) => n + s.questions.length, 0),
      };
    });
}
