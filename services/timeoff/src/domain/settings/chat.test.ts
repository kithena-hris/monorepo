import { describe, expect, it } from 'vitest';
import { EventEnvelope, SettingsChanged } from '@kithena/contracts';

import { context, TENANT } from '../fixtures.js';
import { DEFAULT_CHAT_ANSWERS, switchChatNames } from './chat.js';

/** Assistant PRD §11.4: a company's choice to name people on private leave in chat answers. */

describe('naming private leave in chat answers (AST-029a)', () => {
  it('is off until somebody switches it on', () => {
    expect(DEFAULT_CHAT_ANSWERS).toEqual({ namesPrivateLeave: false });
  });

  it('records who switched it, when, and which way', () => {
    const ctx = context('2026-10-04T08:30:00.000Z');
    const switched = switchChatNames(ctx, TENANT, DEFAULT_CHAT_ANSWERS, true);
    expect(switched?.setting).toEqual({ namesPrivateLeave: true });
    const event = switched?.event;
    expect(EventEnvelope.omit({ recordedAt: true }).parse(event)).toMatchObject({
      eventName: 'timeoff.settings.changed',
      eventVersion: 1,
      tenantId: TENANT,
      occurredAt: '2026-10-04T08:30:00.000Z',
      effectiveFrom: null,
      actor: { kind: 'user', userId: '66666666-6666-7666-8666-666666666666' },
    });
    expect(SettingsChanged.payload.parse(event?.payload)).toEqual({
      setting: 'chat_names_private_leave',
      value: true,
    });

    const off = switchChatNames(context(), TENANT, { namesPrivateLeave: true }, false);
    expect(off?.setting).toEqual({ namesPrivateLeave: false });
    expect(off?.event.payload).toEqual({ setting: 'chat_names_private_leave', value: false });
  });

  it('records nothing when it is already that way', () => {
    expect(switchChatNames(context(), TENANT, DEFAULT_CHAT_ANSWERS, false)).toBeNull();
    expect(switchChatNames(context(), TENANT, { namesPrivateLeave: true }, true)).toBeNull();
  });
});
