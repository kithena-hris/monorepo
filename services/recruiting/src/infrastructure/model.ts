import { aiGateway, createPolicyRegistry, logger, type ModelTransport } from '@kithena/telemetry';

import { DENIED } from '../application/ai-denied.js';
import type { Model } from '../application/ports.js';

/**
 * Recruiting's model: any OpenAI-compatible chat API, on the settings Time
 * Off and People read (`ASSISTANT_BASE_URL`, `ASSISTANT_API_KEY`,
 * `ASSISTANT_MODEL`), copied rather than shared because no module imports
 * another. Reached only through the AI gateway, which refuses Recruiting's
 * denied fields for every tenant. Unset, there is no model and every AI
 * feature answers that it is off; Recruiting works the same without it.
 *
 * Choose a provider that does not train on the input and that processes in
 * the EU where it offers to (PRD §22.2 point 5); that is the deployment's
 * setting, not this file's.
 */

const GROQ = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export function modelFrom(env: Readonly<Record<string, string | undefined>>): Model | undefined {
  const baseUrl = (env['ASSISTANT_BASE_URL'] ?? GROQ).replace(/\/$/u, '');
  const apiKey = env['ASSISTANT_API_KEY']?.trim() || null;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/u.test(baseUrl);
  if (apiKey === null && !local) {
    logger.info({ module: 'recruiting' }, 'ASSISTANT_API_KEY unset; AI features are off');
    return undefined;
  }
  const name = env['ASSISTANT_MODEL'] ?? DEFAULT_MODEL;
  const model = gatewayModel(name, chat(baseUrl, apiKey, name));
  // Groq's GPT-OSS models carry a web search of their own; elsewhere there is none.
  const searching = gatewayModel(name, chat(baseUrl, apiKey, name, true));
  return baseUrl === GROQ && name.startsWith('openai/gpt-oss')
    ? {
        ...model,
        research: (tenantId, prompt) => searching.complete(tenantId, prompt),
      }
    : model;
}

function chat(
  baseUrl: string,
  apiKey: string | null,
  model: string,
  search = false,
): ModelTransport {
  return async (prompt) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey === null ? {} : { authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 4096,
        // With a search the answer is JSON in the text: the provider takes a tool or a format, not both.
        ...(search
          ? { tools: [{ type: 'browser_search' }], tool_choice: 'auto' }
          : { response_format: { type: 'json_object' } }),
        messages: [
          { role: 'system', content: prompt.instruction },
          { role: 'user', content: JSON.stringify(prompt.context) },
        ],
      }),
      // A person is waiting on R10 or R11; a batch runs in the background.
      signal: AbortSignal.timeout(search ? 45_000 : 20_000),
    });
    if (!response.ok) throw new Error(`the model answered ${String(response.status)}`);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? '';
  };
}

/** `send` behind the gateway; a refusal or a failure is null, logged without the prompt. */
export function gatewayModel(name: string, send: ModelTransport): Model {
  const registry = createPolicyRegistry({ unknownTenantRedaction: [] });
  const gateway = aiGateway({ registry, send });
  return {
    name,
    async complete(tenantId, prompt) {
      if (!registry.isLoaded(tenantId)) registry.replace(tenantId, DENIED);
      try {
        const answered = await gateway.complete(tenantId, prompt);
        if (answered.ok) return answered.value;
        logger.warn(
          { module: 'recruiting', code: answered.error.code },
          'the AI gateway refused a prompt',
        );
        return null;
      } catch {
        logger.warn({ module: 'recruiting' }, 'the model did not answer');
        return null;
      }
    },
  };
}
