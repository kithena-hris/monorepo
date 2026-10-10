import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { answerInbox } from '../../../../../lib/inbox/ask';
import { stateOf } from '../../../../../lib/inbox/model';
import { readInbox, type Run } from '../../../../../lib/inbox/sources';
import { peopleFor } from '../../../../../lib/people';
import { readPreferenceFor } from '../../../../../lib/preferences';
import { personFor } from '../../../../../lib/session';

/**
 * Ask Kithena about your Inbox, on the phone (M:Z2): the web's own answer
 * (`lib/inbox/ask.ts`), from the Inbox as the bearer's person reads it.
 */
export async function POST(request: Request): Promise<Response> {
  const tenantId = (await headers()).get('x-tenant-id');
  const bearer = request.headers.get('authorization') ?? '';
  const sessionId = /^Bearer \S+$/.test(bearer) ? bearer.slice('Bearer '.length) : null;
  if (tenantId === null || tenantId === '' || sessionId === null) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const person = await personFor(sessionId, tenantId);
  if (person === null)
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const question: unknown =
    body !== null && typeof body === 'object' ? Reflect.get(body, 'question') : undefined;
  if (typeof question !== 'string' || question.trim() === '') {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }
  const run: Run = (area, name, variables = {}) =>
    peopleFor(sessionId, tenantId, area, name, variables);
  const state = stateOf(await readPreferenceFor(tenantId, person.accountId, 'inbox'));
  const read = await readInbox(person.entitlements, run, state, new Date().toISOString());
  return NextResponse.json(
    {
      ok: true,
      data: answerInbox(question.slice(0, 500), read.items, read.now, person.timeZone ?? 'UTC'),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
