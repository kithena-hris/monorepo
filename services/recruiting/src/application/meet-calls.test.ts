import { CalendarDate } from '@kithena/contracts';
import { fixedClock, ok } from '@kithena/domain-kit';
import { describe, expect, it } from 'vitest';

import { memoryBlobs, memoryUnitOfWork } from '../testing/memory.js';
import { listenAtItsStart, meetCallEnded } from './background.js';
import type { CalendarSession, Deps, InterviewRecord } from './ports.js';

/**
 * A Meet interview heard as its call ends: an hour before it starts the call is
 * subscribed to and its space remembered, the booked-end timer moves two hours
 * on, and Meet's push completes it at once and asks for the scorecard.
 */
const TENANT = '00000000-0000-4000-8000-000000000001';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const INTERVIEW: InterviewRecord = {
  id: 'i1',
  applicationId: 'a1',
  planKey: 'first',
  startsAt: '2026-11-02T10:00:00.000Z',
  minutes: 45,
  interviewerIds: [ADA],
  state: 'scheduled',
  title: 'First interview',
  place: null,
  videoUrl: 'https://meet.google.com/abc-defg-hij',
};

function setup(at: string) {
  const uow = memoryUnitOfWork();
  const timers: { kind: string; at: string }[] = [];
  const spaces = new Map<string, { tenantId: string; interviewId: string }>();
  const sent: { to: string; subject: string }[] = [];
  const watched: string[] = [];
  const session = {
    grant: '',
    busy: () => Promise.resolve(ok([])),
    create: () => Promise.resolve(ok({ eventId: 'e1', videoUrl: null })),
    cancel: () => Promise.resolve(ok(undefined)),
    watchMeeting: (url: string) => {
      watched.push(url);
      return Promise.resolve(ok({ space: 'spaces/xyz' }));
    },
  } satisfies CalendarSession;
  const deps: Deps = {
    uow,
    blobs: memoryBlobs(),
    clock: fixedClock(at),
    newId: () => crypto.randomUUID(),
    jobsOrigin: 'https://jobs.example',
    extractText: () => Promise.resolve(null),
    workspaceCalendar: () => Promise.resolve(session),
    mailer: {
      send: (m) => {
        sent.push({ to: m.to, subject: m.subject });
        return Promise.resolve();
      },
    },
    interviewEnds: {
      at: (_t, _i, when) => {
        timers.push({ kind: 'ended', at: when });
        return Promise.resolve();
      },
      watch: (_t, _i, when) => {
        timers.push({ kind: 'watch', at: when });
        return Promise.resolve();
      },
      drop: () => Promise.resolve(),
    },
    meetEvents: {
      topic: 'projects/kithena/topics/recruiting-meet-events',
      remember: (space, interview) => {
        spaces.set(space, interview);
        return Promise.resolve();
      },
      recall: (space) => Promise.resolve(spaces.get(space) ?? null),
    },
  };
  return { deps, uow, timers, spaces, sent, watched };
}

async function seed(uow: ReturnType<typeof memoryUnitOfWork>) {
  await uow.run(TENANT as never, async (tx) => {
    await tx.members.upsert(
      {
        personId: ADA as never,
        accountId: null,
        displayName: 'Ada',
        workEmail: 'ada@acme.example',
        managerPersonId: null,
        teamKey: null,
        teamName: null,
        locationKey: null,
        legalEntityId: null,
        status: 'active',
      },
      'e0',
      CalendarDate.parse('2026-01-01'),
    );
    await tx.interviews.save(INTERVIEW);
    await tx.settings.set('calendar-event:i1', { personId: ADA, eventId: 'e1', meetingId: null });
  });
}

describe('a Meet interview’s call, heard as it ends', () => {
  it('is listened to an hour before, and the booked end waits two hours more', async () => {
    const { deps, uow, timers, spaces, watched } = setup('2026-11-02T09:00:00.000Z');
    await seed(uow);
    expect(await listenAtItsStart(deps, TENANT as never, 'i1')).toBe(true);
    expect(watched).toEqual(['https://meet.google.com/abc-defg-hij']);
    expect(spaces.get('spaces/xyz')).toEqual({ tenantId: TENANT, interviewId: 'i1' });
    expect(timers).toEqual([{ kind: 'ended', at: '2026-11-02T12:45:00.000Z' }]);
  });

  it('completes the moment Meet says the call ended, and asks for the scorecard', async () => {
    const early = setup('2026-11-02T09:00:00.000Z');
    await seed(early.uow);
    await listenAtItsStart(early.deps, TENANT as never, 'i1');
    // The call ends at 10:30, a quarter of an hour before its booked end.
    const at: Deps = { ...early.deps, clock: fixedClock('2026-11-02T10:30:00.000Z') };
    expect(await meetCallEnded(at, 'spaces/xyz')).toBe(true);
    const done = await early.uow.run(TENANT as never, (tx) => tx.interviews.get('i1'));
    expect(done?.state).toBe('completed');
    expect(early.sent.map((m) => m.to)).toEqual(['ada@acme.example']);
    // A second push for the same call changes nothing; a space nobody watches is nobody's.
    expect(await meetCallEnded(at, 'spaces/xyz')).toBe(false);
    expect(await meetCallEnded(at, 'spaces/other')).toBe(false);
  });
});
