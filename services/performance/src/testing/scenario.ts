import { randomUUID } from 'node:crypto';
import { TenantId, type CalendarDate } from '@kithena/contracts';
import { ok, type Clock } from '@kithena/domain-kit';
import { expect } from 'vitest';

import type { UnitOfWork } from '../application/ports.js';
import type { CallerFrom } from '../http/caller.js';
import { performanceServer } from '../http/server.js';
import { inProcessLive } from '../infrastructure/live.js';

/**
 * One cycle end to end with every review activity (PRD §3 validation,
 * PRF-099), through REST as each person, with People and Onboarding absent:
 * members arrive by the import. Setup, launch, nominations and approval,
 * writing with a stale revision refused, submit, an unlock HR decides,
 * release and acknowledgement with private questions absent, feedback and
 * undo, a goal check-in, calibration with `rating.finalized`, and close.
 * Shared by the standalone suite (memory) and the integration suite.
 */

export interface Harness {
  readonly uow: UnitOfWork;
  readonly events: (
    tenantId: string,
  ) => Promise<readonly { eventName: string; payload: unknown }[]>;
}

const TODAY = '2026-10-17';
const clock: Clock = {
  now: () => new Date(`${TODAY}T08:00:00.000Z`),
  today: () => TODAY,
  date: () => TODAY as CalendarDate,
  instant: () => `${TODAY}T08:00:00.000Z` as never,
};

export async function oneCycle(h: Harness): Promise<void> {
  const tenantId = TenantId.parse(randomUUID());
  const ids = Object.fromEntries(
    ['ada', 'nora', 'marco', 'adam', 'omar', 'priya'].map((n) => [
      n,
      { account: randomUUID(), person: randomUUID() },
    ]),
  ) as Record<
    'ada' | 'nora' | 'marco' | 'adam' | 'omar' | 'priya',
    { account: string; person: string }
  >;
  const callerFrom: CallerFrom = (request) => {
    const who = request.headers['x-who'];
    return ok({
      tenantId,
      accountId: typeof who === 'string' ? who : 'nobody',
      personId: null,
      correlationId: randomUUID(),
    });
  };
  const withMember: CallerFrom = async (request) => {
    const asked = await callerFrom(request);
    if (!asked.ok) return asked;
    const m = await h.uow.run(tenantId, (tx) => tx.members.byAccount(asked.value.accountId));
    return ok({ ...asked.value, personId: m?.personId ?? null });
  };
  const { rest } = performanceServer(
    { uow: h.uow, live: inProcessLive(), callerFrom: withMember, clock },
    randomUUID,
  );
  const call = async (who: keyof typeof ids, method: string, path: string, body?: unknown) => {
    const answer = await rest({
      method,
      url: `/v1/performance${path}`,
      headers: { 'x-who': ids[who].account, 'idempotency-key': randomUUID() },
      body: body === undefined ? '' : JSON.stringify(body),
    });
    if (answer === null) throw new Error(`no route ${path}`);
    return answer;
  };
  const data = async <T = Record<string, unknown>>(
    who: keyof typeof ids,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const answer = await call(who, method, path, body);
    if (answer.status >= 400)
      throw new Error(`${method} ${path} as ${who}: ${JSON.stringify(answer.body)}`);
    return answer.body as T;
  };

  // HR is named by the back office; the people arrive by the import.
  await h.uow.run(tenantId, (tx) => tx.admins.add(ids.ada.account));
  const member = (n: keyof typeof ids, manager: keyof typeof ids | null, title: string) => ({
    personId: ids[n].person,
    accountId: ids[n].account,
    displayName: `${n.charAt(0).toUpperCase()}${n.slice(1)}`,
    workEmail: `${n}@acme.example`,
    managerPersonId: manager === null ? null : ids[manager].person,
    status: 'active',
    title,
    department: n === 'ada' ? 'People' : n === 'nora' ? 'Leadership' : 'Engineering',
    hiredOn: '2024-01-15',
  });
  await data('ada', 'POST', '/members/import', {
    members: [
      member('ada', null, 'HR admin'),
      member('nora', null, 'Chief executive'),
      member('marco', 'nora', 'Engineering manager'),
      member('adam', 'marco', 'Backend engineer'),
      member('omar', 'marco', 'Frontend engineer'),
      member('priya', 'marco', 'Recruiter'),
    ],
  });

  // Templates arrive seeded and published.
  const templates = await data<{ rows: { id: string; name: string; state: string }[] }>(
    'ada',
    'GET',
    '/templates',
  );
  expect(templates.rows.map((t) => t.name)).toContain('Manager review, standard');
  expect(templates.rows.every((t) => t.state === 'Published')).toBe(true);

  // A cycle starting today launches; Engineering is in it.
  const { id: cycleId } = await data<{ id: string }>('ada', 'POST', '/cycles', {
    name: 'H2 2026 performance review',
    start: TODAY,
    copyFrom: null,
  });
  const setup = await data<{ cycle: { activities: Record<string, unknown> }; action: string }>(
    'ada',
    'GET',
    `/cycles/${cycleId}/setup`,
  );
  expect(setup.action).toBe('launch');
  await data('ada', 'PATCH', `/cycles/${cycleId}`, {
    participants: {
      filter: [{ field: 'department', value: 'Engineering' }],
      include: [],
      exclude: [],
      keepInStep: true,
    },
  });
  expect((await data<{ state: string }>('ada', 'POST', `/cycles/${cycleId}/start`)).state).toBe(
    'launching',
  );
  let state = '';
  for (let i = 0; i < 200 && state !== 'in_progress'; i += 1) {
    state = (await data<{ cycle: { state: string } }>('ada', 'GET', `/cycles/${cycleId}`)).cycle
      .state;
    if (state !== 'in_progress') await new Promise((r) => setTimeout(r, 10));
  }
  expect(state).toBe('in_progress');

  // Adam nominates two peers; Marco approves; their reviews appear.
  const mine = await data<{
    nominations: { id: string; kind: string }[];
    rows: { id: string; kind: string }[];
  }>('adam', 'GET', '/reviews?tab=write');
  const nomination = mine.nominations.find((n) => n.kind === 'nominate');
  if (nomination === undefined) throw new Error('no nomination for Adam');
  const picker = await data<{ team: { personId: string }[] }>(
    'adam',
    'GET',
    `/nominations/${nomination.id}`,
  );
  expect(picker.team.map((p) => p.personId).toSorted()).toEqual(
    [ids.omar.person, ids.priya.person].toSorted(),
  );
  expect(
    (
      await call('adam', 'POST', `/nominations/${nomination.id}`, {
        people: [ids.adam.person, ids.omar.person],
        note: null,
      })
    ).status,
  ).toBe(422);
  await data('adam', 'POST', `/nominations/${nomination.id}`, {
    people: [ids.omar.person, ids.priya.person],
    note: 'Both on the ledger work',
  });
  await data('marco', 'POST', `/nominations/${nomination.id}/decide`, {
    decisions: [],
    replacements: [],
  });

  // Adam writes his self review; a stale save is refused.
  const self = mine.rows.find((r) => r.kind === 'self');
  if (self === undefined) throw new Error('no self review');
  const page = await data<{
    review: { revision: number };
    form: { sections: { questions: { id: string; type: string }[] }[] };
  }>('adam', 'GET', `/reviews/${self.id}`);
  const answer = (form: {
    sections: { questions: { id: string; type: string; options?: unknown }[] }[];
  }) => {
    const out: Record<string, { value: unknown; comment: null }> = {};
    for (const q of form.sections.flatMap((s) => s.questions)) {
      if (q.type === 'text')
        out[q.id] = { value: '<p>Shipped the ledger migration.</p>', comment: null };
      if (q.type === 'scale') out[q.id] = { value: 4, comment: null };
      if (q.type === 'binary') out[q.id] = { value: true, comment: null };
      if (q.type === 'choice')
        out[q.id] = {
          value: [(q.options as { id: string }[] | undefined)?.[0]?.id ?? ''],
          comment: null,
        };
    }
    return out;
  };
  await data('adam', 'PATCH', `/reviews/${self.id}/answers`, {
    revision: page.review.revision,
    answers: answer(page.form),
  });
  expect(
    (
      await call('adam', 'PATCH', `/reviews/${self.id}/answers`, {
        revision: page.review.revision,
        answers: {},
      })
    ).status,
  ).toBe(409);
  await data('adam', 'POST', `/reviews/${self.id}/submit`, { confidential: null, confirm: [] });

  // The two peers write theirs.
  for (const peer of ['omar', 'priya'] as const) {
    const list = await data<{ rows: { id: string; kind: string; subjectId: string }[] }>(
      peer,
      'GET',
      '/reviews?tab=write',
    );
    const r = list.rows.find((x) => x.kind === 'peer' && x.subjectId === ids.adam.person);
    if (r === undefined) throw new Error(`no peer review for ${peer}`);
    const p = await data<{
      review: { revision: number };
      form: { sections: { questions: { id: string; type: string }[] }[] };
    }>(peer, 'GET', `/reviews/${r.id}`);
    await data(peer, 'PATCH', `/reviews/${r.id}/answers`, {
      revision: p.review.revision,
      answers: answer(p.form),
    });
    await data(peer, 'POST', `/reviews/${r.id}/submit`, { confidential: null, confirm: [] });
  }

  // Marco writes Adam's manager review; the score is computed.
  const marcos = await data<{ rows: { id: string; kind: string; subjectId: string }[] }>(
    'marco',
    'GET',
    '/reviews?tab=write',
  );
  const mgr = marcos.rows.find((r) => r.kind === 'manager' && r.subjectId === ids.adam.person);
  if (mgr === undefined) throw new Error('no manager review');
  const mp = await data<{
    review: { revision: number };
    form: { sections: { questions: { id: string; type: string }[] }[] };
    panel: { reviews: unknown[] };
  }>('marco', 'GET', `/reviews/${mgr.id}`);
  expect(mp.panel.reviews.length).toBe(3);
  const saved = await data<{ score: { hundredths: number; label: string } }>(
    'marco',
    'PATCH',
    `/reviews/${mgr.id}/answers`,
    { revision: mp.review.revision, answers: answer(mp.form) },
  );
  expect(saved.score).toMatchObject({ hundredths: 400, label: 'Exceeds' });
  await data('marco', 'POST', `/reviews/${mgr.id}/submit`, { confidential: null, confirm: [] });

  // An unlock: Marco asks, Adam may not decide it, HR does.
  await data('marco', 'POST', `/reviews/${mgr.id}/unlock`, {
    reason: 'Rated before the last peer review came in',
  });
  expect(
    (await call('adam', 'POST', `/reviews/${mgr.id}/unlock/decide`, { approve: true, note: 'yes' }))
      .status,
  ).toBe(403);
  await data('ada', 'POST', `/reviews/${mgr.id}/unlock/decide`, { approve: true, note: 'Fine' });
  await data('marco', 'POST', `/reviews/${mgr.id}/submit`, { confidential: null, confirm: [] });

  // Released to Adam, who reads it without the private questions, and acknowledges.
  await data('marco', 'POST', `/cycles/${cycleId}/about/${ids.adam.person}/release`, {
    acknowledge: true,
  });
  const released = await data('adam', 'GET', `/reviews/${mgr.id}/released`);
  const text = JSON.stringify(released);
  expect(text).not.toContain('Potential to grow');
  expect(text).not.toContain('Retention risk');
  expect(text).toContain('What should they keep doing?');
  await data('adam', 'POST', `/reviews/${mgr.id}/acknowledge`, {
    comment: 'Agree on the latency goal',
  });
  // Two peer reviews are under the minimum of three: Adam sees none of them.
  const peerIds = (
    await data<{ rows: { id: string; kind: string }[] }>('omar', 'GET', '/reviews?tab=written')
  ).rows
    .filter((r) => r.kind === 'peer')
    .map((r) => r.id);
  for (const id of peerIds)
    expect((await call('adam', 'GET', `/reviews/${id}/released`)).status).toBe(404);

  // Feedback, seen by its recipient, undone within ten minutes by its writer only.
  const given = await data<{ id: string }>('omar', 'POST', '/feedback', {
    to: ids.adam.person,
    kind: 'feedback',
    body: '<p>The idempotency doc saved me a week.</p>',
    audience: 'recipient_manager',
    showName: true,
    value: null,
    templateId: null,
    answers: null,
    requestId: null,
  });
  const received = await data<{ received: { id: string }[] }>(
    'adam',
    'GET',
    '/feedback?tab=received',
  );
  expect(received.received.map((f) => f.id)).toContain(given.id);
  expect((await call('adam', 'POST', `/feedback/${given.id}/undo`)).status).toBe(403);
  await data('omar', 'POST', `/feedback/${given.id}/undo`);

  // A goal and its check-in.
  const goals = await data<{ periods: { id: string }[] }>('adam', 'GET', '/goals');
  const { id: goalId } = await data<{ id: string }>('adam', 'POST', '/goals', {
    title: 'Cut payout latency p95 to 400 ms',
    description: '',
    ownerId: null,
    ownerKind: 'person',
    periodId: goals.periods[1]?.id ?? '',
    parentId: null,
    weight: 100,
    commitment: 'committed',
    keyResults: [
      {
        title: 'p95',
        measure: 'number',
        start: 780,
        target: 400,
        current: 780,
        unit: 'ms',
        weight: null,
        linked: null,
      },
    ],
  });
  expect(
    (
      await data<{ progress: number }>('adam', 'POST', `/goals/${goalId}/check-ins`, {
        values: {},
        confidence: 'at_risk',
        note: null,
      })
    ).progress,
  ).toBe(0);

  // Calibration holds the scored review, takes a change with its reason, and finalises.
  const { id: sessionId, held } = await data<{ id: string; held: number }>(
    'ada',
    'POST',
    '/calibration',
    {
      name: 'Engineering, H2 2026',
      cycleId,
      calibrators: [ids.nora.person],
      subjects: [ids.adam.person],
      department: null,
      meetsOn: null,
    },
  );
  expect(held).toBe(1);
  expect(
    (
      await call('nora', 'POST', `/calibration/${sessionId}/changes`, {
        personId: ids.adam.person,
        now: 420,
        reason: '',
      })
    ).status,
  ).toBe(422);
  await data('nora', 'POST', `/calibration/${sessionId}/changes`, {
    personId: ids.adam.person,
    now: 420,
    reason: 'Impact under-weighted in the form',
  });
  await data('ada', 'POST', `/calibration/${sessionId}/finalise`);

  // Close: each review mapped.
  const closed = await data<{ mapped: Record<string, number> }>(
    'ada',
    'POST',
    `/cycles/${cycleId}/close`,
    { releaseNow: false },
  );
  expect(closed.mapped['completed']).toBe(4);
  expect(closed.mapped['abandoned']).toBeGreaterThan(0);

  // What left Performance: ids and states, a final rating, never an answer.
  const events = await h.events(tenantId);
  const names = new Set(events.map((e) => e.eventName));
  for (const n of [
    'performance.cycle.state_changed',
    'performance.review.status_changed',
    'performance.review.released',
    'performance.feedback.given',
    'performance.goal.checked_in',
    'performance.rating.finalized',
  ])
    expect(names, n).toContain(n);
  const rating = events.find((e) => e.eventName === 'performance.rating.finalized')?.payload as {
    scoreHundredths: number;
  };
  expect(rating.scoreHundredths).toBe(420);
  expect(JSON.stringify(events)).not.toContain('ledger migration');

  // And the company's activity log hears the work and the refusal, never a value.
  const log = events
    .filter((e) => e.eventName === 'performance.activity.recorded')
    .map((e) => e.payload as { action: string; outcome: string });
  expect(log.some((r) => r.action === 'Submitted a review')).toBe(true);
  expect(log.some((r) => r.outcome === 'refused')).toBe(true);
}
