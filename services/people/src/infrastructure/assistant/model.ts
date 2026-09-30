import { logger } from '@kithena/telemetry';
import type { ModelTransport } from '@kithena/telemetry';

/**
 * A model behind any OpenAI-compatible chat API: Groq in development,
 * staging and production for now (free), Ollama on a laptop with no key, and
 * a paid provider later by changing three settings.
 *
 * - `ASSISTANT_BASE_URL`: the API's address; Groq's by default.
 * - `ASSISTANT_API_KEY`: its key; none for a local Ollama.
 * - `ASSISTANT_MODEL`: the model; `openai/gpt-oss-120b` on Groq by default.
 *
 * Only reached through the AI gateway, which has already refused anything a
 * model may not see. The instruction goes as the system message and the
 * context — the question and the field names, never a record — as the user's.
 */

const GROQ = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export interface ModelConfig {
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly model: string;
  readonly timeoutMs?: number;
  /** Room for the answer; 1024 by default, which one small JSON object needs. */
  readonly maxTokens?: number;
}

export function modelConfigFrom(env: NodeJS.ProcessEnv): ModelConfig | null {
  const baseUrl = (env['ASSISTANT_BASE_URL'] ?? GROQ).replace(/\/$/, '');
  const apiKey = env['ASSISTANT_API_KEY'] ?? null;
  // A hosted API needs a key; only a local one (Ollama) goes without.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl);
  if (apiKey === null && !local) {
    logger.info('ASSISTANT_API_KEY unset; the assistant is not available');
    return null;
  }
  return { baseUrl, apiKey, model: env['ASSISTANT_MODEL'] ?? DEFAULT_MODEL };
}

export function chatModel(config: ModelConfig): ModelTransport {
  return async (prompt) => {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey === null ? {} : { authorization: `Bearer ${config.apiKey}` }),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        // Room for a reasoning model's thinking as well as its answer, which
        // needs little of either: one small JSON object.
        max_tokens: config.maxTokens ?? 1024,
        ...(config.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.instruction },
          { role: 'user', content: JSON.stringify(prompt.context) },
        ],
      }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 20_000),
    });
    if (!response.ok) {
      throw new Error(`the model answered ${String(response.status)}`);
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return body.choices?.[0]?.message?.content ?? '';
  };
}
