import * as z from 'zod';

import type {
  AttributeAdvisor,
  ColumnCandidate,
  ColumnJudgment,
} from '../application/import/mapping.js';

/**
 * The column-mapping judgment (PRD §12.4), as a TypeSafe System One call.
 *
 * An adapter behind a port. The domain never imports this and the application
 * sees only `AttributeAdvisor`; with no `TYPESAFE_API_KEY` the factory returns
 * null and mapping falls back to exact key and label, then to the admin.
 *
 * Over plain `fetch` rather than the SDK: one POST with a documented body is
 * not worth a dependency, and the CI audit gates on every one added.
 *
 * **What is sent** is the column headers and each candidate's key, label,
 * description, type and section. No cell, no sample. **What comes back** is,
 * per column, a `Choice` over the candidate keys plus `no_match`, and its
 * confidence; `proposeMapping` applies the 0.9 gate.
 *
 * All columns go in one request, as the documented pattern for independent
 * questions over one state. Any failure — no network, a 4xx, a timeout, an
 * answer in a shape we did not ask for — returns no judgments, never throws:
 * an import is never blocked on an inference call.
 */

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

const Response = z.object({
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

export function typesafeAttributeAdvisor(config: TypeSafeConfig): AttributeAdvisor {
  const call = config.fetch ?? fetch;

  return {
    async mapColumns(headers, candidates) {
      const answers = new Map<string, ColumnJudgment>();
      if (headers.length === 0 || candidates.length === 0) return answers;

      const criteria: Record<string, string | null> = Object.fromEntries(
        candidates.map((c) => [c.key, describe(c)]),
      );
      criteria['no_match'] = 'None of these attributes: the column holds something else.';

      const questions = Object.fromEntries(
        headers.map((_, i) => [
          `column_${String(i)}`,
          {
            type: 'choice',
            instructions:
              `A spreadsheet of employees being imported into an HR system has a column headed ` +
              `\`columns[${String(i)}]\`. Which attribute of an employee record does that column hold?`,
            criteria,
          },
        ]),
      );

      try {
        const response = await call(ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: config.model ?? 'jev-latest',
            state: { columns: headers, attributes: candidates },
            questions,
          }),
          signal: AbortSignal.timeout(config.timeoutMs ?? 5_000),
        });
        if (!response.ok) return answers;

        const parsed = Response.safeParse(await response.json());
        if (!parsed.success) return answers;

        headers.forEach((header, i) => {
          const answer = parsed.data.answers[`column_${String(i)}`];
          if (!answer) return;
          answers.set(header, {
            key: answer.choice === 'no_match' ? null : answer.choice,
            confidence: answer.confidence,
          });
        });
      } catch {
        // Unavailable is an answer: nobody is blocked on an inference call.
      }
      return answers;
    },
  };
}

function describe(c: ColumnCandidate): string {
  const about = c.description ? `: ${c.description}` : '';
  return `${c.label} (${c.dataType}, in ${c.sectionKey})${about}`;
}

/** The advisor when a key is configured, else null — and the module boots either way. */
export function typesafeAttributeAdvisorFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AttributeAdvisor | null {
  const apiKey = env['TYPESAFE_API_KEY']?.trim();
  return apiKey ? typesafeAttributeAdvisor({ apiKey }) : null;
}
