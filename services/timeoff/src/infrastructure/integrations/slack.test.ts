import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { Integration } from '../../application/ports.js';
import { sealer } from './seal.js';
import { slackChat } from './slack.js';

/** The Slack adapter against a fake of its documented Web API; no workspace is ever called. */

const env = {
  TIMEOFF_SLACK_CLIENT_ID: 'client-id',
  TIMEOFF_SLACK_CLIENT_SECRET: 'client-value',
  TIMEOFF_SLACK_SIGNING_SECRET: 'signing-value',
};
const NOW = 1_790_000_000_000;

interface Call {
  readonly url: string;
  readonly body: string;
  readonly auth: string;
}

function slackApi(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const http = (input: string, init: RequestInit = {}): Promise<Response> => {
    const call = {
      url: input,
      body: typeof init.body === 'string' ? init.body : '',
      auth: new Headers(init.headers).get('authorization') ?? '',
    };
    calls.push(call);
    return Promise.resolve(new Response(JSON.stringify(answer(call)), { status: 200 }));
  };
  return { calls, http: http as unknown as typeof fetch };
}

const seal = sealer(randomBytes(32));
const workspace = (secret: string): Integration => ({
  provider: 'slack',
  config: { team: 'T1', name: 'Acme' },
  secret,
  connectedAt: '2026-09-01T00:00:00.000Z' as never,
  connectedBy: '00000000-0000-4000-8000-0000000000a1',
});

/** A press as Slack sends it: form-encoded, signed with the app's signing secret. */
function press(value: string, at = NOW, secret = env.TIMEOFF_SLACK_SIGNING_SECRET) {
  const body = new URLSearchParams({
    payload: JSON.stringify({
      type: 'block_actions',
      actions: [{ value }],
      response_url: 'https://hooks.slack.com/actions/T1/1/abc',
    }),
  }).toString();
  const timestamp = String(Math.floor(at / 1000));
  const signature = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
  return {
    headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature },
    body,
  };
}

describe('Slack', () => {
  it('is inert without its app or without a key to seal its tokens', () => {
    expect(slackChat({}, seal).configured).toBe(false);
    expect(slackChat(env, null).configured).toBe(false);
    expect(slackChat(env, seal).configured).toBe(true);
  });

  it('installs with bot scopes and the person’s own status scope, and seals both tokens', async () => {
    const url = new URL(slackChat(env, seal).connectUrl('s-1', 'https://to.example/cb') ?? '');
    expect(url.searchParams.get('scope')).toBe('chat:write,users:read,users:read.email,im:write');
    expect(url.searchParams.get('user_scope')).toBe('users.profile:write');

    const api = slackApi(() => ({
      ok: true,
      access_token: 'xoxb-bot',
      team: { id: 'T1', name: 'Acme' },
      authed_user: { access_token: 'xoxp-user' },
    }));
    const done = await slackChat(env, seal, { fetch: api.http }).complete(
      { code: 'c-1' },
      'https://to.example/cb',
    );
    expect(api.calls[0]?.url).toBe('https://slack.com/api/oauth.v2.access');
    expect(api.calls[0]?.auth).toBe(
      `Basic ${Buffer.from('client-id:client-value').toString('base64')}`,
    );
    expect(done.config).toEqual({ team: 'T1', name: 'Acme' });
    expect(JSON.stringify(done)).not.toContain('xox');
    expect(seal.open(done.secret ?? '')).toBe('xoxb-bot');
    expect(seal.open(done.memberSecret ?? '')).toBe('xoxp-user');
  });

  it('asks the approver in their direct messages, with two buttons', async () => {
    const api = slackApi((c) =>
      c.url.includes('lookupByEmail') ? { ok: true, user: { id: 'U-marco' } } : { ok: true },
    );
    await slackChat(env, seal, { fetch: api.http }).askApproval(workspace(seal.seal('xoxb-bot')), {
      email: 'marco@acme.example',
      text: 'Adam Novak asks for Vacation, 19–23 Oct.',
      approve: 'ca_yes',
      decline: 'ca_no',
    });
    const [lookup, post] = api.calls;
    expect(lookup?.url).toBe(
      'https://slack.com/api/users.lookupByEmail?email=marco%40acme.example',
    );
    expect(post?.auth).toBe('Bearer xoxb-bot');
    const message = JSON.parse(post?.body ?? '{}') as {
      channel: string;
      blocks: { elements?: { value: string; action_id: string }[] }[];
    };
    expect(message.channel).toBe('U-marco');
    expect(message.blocks[1]?.elements?.map((e) => [e.action_id, e.value])).toEqual([
      ['timeoff_approve', 'ca_yes'],
      ['timeoff_decline', 'ca_no'],
    ]);
  });

  it('sets a status that Slack clears itself at the end of the last day', async () => {
    const api = slackApi(() => ({ ok: true }));
    await slackChat(env, seal, { fetch: api.http }).setStatus(
      workspace(seal.seal('xoxb-bot')),
      seal.seal('xoxp-user'),
      { text: 'Out of office', until: '2026-10-07T22:00:00.000Z' as never },
    );
    expect(api.calls[0]?.url).toBe('https://slack.com/api/users.profile.set');
    expect(api.calls[0]?.auth).toBe('Bearer xoxp-user');
    expect(JSON.parse(api.calls[0]?.body ?? '{}')).toEqual({
      profile: {
        status_text: 'Out of office',
        status_emoji: ':palm_tree:',
        status_expiration: 1_791_410_400,
      },
    });
  });

  it('takes a press only when Slack signed it, recently, and answers in its conversation', async () => {
    const api = slackApi(() => ({ ok: true }));
    const slack = slackChat(env, seal, { fetch: api.http, now: () => NOW });
    const taken = slack.action(press('ca_yes'));
    expect(taken?.value).toBe('ca_yes');
    await taken?.reply('Approved: Adam Novak, 19–23 Oct.');
    expect(api.calls[0]?.url).toBe('https://hooks.slack.com/actions/T1/1/abc');
    expect(JSON.parse(api.calls[0]?.body ?? '{}')).toEqual({
      replace_original: true,
      text: 'Approved: Adam Novak, 19–23 Oct.',
    });

    expect(slack.action(press('ca_yes', NOW, 'someone else'))).toBeNull();
    expect(slack.action(press('ca_yes', NOW - 10 * 60_000))).toBeNull();
    expect(slack.action({ headers: {}, body: 'payload=%7B%7D' })).toBeNull();
  });
});
