import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { signState } from './secrets.js';
import { slackService, type People, type Slack } from './service.js';
import { memoryStore } from './store.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function world(answers: Partial<Record<string, unknown>> = {}) {
  const store = memoryStore();
  const posted: { channel: string; text: string; blocks: readonly unknown[] }[] = [];
  const replaced: { text: string }[] = [];
  const acted: Record<string, unknown>[] = [];
  const slack: Slack = {
    emailOf: () => Promise.resolve('pam@acme.example'),
    userByEmail: (_t, email) => Promise.resolve(email === 'pam@acme.example' ? 'U1' : null),
    postBlocks: (_t, m) => {
      posted.push(m);
      return Promise.resolve();
    },
    postMessage: () => Promise.resolve(),
    respond: () => Promise.resolve(),
    replaceMessage: (_u, m) => {
      replaced.push(m);
      return Promise.resolve();
    },
    openView: () => Promise.resolve('V1'),
    updateView: () => Promise.resolve(),
    exchangeCode: () => Promise.resolve({ botToken: 'xoxb-new', teamId: 'T2', teamName: 'Acme', botUserId: 'B1' }),
    revoke: () => Promise.resolve(),
  };
  const people: People = {
    ask: () => Promise.resolve(null),
    act: (_t, _e, action) => {
      acted.push(action);
      const answer = answers[String(action['action'])];
      return Promise.resolve((answer ?? { ok: true, body: { items: [] } }) as never);
    },
  };
  const secret = randomBytes(32);
  const service = slackService({
    store,
    people,
    slack,
    command: '/kithena',
    now: () => 1_000,
    oauth: { clientId: 'c', clientSecret: 's', redirectUri: 'https://auth/slack/done', stateSecret: secret },
  });
  return { store, service, posted, replaced, acted, secret };
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
    const notice = { event: 'profile_reminder' as const, email: 'pam@acme.example', url: 'https://acme/people', count: 2 };
    expect(await w.service.notify(TENANT, notice)).toBe('not_connected');
    await connect(w.store);
    expect(await w.service.notify(TENANT, notice)).toBe('sent');
    expect(w.posted[0]?.channel).toBe('U1');
    expect(await w.service.notify(TENANT, { ...notice, email: 'nobody@acme.example' })).toBe('not_in_slack');
    expect(await w.service.notify(OTHER, notice)).toBe('not_connected');
  });
});

describe('a button', () => {
  it('approves as whoever pressed it, and redraws what is left', async () => {
    const w = world({
      approvals: { ok: true, body: { items: [{ id: 'c1', name: 'Pam', label: 'Phone', from: 'a', to: 'b', requestedBy: 'Jim', reason: null, effectiveFrom: '2026-10-01' }] } },
      decide: { ok: true, body: {} },
    });
    await connect(w.store);
    await w.service.interact({
      type: 'block_actions',
      team: { id: 'T1' },
      user: { id: 'U1' },
      response_url: 'https://hooks/r',
      actions: [{ action_id: 'approve', value: 'c1' }],
      message: { blocks: [{ type: 'actions', elements: [{ action_id: 'open', url: 'https://acme/approvals' }] }] },
    });
    expect(w.acted).toContainEqual({ action: 'decide', id: 'c1', approve: true });
    expect(w.replaced[0]?.text).toMatch(/^:white_check_mark: You approved Pam’s Phone\./);
  });

  it('does nothing for a workspace no company connected', async () => {
    const w = world();
    await w.service.interact({ type: 'block_actions', team: { id: 'T9' }, user: { id: 'U1' }, actions: [{ action_id: 'approve', value: 'c1' }] });
    expect(w.acted).toEqual([]);
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
      view: { callback_id: 'fill', state: { values: { phone: { value: { value: 'x' } as never } } } },
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
    const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8')) as {
      oauth_config: { scopes: { bot: string[] } };
    };
    const url = new URL(world().service.authorizeUrl(TENANT, 'a', 'https://acme') ?? '');
    expect(url.searchParams.get('scope')?.split(',')).toEqual(manifest.oauth_config.scopes.bot);
  });
});
