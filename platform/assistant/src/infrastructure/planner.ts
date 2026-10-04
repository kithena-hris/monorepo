import { asIdentity } from '@kithena/contracts';
import {
  aiGateway,
  createPolicyRegistry,
  logger as base,
  type Logger,
  type ModelTransport,
} from '@kithena/telemetry';

import type { Planned, Planner } from '../application/ports.js';
import { promptFor } from '../domain/instruction.js';

/**
 * The planner: the model, reached only through the AI gateway (assistant PRD
 * §12.1, §12.3, §14).
 *
 * Every prompt leaves through `aiGateway`, over a registry per tenant loaded
 * with the static generated paths and the union of every catalogue's `denied`
 * for this question — People's not-for-AI fields, Time Off's words for health
 * data — refreshed with the catalogues. No subjects are named, so the gateway
 * applies its conservative rule: a prompt mentioning a denied field by key or
 * label is refused whole, and the asker is told it touches information the
 * assistant may not see. A masking bug that let "sick leave" through stops
 * here.
 *
 * The transport is People's `chatModel` (`services/people/src/infrastructure/assistant/model.ts`),
 * copied because a platform service cannot import a module: any
 * OpenAI-compatible API from `ASSISTANT_BASE_URL`, `ASSISTANT_API_KEY` and
 * `ASSISTANT_MODEL`, JSON mode, temperature 0, 8 s.
 */

type Settings = Readonly<Record<string, string | undefined>>;

const GROQ = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export interface ModelConfig {
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly model: string;
}

/** The model the settings name, or null where none is configured: a hosted API needs a key. */
export function modelConfigFrom(settings: Settings): ModelConfig | null {
  const baseUrl = (settings['ASSISTANT_BASE_URL'] ?? GROQ).replace(/\/$/u, '');
  const apiKey = settings['ASSISTANT_API_KEY'] || null;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/u.test(baseUrl);
  if (apiKey === null && !local) return null;
  return { baseUrl, apiKey, model: settings['ASSISTANT_MODEL'] || DEFAULT_MODEL };
}

export function chatModel(
  config: ModelConfig,
  options: { readonly fetch?: typeof fetch; readonly timeoutMs?: number } = {},
): ModelTransport {
  const send = options.fetch ?? fetch;
  return async (prompt) => {
    const response = await send(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey === null ? {} : { authorization: `Bearer ${config.apiKey}` }),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        // Room for a reasoning model's thinking as well as one small JSON object.
        max_tokens: 2_048,
        ...(config.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.instruction },
          { role: 'user', content: JSON.stringify(prompt.context) },
        ],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
    if (!response.ok) throw new Error(`the model answered ${String(response.status)}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? '';
  };
}

/** A planner over any transport, through the gateway. */
export function gatedPlanner(send: ModelTransport, log: Logger = base): Planner {
  const registry = createPolicyRegistry({ unknownTenantRedaction: [] });
  const gateway = aiGateway({ registry, send });
  return {
    async plan(tenantId, request): Promise<Planned> {
      registry.replace(
        tenantId,
        request.denied.map((d) => ({ key: d.key, policy: asIdentity(), labels: d.labels })),
      );
      try {
        const completed = await gateway.complete(tenantId, promptFor(request));
        if (completed.ok) return { ok: true, text: completed.value };
        // The code only: the gateway's message names the field it found.
        log.warn({ tenantId, code: completed.error.code }, 'planner prompt refused');
        const named =
          completed.error.code === 'AI_FIELD_NAMED' || completed.error.code === 'AI_VALUE_DENIED';
        return { ok: false, code: named ? 'NOT_ALLOWED' : 'FAILED' };
      } catch (error) {
        log.warn({ tenantId, reason: (error as Error).name }, 'planner model failed');
        return { ok: false, code: 'FAILED' };
      }
    },
  };
}

/** The planner the settings configure, or null: then every question is "not available". */
export function plannerFrom(
  settings: Settings,
  options: { readonly fetch?: typeof fetch; readonly logger?: Logger } = {},
): Planner | null {
  const config = modelConfigFrom(settings);
  const log = options.logger ?? base;
  if (config === null) {
    log.info('ASSISTANT_API_KEY unset; the assistant is not available');
    return null;
  }
  return gatedPlanner(chatModel(config, options), log);
}
