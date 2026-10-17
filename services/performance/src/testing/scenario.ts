import { randomUUID } from 'node:crypto';
import { TenantId, type CalendarDate } from '@kithena/contracts';
import { err, failure, ok, type Clock } from '@kithena/domain-kit';
import { expect } from 'vitest';

import type { UnitOfWork } from '../application/ports.js';
import type { CallerFrom } from '../http/caller.js';
import { deliverWebhooks } from '../application/webhooks.js';
import { capabilitiesHandler } from '../http/capabilities.js';
import { chatHandler } from '../http/chat.js';
import { chatFrom } from '../infrastructure/chat.js';
import { performanceServer } from '../http/server.js';
import { inProcessLive } from '../infrastructure/live.js';
import { secretFor, signatureHeader, verifySignature } from '../infrastructure/webhooks.js';

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
  // A webhook receiver that keeps what it is sent.
  const posted: { url: string; headers: Record<string, string>; body: string }[] = [];
  // A chat app that keeps what it is asked to send.
  const chatted: { email: string; text: string; buttons: { label: string; value: string }[] }[] =
    [];
  const chat = chatFrom(
    { SLACK_URL: 'http://slack.internal', SLACK_PERFORMANCE_TOKEN: 'chat-pair' },
    (_url, init) => {
      chatted.push(
        JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as (typeof chatted)[number],
      );
      return Promise.resolve(new Response('{}', { status: 202 }));
    },
  );
  // And a mailbox that keeps what messaging would send.
  const mailed: {
    to: string;
    subject: string;
    attachments?: readonly { filename: string; base64: string }[];
  }[] = [];
  const { rest, deps } = performanceServer(
    {
      uow: h.uow,
      live: inProcessLive(),
      callerFrom: withMember,
      clock,
      ...(chat === undefined ? {} : { chat }),
      chatToken: 'chat-pair',
      mailer: {
        send: (m) => {
          mailed.push(m);
          return Promise.resolve();
        },
      },
      webhooks: {
        secret: (t, e, v) => secretFor('scenario-key', t, e, v),
        sign: signatureHeader,
        vet: (url) =>
          Promise.resolve(
            url.startsWith('https://')
              ? ok(true as const)
              : err(failure('BAD_WEBHOOK_URL', 'A webhook URL is https')),
          ),
        post: (url, request) => {
          posted.push({ url, ...request });
          return Promise.resolve({ status: 204 });
        },
      },
    },
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

  // An integration takes reviews' releases, signed; plain http is refused.
  expect(
    (await call('ada', 'POST', '/webhooks', { url: 'http://hooks.example.com', events: ['*'] }))
      .status,
  ).toBe(422);
  const hook = await data<{ id: string; secret: string }>('ada', 'POST', '/webhooks', {
    url: 'https://hooks.example.com/kithena',
    events: ['performance.review.released', 'performance.cycle.state_changed'],
  });
  expect((await call('marco', 'GET', '/webhooks')).status).toBe(403);

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
  // HR hears it in the chat app, and approves from there, as herself.
  const asked = chatted.find((m) => m.email === 'ada@acme.example' && m.buttons.length === 2);
  const approve = asked?.buttons.find((b) => b.label === 'Approve')?.value ?? '';
  const relay = chatHandler(deps, 'chat-pair');
  const pressed = await relay({
    method: 'POST',
    url: '/internal/chat/relay',
    headers: { 'x-internal-token': 'chat-pair' },
    body: JSON.stringify({ tenantId, value: approve }),
  });
  expect(pressed.body).toEqual({ text: 'Done. Kithena has it.' });
  // A button nobody sealed runs nothing.
  const forged = await relay({
    method: 'POST',
    url: '/internal/chat/relay',
    headers: { 'x-internal-token': 'chat-pair' },
    body: JSON.stringify({ tenantId, value: `${approve.split('.')[0] ?? ''}.forged` }),
  });
  expect(forged.body).toEqual({ text: 'That button is not one of Performance’s.' });
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

  // HR's bulk export, as one PDF or as a zip of a PDF each with an index.
  const pdf = await data<{ base64: string; mediaType: string; filename: string }>(
    'ada',
    'POST',
    `/cycles/${cycleId}/export`,
    { full: false, kinds: [] },
  );
  expect([pdf.mediaType, Buffer.from(pdf.base64, 'base64').subarray(0, 4).toString()]).toEqual([
    'application/pdf',
    '%PDF',
  ]);
  const zip = await data<{ base64: string; mediaType: string; filename: string; count: number }>(
    'ada',
    'POST',
    `/cycles/${cycleId}/export`,
    { full: false, kinds: [], format: 'zip' },
  );
  const archive = Buffer.from(zip.base64, 'base64');
  expect([zip.mediaType, zip.filename.endsWith('.zip'), archive.subarray(0, 2).toString()]).toEqual(
    ['application/zip', true, 'PK'],
  );
  expect(archive.toString('latin1')).toContain('index.csv');
  expect(archive.toString('latin1').split('.pdf').length - 1).toBeGreaterThanOrEqual(zip.count);

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
  const goal = {
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
  };
  const { id: goalId } = await data<{ id: string }>('adam', 'POST', '/goals', goal);
  // Private until made public: Marco, his manager, sees it; Omar, his peer, does not.
  expect((await call('marco', 'GET', `/goals/${goalId}`)).status).toBe(200);
  expect((await call('omar', 'GET', `/goals/${goalId}`)).status).toBe(404);
  await data('adam', 'PUT', `/goals/${goalId}`, { ...goal, visibility: 'team' });
  expect((await call('omar', 'GET', `/goals/${goalId}`)).status).toBe(200);
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

  // The endpoint is sent what it took, in the order written, each signed with its secret:
  // fifty events a pass, so a few passes drain the cycle's.
  for (let pass = 0, seen = -1; pass < 20 && seen !== posted.length; pass += 1) {
    seen = posted.length;
    await deliverWebhooks(deps);
  }
  const delivered = posted.filter((p) => p.url === 'https://hooks.example.com/kithena');
  const sent = delivered.map((p) => (JSON.parse(p.body) as { eventName: string }).eventName);
  expect(sent).toContain('performance.review.released');
  expect(sent.every((n) => n !== 'performance.feedback.given')).toBe(true);
  expect(sent.indexOf('performance.cycle.state_changed')).toBeLessThan(
    sent.indexOf('performance.review.released'),
  );
  for (const p of delivered)
    expect(verifySignature(p.body, p.headers['kithena-signature'] ?? '', hook.secret)).toBe(true);
  // Delivered once: a second pass sends nothing new.
  const before = posted.length;
  await deliverWebhooks(deps);
  expect(posted.length).toBe(before);

  // The assistant asks as the person, and hears what their screens say, never review text.
  const ask = capabilitiesHandler({ deps, callerFrom: withMember });
  const catalogue = await ask({
    method: 'GET',
    url: '/internal/capabilities',
    headers: { 'x-who': ids.ada.account },
    body: '',
  });
  expect((catalogue.body as { serves: unknown[] }).serves).toHaveLength(6);
  const cyclesNow = await ask({
    method: 'POST',
    url: '/internal/capabilities/performance.cycles',
    headers: { 'x-who': ids.ada.account },
    body: JSON.stringify({ limit: 25 }),
  });
  expect(cyclesNow.status).toBe(200);
  expect(JSON.stringify(cyclesNow.body)).not.toContain('ledger migration');

  // A live session invites its learners to their calendars, and its cancellation follows.
  const session = {
    id: null,
    start: '2026-11-03T09:00:00.000Z',
    end: '2026-11-03T10:30:00.000Z',
    place: 'Room 4',
    online: null,
  };
  const item = {
    title: 'Giving feedback, well',
    kind: 'session',
    provider: 'In person',
    minutes: 90,
    parts: [],
    acknowledgement: null,
    quiz: null,
    recursMonths: null,
    certificateYears: null,
    sessions: [session],
    skills: [],
    url: null,
  };
  const { id: itemId } = await data<{ id: string }>('ada', 'POST', '/learning', item);
  await data('ada', 'POST', `/learning/${itemId}/assign`, {
    people: [ids.omar.person],
    filter: [],
    cycleId: null,
    due: null,
    why: 'Required',
  });
  const invited = mailed.find((m) => m.to === 'omar@acme.example' && m.attachments !== undefined);
  expect(invited?.subject).toContain('Invitation: Giving feedback, well');
  const ics = Buffer.from(invited?.attachments?.[0]?.base64 ?? '', 'base64').toString('utf8');
  expect(ics).toContain('METHOD:REQUEST');
  await data('ada', 'PUT', `/learning/${itemId}`, { ...item, sessions: [] });
  const cancelled = mailed.filter((m) => m.to === 'omar@acme.example').at(-1);
  expect(
    Buffer.from(cancelled?.attachments?.[0]?.base64 ?? '', 'base64').toString('utf8'),
  ).toContain('METHOD:CANCEL');

  // Retention: Priya left in 2020, so her feedback is due; a legal hold keeps it.
  await data('omar', 'POST', '/feedback', {
    to: ids.priya.person,
    kind: 'praise',
    body: '<p>Thanks for the referral.</p>',
    audience: 'recipient',
    showName: true,
    value: null,
    templateId: null,
    answers: null,
    requestId: null,
  });
  await data('ada', 'POST', '/members/import', {
    members: [
      { ...member('priya', 'marco', 'Recruiter'), status: 'terminated', leftOn: '2020-01-31' },
    ],
  });
  type Retention = { due: { personId: string; what: { kind: string; count: number }[] }[] };
  const dueNow = async () => (await data<Retention>('ada', 'GET', '/retention')).due;
  expect((await dueNow()).map((d) => d.personId)).toEqual([ids.priya.person]);
  expect((await call('marco', 'GET', '/retention')).status).toBe(403);
  await data('ada', 'POST', '/holds', { personId: ids.priya.person, reason: 'Tribunal claim' });
  expect(await dueNow()).toEqual([]);
  await data('ada', 'POST', `/holds/${ids.priya.person}/lift`, { reason: 'Settled' });
  // Her data, before it goes: what she received, by name where the writer allowed it.
  const exported = await data<{ base64: string; mediaType: string }>(
    'ada',
    'POST',
    `/people/${ids.priya.person}/export`,
    {},
  );
  const person = JSON.parse(Buffer.from(exported.base64, 'base64').toString('utf8')) as {
    feedbackReceived: { from: string; text: string }[];
  };
  expect(person.feedbackReceived).toContainEqual(
    expect.objectContaining({ from: 'Omar', text: 'Thanks for the referral.' }),
  );
  const gone = await data<{ deleted: number }>('ada', 'POST', '/retention/delete', {
    personIds: [ids.priya.person],
  });
  expect(gone.deleted).toBeGreaterThan(0);
  expect(await dueNow()).toEqual([]);
}
