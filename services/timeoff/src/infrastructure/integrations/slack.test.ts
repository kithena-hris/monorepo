import { describe, expect, it } from 'vitest';

import type { Integration } from '../../application/ports.js';
import { slackThroughService } from './slack.js';

/** The Slack adapter against a fake of the Slack service; nothing is ever called. */

const env = { SLACK_URL: 'http://slack:4102/', SLACK_TIMEOFF_TOKEN: 'pair-value' };
const TENANT = '11111111-1111-4111-8111-111111111111' as never;

interface Call {
  readonly url: string;
  readonly body: string;
  readonly token: string;
}

function slackService(status = 202, answer: unknown = { sent: 'sent' }) {
  const calls: Call[] = [];
  const http = (input: string, init: RequestInit = {}): Promise<Response> => {
    calls.push({
      url: input,
      body: typeof init.body === 'string' ? init.body : '',
      token: new Headers(init.headers).get('x-internal-token') ?? '',
    });
    return Promise.resolve(new Response(JSON.stringify(answer), { status }));
  };
  return { calls, http: http as unknown as typeof fetch };
}

const workspace: Integration = {
  provider: 'slack',
  config: {},
  secret: null,
  connectedAt: '2026-09-01T00:00:00.000Z' as never,
  connectedBy: '00000000-0000-4000-8000-0000000000a1',
};

const ask = {
  tenantId: TENANT,
  email: 'marco@acme.example',
  text: 'Adam Novak asks for Vacation, 19–23 Oct.',
  approve: 'ca_yes',
  decline: 'ca_no',
};

describe('Slack, through the Slack service', () => {
  it('is inert without the service’s address and the pair’s secret, and connects at once', () => {
    expect(slackThroughService({}).configured).toBe(false);
    expect(slackThroughService({ SLACK_URL: env.SLACK_URL }).configured).toBe(false);
    const slack = slackThroughService(env);
    expect(slack.configured).toBe(true);
    expect(slack.connectUrl('s-1', 'https://to.example/cb')).toBeNull();
    expect(slack.memberGrant).toBe(false);
  });

  it('asks the approver through the service, with Time Off’s two values', async () => {
    const service = slackService();
    await slackThroughService(env, { fetch: service.http }).askApproval(workspace, ask);
    expect(service.calls).toEqual([
      {
        url: 'http://slack:4102/internal/timeoff/approval',
        body: JSON.stringify(ask),
        token: 'pair-value',
      },
    ]);
  });

  it('says why when the service could not send it', async () => {
    const service = slackService(404, {
      sent: 'not_in_slack',
      message: 'Slack has nobody at that address.',
    });
    await expect(
      slackThroughService(env, { fetch: service.http }).askApproval(workspace, ask),
    ).rejects.toThrow('Slack did not send it: Slack has nobody at that address.');
  });
});
