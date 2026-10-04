import { describe, expect, it } from 'vitest';

import { ADA_ACCOUNT, caller, hr, people, TENANT, world } from '../testing/world.js';
import { chatAnswersOf, setChatAnswers } from './chat.js';

/** Assistant PRD §11.4, AST-029a: HR's switch, and the audit trail it leaves. */

describe('naming private leave in chat answers', () => {
  it('is switched by HR, and each switch is in the audit trail: who, when, which way', async () => {
    const app = world('2026-10-04T08:30:00.000Z');
    const s = app.state(TENANT);
    expect(await setChatAnswers(app.deps)(hr, { namesPrivateLeave: true })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(s.settings.get('chat_answers')).toEqual({ namesPrivateLeave: true });
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({
      eventName: 'timeoff.settings.changed',
      tenantId: TENANT,
      occurredAt: '2026-10-04T08:30:00.000Z',
      actor: { kind: 'user', userId: ADA_ACCOUNT },
      payload: { setting: 'chat_names_private_leave', value: true },
    });

    // Already on: nothing new to record. Off again: recorded.
    await setChatAnswers(app.deps)(hr, { namesPrivateLeave: true });
    await setChatAnswers(app.deps)(hr, { namesPrivateLeave: false });
    expect(s.events.map((e) => e.payload)).toEqual([
      { setting: 'chat_names_private_leave', value: true },
      { setting: 'chat_names_private_leave', value: false },
    ]);
  });

  it('is HR only, and off where nobody chose', async () => {
    const app = world();
    for (const who of [caller(people.marco), caller(people.adam)]) {
      // oxlint-disable-next-line no-await-in-loop -- two askers
      expect(await setChatAnswers(app.deps)(who, { namesPrivateLeave: true })).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
    }
    expect(app.state(TENANT).events).toEqual([]);
    const answers = await app.deps.uow.run(TENANT, (tx) => chatAnswersOf(tx));
    expect(answers).toEqual({ namesPrivateLeave: false });
  });
});
