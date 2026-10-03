import * as z from 'zod';

import type { Judge, Judgment } from '../../application/assist/ports.js';
import { timeOffGateway } from './gateway.js';
import { remembered } from './remembered.js';

/**
 * Time Off's judgments as TypeSafe System One calls (PRD §14.1), People's
 * advisor's way (`services/people/.../typesafe-attribute-advisor.ts`): plain
 * `fetch`, one POST, every question over the same state in one request.
 *
 * Through the AI gateway like the writer: the state and the questions are the
 * prompt's context, so a denied key or word in either refuses the call. Any
 * failure — no network, a 4xx, a timeout, a refusal, an answer in a shape we
 * did not ask for, a choice we did not offer — answers nothing, never throws.
 */

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

const Answers = z.object({
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal('choice'),
      choice: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export interface TypeSafeConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export function typesafeJudge(config: TypeSafeConfig): Judge {
  const call = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const gateway = timeOffGateway(async (prompt) => {
    const response = await call(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model ?? 'jev-latest',
        state: prompt.context['state'],
        questions: prompt.context['questions'],
      }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 3_000),
    });
    if (!response.ok) throw new Error(`TypeSafe answered ${String(response.status)}`);
    return JSON.stringify(await response.json());
  });

  return {
    choose: remembered(async (tenantId, ask) => {
      const out = new Map<string, Judgment>();
      const ids = Object.keys(ask.questions);
      if (ids.length === 0) return out;
      try {
        const questions = Object.fromEntries(
          Object.entries(ask.questions).map(([id, q]) => [
            id,
            { type: 'choice', instructions: q.instructions, criteria: q.options },
          ]),
        );
        const answered = await gateway.complete(tenantId, {
          instruction: 'Judge each question over the state.',
          context: { state: ask.state, questions },
        });
        if (!answered.ok) return out;
        const parsed = Answers.safeParse(JSON.parse(answered.value));
        if (!parsed.success) return out;
        for (const id of ids) {
          const answer = parsed.data.answers[id];
          if (answer !== undefined && answer.choice in (ask.questions[id]?.options ?? {})) {
            out.set(id, { choice: answer.choice, confidence: answer.confidence });
          }
        }
      } catch {
        // Unavailable is an answer: every caller has a rule of its own.
      }
      return out;
    }),
  };
}

/** The judge when `TYPESAFE_API_KEY` is set; otherwise none, and every caller uses its rule. */
export function typesafeJudgeFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Judge | undefined {
  const apiKey = env['TYPESAFE_API_KEY']?.trim();
  return apiKey ? typesafeJudge({ apiKey }) : undefined;
}
