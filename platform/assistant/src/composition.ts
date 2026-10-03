import type { AssistantAnswer } from '@kithena/contracts';

/**
 * The assistant, wired from its settings.
 *
 * Nothing is required to start: with no model, no identity and no module
 * configured it boots, answers `/health`, and answers every question "The
 * assistant isn’t available right now." — the same as People today without a
 * key (assistant PRD §10.4, §15.4). Deploying it before its settings exist is
 * therefore safe, and Slack falls back to saying so.
 */

/** The settings the service reads. All optional; absent means "not set up here". */
export type Settings = Readonly<Record<string, string | undefined>>;

export interface Request {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
}

export interface Reply {
  readonly status: number;
  readonly body: unknown;
}

export const UNAVAILABLE = 'The assistant isn’t available right now.';

const unavailable: AssistantAnswer = {
  text: UNAVAILABLE,
  understood: 'Not sent to the assistant',
  people: [],
  answered: false,
};

export function compose(_settings: Settings): (request: Request) => Promise<Reply> {
  return (request) => {
    const path = new URL(request.url ?? '/', 'http://assistant.internal').pathname;
    // For the container's healthcheck and the deploy: up, and nothing more.
    if (path === '/health' && request.method === 'GET') {
      return Promise.resolve({ status: 200, body: { ok: true } });
    }
    if (path === '/internal/ask' && request.method === 'POST') {
      return Promise.resolve({ status: 200, body: unavailable });
    }
    return Promise.resolve({ status: 404, body: {} });
  };
}
