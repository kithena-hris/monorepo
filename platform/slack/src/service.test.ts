import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { signState } from './secrets.js';
import {
  conversations,
  slackService,
  type Assistant,
  type People,
  type Slack,
  type TimeOff,
} from './service.js';
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
  const asked: {
    tenantId: string;
    email: string;
    question: string;
    earlier: readonly string[];
  }[] = [];
  const assistant: Assistant = {
    ask: (tenantId, email, question, earlier) => {
      asked.push({ tenantId, email, question, earlier });
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
  const clock = { ms: 1_000 };
  const service = slackService({
    store,
    people,
    assistant,
    timeOff,
    slack,
    command: '/kithena',
    now: () => clock.ms,
    oauth: {
      clientId: 'c',
      clientSecret: 's',
      redirectUri: 'https://auth/slack/done',
      stateSecret: secret,
    },
  });
  return { store, service, posted, replaced, acted, relayed, said, asked, secret, clock };
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
      { tenantId: TENANT, email: 'pam@acme.example', question: 'who is off today?', earlier: [] },
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

describe('a follow-up', () => {
  const dm = (text: string, user = 'U7') => ({
    team: 'T1',
    user,
    text,
    reply: { via: 'channel' as const, channel: 'D1' },
  });
  const inThread = (text: string, user = 'U7', threadTs = '1.2') => ({
    team: 'T1',
    user,
    text,
    reply: { via: 'thread' as const, channel: 'C1', threadTs },
  });
  const earlier = (w: ReturnType<typeof world>) => w.asked.map((a) => a.earlier);

  it('carries the earlier questions of a direct message, oldest first, never an answer', async () => {
    const w = world();
    await connect(w.store);
    await w.service.question(dm('who’s off today?'));
    await w.service.question(dm('and tomorrow?'));
    expect(w.asked[1]).toMatchObject({
      question: 'and tomorrow?',
      earlier: ['who’s off today?'],
    });
    expect(JSON.stringify(w.asked)).not.toContain('3 people are off today.');
  });

  it('keeps the last five, for thirty minutes from each', async () => {
    const w = world();
    await connect(w.store);
    for (const n of [1, 2, 3, 4, 5, 6]) {
      // oxlint-disable-next-line no-await-in-loop -- one after another is the conversation
      await w.service.question(dm(`q${String(n)}`));
    }
    await w.service.question(dm('q7'));
    expect(earlier(w).at(-1)).toEqual(['q2', 'q3', 'q4', 'q5', 'q6']);
    w.clock.ms += 30 * 60_000 - 1;
    await w.service.question(dm('q8'));
    expect(earlier(w).at(-1)).toEqual(['q3', 'q4', 'q5', 'q6', 'q7']);
    w.clock.ms += 1;
    await w.service.question(dm('q9'));
    expect(earlier(w).at(-1)).toEqual(['q8']);
  });

  it('keeps a thread to itself and to the person asking; a slash command has no conversation', async () => {
    const w = world();
    await connect(w.store);
    await w.service.question(inThread('who’s off today?'));
    await w.service.question(inThread('and tomorrow?', 'U8'));
    await w.service.question(inThread('and tomorrow?', 'U7', '3.4'));
    await w.service.question(dm('and tomorrow?'));
    await w.service.question(inThread('and Friday?'));
    const slash = { via: 'response_url' as const, url: 'https://hooks/c' };
    await w.service.question({ team: 'T1', user: 'U7', text: 'who is off?', reply: slash });
    await w.service.question({ team: 'T1', user: 'U7', text: 'and tomorrow?', reply: slash });
    expect(earlier(w)).toEqual([[], [], [], [], ['who’s off today?'], [], []]);
  });
});

describe('the conversations kept', () => {
  it('forget the one asked in longest ago beyond the most it keeps, and expire on their own', () => {
    let ms = 0;
    const kept = conversations(() => ms, 2);
    kept.remember('a', 'one');
    kept.remember('b', 'two');
    kept.remember('a', 'three');
    kept.remember('c', 'four');
    expect(kept.remember('b', 'five')).toEqual([]);
    expect(kept.remember('a', 'six')).toEqual([]);
    expect(kept.size()).toBe(2);
    ms += 30 * 60_000;
    kept.remember('d', 'seven');
    expect(kept.size()).toBe(1);
  });

  it('cut a question longer than the assistant takes to its length', () => {
    const kept = conversations(() => 0);
    kept.remember('a', 'x'.repeat(600));
    expect(kept.remember('a', 'y')).toEqual(['x'.repeat(500)]);
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
