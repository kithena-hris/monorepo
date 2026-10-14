import { logger } from '@kithena/telemetry';

import type { Reader } from '../application/ports.js';

/**
 * The model that reads documents: the assistant's OpenAI-compatible endpoint
 * (`ASSISTANT_BASE_URL`, `ASSISTANT_API_KEY`, `ASSISTANT_MODEL`), Time Off's
 * transport. Not through the AI gateway, whose free-text rule refuses exactly
 * what Documents must send: the decision and its limits are in
 * `docs/tech-stack.md`, "Documents", and enforced in `application/ai.ts`.
 */

const GROQ = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
/** A model on the same endpoint that sees: a scan's or a photo's words (`ASSISTANT_VISION_MODEL`). */
const DEFAULT_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

export function readerFrom(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Reader | undefined {
  const baseUrl = (env['ASSISTANT_BASE_URL'] ?? GROQ).replace(/\/$/u, '');
  const apiKey = env['ASSISTANT_API_KEY']?.trim() || null;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/u.test(baseUrl);
  if (apiKey === null && !local) {
    logger.info({ module: 'documents' }, 'ASSISTANT_API_KEY unset; Kithena reads no documents');
    return undefined;
  }
  const model = env['ASSISTANT_MODEL'] ?? DEFAULT_MODEL;
  const vision = env['ASSISTANT_VISION_MODEL'] ?? DEFAULT_VISION_MODEL;
  const headers = {
    'content-type': 'application/json',
    ...(apiKey === null ? {} : { authorization: `Bearer ${apiKey}` }),
  };
  return {
    async see({ instruction, image }) {
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: vision,
            temperature: 0,
            max_tokens: 2000,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: instruction },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString('base64')}`,
                    },
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
        const text = body.choices?.[0]?.message?.content ?? '';
        return text.trim() === '' ? null : text;
      } catch {
        return null;
      }
    },
    async read({ instruction, context, maxTokens = 1500 }) {
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: maxTokens,
            ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: instruction },
              { role: 'user', content: JSON.stringify(context) },
            ],
          }),
          signal: AbortSignal.timeout(maxTokens > 1500 ? 45_000 : 20_000),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
        const parsed: unknown = JSON.parse(body.choices?.[0]?.message?.content ?? '');
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    },
  };
}
