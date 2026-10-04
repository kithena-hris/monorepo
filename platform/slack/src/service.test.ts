import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { signState } from './secrets.js';
import { slackService, type Assistant, type People, type Slack, type TimeOff } from './service.js';
import { memoryStore } from './store.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function world(answers: Partial<Record<string, unknown>> = {}) {
  const store = memoryStore();
  const posted: { channel: string; text: string; blocks: readonly unknown[] }[] = [];
  const replaced: { text: string }[] = [];
  const acted: Record<string, unknown>[] = [];
  /** Every answer, by the call that carried it. */
  const said: { via: string; m: Record<string, unknown> }[] = [];
  const slack: Slack = {
    emailOf: () => Promise.resolve('pam@acme.example'),
    userByEmail: (_t, email) => Promise.resolve(email === 'pam@acme.example' ? 'U1' : null),
    postBlocks: (_t, m) => {
      posted.push(m);
      return Promise.resolve();
    },
    postMessage: (_t, m) => {
      said.push({ via: 'postMessage', m });
      return Promise.resolve();
    },
    postEphemeral: (_t, m) => {
      said.push({ via: 'postEphemeral', m });
      return Promise.resolve();
    },
    respond: (url, text) => {
      said.push({ via: 'respond', m: { url, text } });
      return Promise.resolve();
    },
    replaceMessage: (_u, m) => {
      replaced.push(m);
      return Promise.resolve();
    },
    openView: () => Promise.resolve('V1'),
    updateView: () => Promise.resolve(),
    exchangeCode: () =>
      Promise.resolve({ botToken: 'xoxb-new', teamId: 'T2', teamName: 'Acme', botUserId: 'B1' }),
    revoke: () => Promise.resolve(),
  };
  const asked: { tenantId: string; email: string; question: string }[] = [];
  const assistant: Assistant = {
    ask: (tenantId, email, question) => {
      asked.push({ tenantId, email, question });
      return question === 'down'
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve({ text: '3 people are off today.', understood: 'Away today' });
    },
  };
  const people: People = {
    act: (_t, _e, action) => {
      acted.push(action);
      const answer = answers[String(action['action'])];
      return Promise.resolve((answer ?? { ok: true, body: { items: [] } }) as never);
    },
  };
  const relayed: { tenantId: string; value: string }[] = [];
  const timeOff: TimeOff = {
    relay: (tenantId, value) => {
      relayed.push({ tenantId, value });
      return value === 'down'
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve({ text: 'Approved: Adam Novak, 19–23 Oct.' });
    },
  };
  const secret = randomBytes(32);
  const service = slackService({
    store,
    people,
    assistant,
    timeOff,
    slack,
    command: '/kithena',
    now: () => 1_000,
    oauth: {
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'https://auth/slack/done',
      stateSecret: secret,
    },
  });
  return { store, service, posted, replaced, acted, relayed, said, asked, secret };
}

const connect = (store: ReturnType<typeof memoryStore>, tenantId = TENANT, teamId = 'T1') =>
  store.install({
    tenantId,
    teamId,
    teamName: 'Dunder',
    botUserId: 'B',
    botToken: 'xoxb',
    installedBy: null,
    installedAt: '2026-09-27T00:00:00Z',
  });

describe('notify', () => {
  it('sends to the person in the company’s own workspace, and says why when it cannot', async () => {
    const w = world();
    const notice = {
      event: 'profile_reminder' as const,
      email: 'pam@acme.example',
      url: 'https://acme/people',
      count: 2,
    };
    expect(await w.service.notify(TENANT, notice)).toBe('not_connected');
    await connect(w.store);
    expect(await w.service.notify(TENANT, notice)).toBe('sent');
    expect(w.posted[0]?.channel).toBe('U1');
    expect(await w.service.notify(TENANT, { ...notice, email: 'nobody@acme.example' })).toBe(
      'not_in_slack',
    );
    expect(await w.service.notify(OTHER, notice)).toBe('not_connected');
  });

  it('asks Time Off’s approver with Time Off’s own values on the buttons', async () => {
    const w = world();
    const ask = {
      email: 'pam@acme.example',
      text: 'Adam asks for Vacation, 19–23 Oct.',
      approve: 'ca_a',
      decline: 'ca_d',
    };
    expect(await w.service.askTimeOff(TENANT, ask)).toBe('not_connected');
    await connect(w.store);
    expect(await w.service.askTimeOff(TENANT, { ...ask, email: 'nobody@acme.example' })).toBe(
      'not_in_slack',
    );
    expect(await w.service.askTimeOff(TENANT, ask)).toBe('sent');
    const sent = JSON.stringify(w.posted[0]);
    expect(w.posted[0]?.channel).toBe('U1');
    expect(sent).toContain('"action_id":"timeoff_approve","style":"primary"');
    expect(sent).toContain('"value":"ca_a"');
    expect(sent).toContain('"action_id":"timeoff_decline","style":"danger"');
    expect(sent).toContain('"value":"ca_d"');
  });
});

describe('a question', () => {
  const ask = (
    text: string,
    reply: Parameters<ReturnType<typeof world>['service']['question']>[0]['reply'],
  ) => ({
    team: 'T1',
    user: 'U7',
    text,
    reply,
  });

  it('is asked of the assistant as the asker, and a slash command is answered through its response URL', async () => {
    const w = world();
    await connect(w.store);
    await w.service.question(
      ask('who is off today?', { via: 'response_url', url: 'https://hooks/c' }),
    );
    expect(w.asked).toEqual([
      { tenantId: TENANT, email: 'pam@acme.example', question: 'who is off today?' },
    ]);
    expect(w.said).toEqual([
      { via: 'respond', m: { url: 'https://hooks/c', text: '3 people are off today.' } },
    ]);
  });

  it('answers a direct message in the conversation', async () => {
    const w = world();
    await connect(w.store);
    await w.service.question(ask('who is off today?', { via: 'channel', channel: 'D1' }));
    expect(w.said).toEqual([
      { via: 'postMessage', m: { channel: 'D1', text: '3 people are off today.' } },
    ]);
  });

  it('answers a mention to the asker alone, in its thread', async () => {
    const w = world();
    await connect(w.store);
    await w.service.question(
      ask('who is off today?', { via: 'thread', channel: 'C1', threadTs: '1.2' }),
    );
    expect(w.said).toEqual([
      {
        via: 'postEphemeral',
        m: { channel: 'C1', user: 'U7', text: '3 people are off today.', threadTs: '1.2' },
      },
    ]);
  });

  it('says sorry when the assistant cannot be reached, and helps when asked nothing', async () => {
    const w = world();
    await connect(w.store);
    await w.service.question(ask('down', { via: 'channel', channel: 'D1' }));
    await w.service.question(ask('', { via: 'channel', channel: 'D1' }));
    expect(w.said[0]?.m['text']).toBe('Kithena could not do that just now. Try again in a moment.');
    expect(w.said[1]?.m['text']).toMatch(/^Ask me about the people in your company/);
    expect(w.asked).toHaveLength(1);
  });

  it('is not answered for a workspace no company connected', async () => {
    const w = world();
    await w.service.question(ask('who is off today?', { via: 'channel', channel: 'D1' }));
    expect(w.asked).toEqual([]);
    expect(w.said).toEqual([]);
  });
});

describe('a button', () => {
  it('approves as whoever pressed it, and redraws what is left', async () => {
    const w = world({
      approvals: {
        ok: true,
        body: {
          items: [
            {
              id: 'c1',
              name: 'Pam',
              label: 'Phone',
              from: 'a',
              to: 'b',
              requestedBy: 'Jim',
              reason: null,
              effectiveFrom: '2026-10-01',
            },
          ],
        },
      },
      decide: { ok: true, body: {} },
    });
    await connect(w.store);
    await w.service.interact({
      type: 'block_actions',
      team: { id: 'T1' },
      user: { id: 'U1' },
      response_url: 'https://hooks/r',
      actions: [{ action_id: 'approve', value: 'c1' }],
      message: {
        blocks: [
          { type: 'actions', elements: [{ action_id: 'open', url: 'https://acme/approvals' }] },
        ],
      },
    });
    expect(w.acted).toContainEqual({ action: 'decide', id: 'c1', approve: true });
    expect(w.replaced[0]?.text).toMatch(/^:white_check_mark: You approved Pam’s Phone\./);
  });

  it('does nothing for a workspace no company connected', async () => {
    const w = world();
    await w.service.interact({
      type: 'block_actions',
      team: { id: 'T9' },
      user: { id: 'U1' },
      actions: [{ action_id: 'approve', value: 'c1' }],
    });
    expect(w.acted).toEqual([]);
  });

  it('passes Time Off’s press to Time Off as the workspace’s company, and shows its answer', async () => {
    const w = world();
    await connect(w.store);
    const press = (value: string) =>
      w.service.interact({
        type: 'block_actions',
        team: { id: 'T1' },
        user: { id: 'U1' },
        response_url: 'https://hooks/r',
        actions: [{ action_id: 'timeoff_approve', value }],
      });
    await press('ca_signed');
    expect(w.relayed).toEqual([{ tenantId: TENANT, value: 'ca_signed' }]);
    expect(w.replaced[0]?.text).toBe('Approved: Adam Novak, 19–23 Oct.');
    expect(w.acted).toEqual([]);

    await press('down');
    expect(w.replaced[1]?.text).toBe(
      'Time Off could not take that just now. Try again in a moment.',
    );
  });

  it('never passes a press from a workspace no company connected', async () => {
    const w = world();
    await w.service.interact({
      type: 'block_actions',
      team: { id: 'T9' },
      actions: [{ action_id: 'timeoff_decline', value: 'ca_signed' }],
    });
    expect(w.relayed).toEqual([]);
  });
});

describe('a form', () => {
  it('puts People’s refusal on the field it is about', async () => {
    const w = world({ fill: { ok: false, message: 'Not a phone number', field: 'phone' } });
    await connect(w.store);
    const answer = await w.service.interact({
      type: 'view_submission',
      team: { id: 'T1' },
      user: { id: 'U1' },
      view: {
        callback_id: 'fill',
        state: { values: { phone: { value: { value: 'x' } as never } } },
      },
    });
    expect(answer).toEqual({ response_action: 'errors', errors: { phone: 'Not a phone number' } });
  });
});

describe('connecting', () => {
  it('keeps the workspace for the company that started it, and nobody else', async () => {
    const w = world();
    const state = signState(w.secret, { t: TENANT, a: 'admin', o: 'https://acme' }, 1_000);
    expect((await w.service.complete(OTHER, 'code', state)).ok).toBe(false);
    const done = await w.service.complete(TENANT, 'code', state);
    expect(done.ok && done.body.teamName).toBe('Acme');
    expect((await w.store.installation(TENANT))?.installedBy).toBe('admin');

    const theirs = signState(w.secret, { t: OTHER, a: 'x', o: 'https://other' }, 1_000);
    const second = await w.service.complete(OTHER, 'code', theirs);
    expect(second.ok ? '' : second.message).toMatch(/already connected to another company/);
  });

  it('asks Slack for exactly the scopes the manifest lists', async () => {
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(
      await readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
    ) as {
      oauth_config: { scopes: { bot: string[] } };
    };
    const url = new URL(world().service.authorizeUrl(TENANT, 'a', 'https://acme') ?? '');
    expect(url.searchParams.get('scope')?.split(',')).toEqual(manifest.oauth_config.scopes.bot);
  });
});
