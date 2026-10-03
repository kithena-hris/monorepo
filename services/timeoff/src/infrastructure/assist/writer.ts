import { logger, type ModelTransport } from '@kithena/telemetry';

import type { Writer } from '../../application/assist/ports.js';
import { timeOffGateway } from './gateway.js';
import { remembered } from './remembered.js';

/**
 * The assistant's model for Time Off's lines: any OpenAI-compatible chat API,
 * People's settings (`ASSISTANT_BASE_URL`, `ASSISTANT_API_KEY`,
 * `ASSISTANT_MODEL`), Groq by default and Ollama on a laptop with no key.
 * Copied from People's `infrastructure/assistant/model.ts` rather than shared:
 * no module imports another, and the dozen lines are not worth a package.
 *
 * Reached only through the AI gateway (`gateway.ts`). Short calls: somebody is
 * waiting for the page, and the shell gives a read ten seconds, so four, then
 * the template.
 */

const GROQ = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export interface ModelConfig {
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly model: string;
  readonly timeoutMs?: number;
}

export function modelConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): ModelConfig | null {
  const baseUrl = (env['ASSISTANT_BASE_URL'] ?? GROQ).replace(/\/$/u, '');
  const apiKey = env['ASSISTANT_API_KEY']?.trim() || null;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/u.test(baseUrl);
  if (apiKey === null && !local) {
    logger.info({ module: 'timeoff' }, 'ASSISTANT_API_KEY unset; Time Off writes its own lines');
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
        max_tokens: 1024,
        ...(config.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.instruction },
          { role: 'user', content: JSON.stringify(prompt.context) },
        ],
      }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 4_000),
    });
    if (!response.ok) throw new Error(`the model answered ${String(response.status)}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? '';
  };
}

/** Lines through the gateway; null on a refusal, a failure or an answer that is not an object. */
export function gatewayWriter(send: ModelTransport): Writer {
  const gateway = timeOffGateway(send);
  return {
    write: remembered(async (tenantId, ask) => {
      try {
        const answered = await gateway.complete(tenantId, {
          instruction: ask.instruction,
          context: { facts: ask.facts, lines: ask.lines },
        });
        if (!answered.ok) {
          logger.warn(
            { module: 'timeoff', code: answered.error.code },
            'the AI gateway refused a prompt',
          );
          return null;
        }
        const parsed: unknown = JSON.parse(answered.value);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }),
  };
}

/** The writer when a model is configured; otherwise none, and every line is the template. */
export function writerFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Writer | undefined {
  const config = modelConfigFrom(env);
  return config === null ? undefined : gatewayWriter(chatModel(config));
}
