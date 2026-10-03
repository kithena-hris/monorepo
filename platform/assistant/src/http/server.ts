import { randomUUID } from 'node:crypto';

import { metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import { presentsInternalToken } from '@kithena/auth-kit';
import { AssistantQuestion, type AssistantChannel } from '@kithena/contracts';
import { logger as base, type Logger } from '@kithena/telemetry';

import type { Asked } from '../application/ask.js';

/**
 * The assistant's one route (assistant PRD §5, §12.4, §13.1):
 *
 *   POST /internal/ask   body `AssistantQuestion`, answer `AssistantAnswer`
 *   GET  /health
 *
 * A caller is a channel, known by its own token — `SLACK_ASSISTANT_TOKEN`,
 * later `TEAMS_ASSISTANT_TOKEN` — and the token, not the body, says which
 * channel the question came from. Any other caller is a 401.
 *
 * One log line per question: tenant, channel, correlation id, outcome and
 * its reason, the capabilities called, the plan's shape and how long it took.
 * Never words: not the question, not a filter, not a name, not a count.
 * A span per question carries the correlation id; the calls it makes to
 * identity, the modules and the model are its children through the HTTP
 * instrumentation. Counters by channel and outcome, and the duration.
 */

export interface Request {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

export interface Reply {
  readonly status: number;
  readonly body: unknown;
}

export interface RouteDeps {
  /** Each caller's token and the channel it speaks for. */
  readonly callers: readonly { readonly token: string; readonly channel: AssistantChannel }[];
  /** The ask use case. */
  readonly ask: (question: AssistantQuestion, correlationId: string) => Promise<Asked>;
  readonly logger?: Logger;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const tracer = trace.getTracer('kithena-assistant');
const meter = metrics.getMeter('kithena-assistant');
const questions = meter.createCounter('assistant.questions', {
  description: 'Questions, by channel, outcome and reason',
});
const duration = meter.createHistogram('assistant.question.duration', {
  description: 'From question to answer',
  unit: 'ms',
});

export function route(deps: RouteDeps): (request: Request) => Promise<Reply> {
  const log = deps.logger ?? base;
  return async (request) => {
    const path = new URL(request.url ?? '/', 'http://assistant.internal').pathname;
    if (path === '/health' && request.method === 'GET') return { status: 200, body: { ok: true } };
    if (path !== '/internal/ask') return { status: 404, body: {} };
    if (request.method !== 'POST') return { status: 405, body: {} };

    const caller = deps.callers.find((c) => presentsInternalToken(request, c.token));
    if (caller === undefined) return { status: 401, body: {} };

    let raw: unknown;
    try {
      raw = JSON.parse(request.body);
    } catch {
      raw = null;
    }
    const parsed = AssistantQuestion.safeParse(raw);
    if (!parsed.success) return { status: 400, body: { message: 'Not a question' } };
    const question = { ...parsed.data, channel: caller.channel };

    const presented = request.headers['x-correlation-id'];
    const correlationId =
      typeof presented === 'string' && UUID.test(presented) ? presented : randomUUID();

    return tracer.startActiveSpan('assistant.ask', async (span) => {
      const started = performance.now();
      span.setAttributes({
        'kithena.tenant_id': question.tenantId,
        'kithena.channel': question.channel,
        'kithena.correlation_id': correlationId,
      });
      try {
        const asked = await deps.ask(question, correlationId);
        const ms = Math.round(performance.now() - started);
        const labels = {
          channel: question.channel,
          outcome: asked.outcome,
          reason: asked.reason ?? 'none',
        };
        questions.add(1, labels);
        duration.record(ms, labels);
        span.setAttributes({ 'kithena.outcome': asked.outcome, 'kithena.reason': labels.reason });
        log.info(
          {
            tenantId: question.tenantId,
            channel: question.channel,
            correlationId,
            outcome: asked.outcome,
            reason: asked.reason,
            capabilities: asked.called,
            steps: asked.steps,
            answerKind: asked.answerKind,
            ms,
          },
          'assistant question',
        );
        return { status: 200, body: asked.answer };
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  };
}
