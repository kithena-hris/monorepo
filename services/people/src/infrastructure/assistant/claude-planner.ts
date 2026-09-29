import Anthropic from '@anthropic-ai/sdk';
import { logger, type ModelTransport } from '@kithena/telemetry';
import * as z from 'zod';

import { SETTINGS_TOOLS } from '../../domain/assistant/settings-plan.js';

/**
 * The settings planner's model: Claude, over the Anthropic SDK, reached only
 * through the AI gateway (docs/ai-settings.md).
 *
 * - `ANTHROPIC_API_KEY`: unset, and setting up with AI is simply not offered.
 * - `SETTINGS_ASSISTANT_MODEL`: `claude-opus-5-5` by default.
 *
 * The model is offered one tool per kind of change and answers with calls;
 * nothing here runs one. Each call is recorded and answered "proposed, not
 * applied", and the loop goes on until the model calls `finish_plan` or stops
 * — a few turns at most. What comes back to People is the calls, as JSON,
 * which the application layer reads strictly and never trusts.
 *
 * **Caching.** The tools and the instruction are the same for every company
 * and every request, so the one breakpoint sits on the instruction: tools
 * then system are the cached prefix, and the settings and the request, which
 * vary, come after it in the user's turn.
 *
 * Forced tool choice is refused by this model, so the choice is `auto` and
 * the instruction says to use the tools. Thinking is always on; effort is set
 * explicitly (`medium`), and a refused request falls back server-side.
 * Streamed, because a whole company's settings is a long answer.
 */

const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_TURNS = 4;

export interface ClaudePlannerConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
}

export function claudePlannerConfigFrom(env: NodeJS.ProcessEnv): ClaudePlannerConfig | null {
  const apiKey = env['ANTHROPIC_API_KEY'];
  if (apiKey === undefined || apiKey === '') {
    logger.info('ANTHROPIC_API_KEY unset; setting up with AI is not available');
    return null;
  }
  return { apiKey, model: env['SETTINGS_ASSISTANT_MODEL'] ?? DEFAULT_MODEL };
}

/** The tools as the API takes them, from the same Zod the plan is read with. */
export const PLANNER_TOOLS: Anthropic.Beta.BetaTool[] = SETTINGS_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: z.toJSONSchema(tool.input, {
    io: 'input',
    unrepresentable: 'any',
  }) as Anthropic.Beta.BetaTool.InputSchema,
  // Streamed as generated; the application validates every input anyway.
  eager_input_streaming: true,
}));

export function claudeSettingsModel(
  config: ClaudePlannerConfig,
  client?: Anthropic,
): ModelTransport {
  const anthropic =
    client ?? new Anthropic({ apiKey: config.apiKey, timeout: config.timeoutMs ?? 180_000 });
  return async (prompt) => {
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: 'user', content: JSON.stringify(prompt.context) },
    ];
    const calls: { name: string; input: unknown }[] = [];
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      // One turn at a time: the next depends on this one's calls.

      const message = await anthropic.beta.messages
        .stream({
          model: config.model,
          max_tokens: 64_000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium' },
          system: [
            { type: 'text', text: prompt.instruction, cache_control: { type: 'ephemeral' } },
          ],
          tools: PLANNER_TOOLS,
          tool_choice: { type: 'auto' },
          messages,
        })
        .finalMessage();
      if (message.stop_reason === 'refusal') throw new Error('the model declined the request');
      if (message.stop_reason === 'max_tokens')
        throw new Error('the plan was too long for one answer');
      const uses = message.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      );
      calls.push(...uses.map((u) => ({ name: u.name, input: u.input })));
      logger.debug(
        {
          calls: uses.length,
          cacheRead: message.usage.cache_read_input_tokens,
          cacheWrite: message.usage.cache_creation_input_tokens,
        },
        'settings plan turn',
      );
      if (uses.length === 0 || uses.some((u) => u.name === 'finish_plan')) break;
      messages.push(
        { role: 'assistant', content: message.content },
        {
          role: 'user',
          content: uses.map((u) => ({
            type: 'tool_result' as const,
            tool_use_id: u.id,
            content:
              'Recorded as a proposal. Nothing is applied until the administrator reviews it. Propose anything still missing, then call finish_plan.',
          })),
        },
      );
    }
    return JSON.stringify({ calls });
  };
}
