import { ok } from '@kithena/domain-kit';
import { describe, expect, it } from 'vitest';

import { calendarBusy } from './calendars.js';
import type { Ctx } from './context.js';

describe('a member’s calendar (REC-135)', () => {
  it('falls back to their Google Workspace when nothing of their own is connected', async () => {
    const asked: string[] = [];
    const ctx = {
      deps: {
        workspaceCalendar: (email: string) => {
          asked.push(email);
          return Promise.resolve({
            grant: '',
            busy: () => Promise.resolve(ok([['2026-10-19T09:00:00Z', '2026-10-19T10:00:00Z']])),
            create: () => Promise.resolve(ok({ eventId: 'e', videoUrl: null })),
            cancel: () => Promise.resolve(ok(undefined)),
          });
        },
      },
      tx: {
        connections: { list: () => Promise.resolve([]) },
        members: { get: () => Promise.resolve({ workEmail: 'ada@acme.com' }) },
      },
    } as unknown as Ctx;
    expect(await calendarBusy(ctx, 'p1', '2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z')).toEqual([
      ['2026-10-19T09:00:00Z', '2026-10-19T10:00:00Z'],
    ]);
    expect(asked).toEqual(['ada@acme.com']);
  });
});
