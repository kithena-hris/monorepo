import { describe, expect, it } from 'vitest';
import { DateSpan, LeaveTypeKey } from '@kithena/contracts';

import type { ChatPort, Deps } from '../ports.js';
import { decideRequest } from '../approval/decide.js';
import { sendRequest } from '../request/request.js';
import { caller, hr, people, TENANT, world } from '../testing/world.js';
import { approveFromChat, askApproverInChat, chatStatuses } from './chat.js';
import { reachOnEvent } from './events.js';

/** A chat app that records what it was asked, and presses a button when told to. */
function recording() {
  const asked: { email: string; text: string; approve: string; decline: string }[] = [];
  const statuses: { secret: string; text: string; until: string }[] = [];
  let pressed: string | null = null;
  const replies: string[] = [];
  const port: ChatPort = {
    provider: 'slack',
    configured: true,
    connectUrl: () => 'https://slack.example/authorize',
    complete: () => Promise.resolve({ config: {}, secret: 'sealed-bot' }),
    setStatus: (_i, secret, status) => {
      statuses.push({ secret, ...status });
      return Promise.resolve();
    },
    askApproval: (_i, message) => {
      asked.push(message);
      return Promise.resolve();
    },
    action: () =>
      pressed === null
        ? null
        : {
            value: pressed,
            reply: (text) => {
              replies.push(text);
              return Promise.resolve();
            },
          },
  };
  return {
    port,
    asked,
    statuses,
    replies,
    press: (value: string | null) => {
      pressed = value;
    },
  };
}

function setup(at = '2026-10-01T07:00:00.000Z') {
  const app = world(at, { withGrant: true });
  const chat = recording();
  const deps: Deps = {
    ...app.deps,
    reach: { calendars: [], chats: [chat.port], publicUrl: 'https://to.example' },
  };
  app.state(TENANT).integrations.set('slack', {
    provider: 'slack',
    config: { name: 'Acme' },
    secret: 'sealed-bot',
    connectedAt: '2026-09-01T00:00:00.000Z' as never,
    connectedBy: hr.accountId,
  });
  const ask = async (from: string, to: string) => {
    const sent = await sendRequest(deps)(caller(people.adam), {
      leaveTypeKey: LeaveTypeKey.parse('vacation'),
      span: DateSpan.parse({ from, to }),
    });
    if (!sent.ok) throw new Error(sent.error.message);
    return sent.value.requestId;
  };
  return { app, deps, chat, ask };
}

const RAW = { headers: {}, body: '' };

describe('chat apps (TOF-111)', () => {
  it('asks the approver in a direct message, with Approve and Decline signed by Time Off', async () => {
    const { app, deps, chat, ask } = setup();
    await ask('2026-10-19', '2026-10-23');
    const requested = app
      .state(TENANT)
      .events.find((e) => e.eventName === 'timeoff.request.requested');
    const done = await reachOnEvent(deps)(requested);
    expect(done).toMatchObject({ ok: true, value: { sent: 1 } });
    expect(chat.asked).toHaveLength(1);
    const [message] = chat.asked;
    expect(message?.email).toBe('marco@acme.example');
    expect(message?.text).toBe('Adam Novak asks for Vacation, 19–23 Oct.');
    expect(message?.approve).not.toBe(message?.decline);
  });

  it('approves from the message as the approver it was sent to', async () => {
    const { app, deps, chat, ask } = setup();
    const id = await ask('2026-10-19', '2026-10-23');
    await askApproverInChat(deps)(TENANT, id);
    chat.press(chat.asked[0]?.approve ?? null);
    expect(await approveFromChat(deps)('slack', RAW)).toEqual({
      ok: true,
      value: { text: 'Approved: Adam Novak, 19–23 Oct.' },
    });
    expect(app.state(TENANT).requests.get(id)?.request.status).toBe('approved');
    expect(chat.replies).toEqual(['Approved: Adam Novak, 19–23 Oct.']);

    // Pressed again, it is refused as a request no longer waiting, and nothing changes.
    const again = await approveFromChat(deps)('slack', RAW);
    expect(again.ok && again.value.text).toMatch(/^Not done:/u);
  });

  it('refuses a press it did not sign, or one the provider did not send', async () => {
    const { deps, chat } = setup();
    chat.press('ca_forged.value');
    expect(await approveFromChat(deps)('slack', RAW)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ACTION' },
    });
    chat.press(null);
    expect(await approveFromChat(deps)('slack', RAW)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ACTION' },
    });
  });

  it('declines from the message too', async () => {
    const { app, deps, chat, ask } = setup();
    const id = await ask('2026-10-19', '2026-10-23');
    await askApproverInChat(deps)(TENANT, id);
    chat.press(chat.asked[0]?.decline ?? null);
    expect(await approveFromChat(deps)('slack', RAW)).toEqual({
      ok: true,
      value: { text: 'Declined: Adam Novak, 19–23 Oct.' },
    });
    expect(app.state(TENANT).requests.get(id)?.request.status).toBe('declined');
  });

  it('sets the status of whoever is away today and connected their chat, until their last day ends', async () => {
    const { app, deps, chat, ask } = setup();
    const id = await ask('2026-10-05', '2026-10-07');
    await decideRequest(deps)(caller(people.marco), { requestId: id, decision: 'approve' });
    app.state(TENANT).memberSecrets.set(`slack:${people.adam}`, 'sealed-adam');

    app.clock.set('2026-10-06T05:00:00.000Z');
    const done = await chatStatuses(deps)(TENANT);
    expect(done).toMatchObject({ ok: true, value: { sent: 1 } });
    // Back on Thursday the 8th: the status clears at midnight in Madrid.
    expect(chat.statuses).toEqual([
      { secret: 'sealed-adam', text: 'Out of office', until: '2026-10-07T22:00:00.000Z' },
    ]);
  });
});
