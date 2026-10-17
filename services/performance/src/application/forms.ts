import type { FormDefinition, FormQuestion } from '@kithena/contracts';
import { questionsFor } from '@kithena/form-kit';

import { progress } from '../domain/goals.js';
import type { Review } from '../domain/review.js';
import { version } from '../domain/template.js';
import type { Ctx } from './context.js';

/**
 * The form a review is written on (§11, §14.6): its pinned template version
 * as its activity asks it, with a generated goals section before the score
 * when the cycle rates goals.
 */
export async function formOf(ctx: Ctx, r: Review): Promise<FormDefinition | null> {
  const t = await ctx.tx.templates.get(r.templateId);
  const v = t === null ? undefined : version(t, r.version);
  if (v === undefined) return null;
  const asked = questionsFor(v.definition, r.kind);
  if (r.goals.length === 0) return asked;
  const goals: FormQuestion[] = [];
  for (const id of r.goals) {
    const g = await ctx.tx.goals.get(id);
    if (g === null) continue;
    goals.push({
      id: `goal-${id.slice(0, 8)}`,
      type: 'goals',
      prompt: g.title,
      help: null,
      required: true,
      allowComment: true,
      private: false,
      goalId: id,
      progress: progress(g),
    });
  }
  if (goals.length === 0) return asked;
  const section = {
    id: 'goals',
    title: 'Goals',
    description: 'Generated from the goals attached to this cycle.',
    questions: goals,
  };
  const scored =
    asked.sections.at(-1)?.questions.some((q) => q.type === 'performance_score') === true;
  const head = scored ? asked.sections.slice(0, -1) : asked.sections;
  const tail = scored ? asked.sections.slice(-1) : [];
  return { ...asked, sections: [...head, section, ...tail] };
}
