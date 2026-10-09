import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { changed, prune, stateOf, StateChangeInput } from '../../../../lib/inbox/model';
import { readInbox, type Run } from '../../../../lib/inbox/sources';
import { peopleFor } from '../../../../lib/people';
import { readPreferenceFor, writePreferenceFor } from '../../../../lib/preferences';
import { personFor } from '../../../../lib/session';

/**
 * The Inbox for the phone (INB-040): the same merge as the web's
 * (`lib/inbox`), every module the company has read at once as the person the
 * bearer names, their state laid over it. `POST` changes that state (read,
 * snoozed, moved to Done, muted, a step ticked); acting on an item is the
 * module's own operation, through `/api/mobile/people`.
 */
const NO_STORE = { 'cache-control': 'no-store' };

async function who(request: Request) {
  const tenantId = (await headers()).get('x-tenant-id');
  const bearer = request.headers.get('authorization') ?? '';
  const sessionId = /^Bearer \S+$/.test(bearer) ? bearer.slice('Bearer '.length) : null;
  if (tenantId === null || tenantId === '' || sessionId === null) return null;
  const person = await personFor(sessionId, tenantId);
  return person === null ? null : { tenantId, sessionId, person };
}

const unauthenticated = () =>
  NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });

async function inboxOf(found: NonNullable<Awaited<ReturnType<typeof who>>>) {
  const { tenantId, sessionId, person } = found;
  const run: Run = (area, name, variables = {}) =>
    peopleFor(sessionId, tenantId, area, name, variables);
  const state = stateOf(await readPreferenceFor(tenantId, person.accountId, 'inbox'));
  const read = await readInbox(person.entitlements, run, state, new Date().toISOString());
  return { state, read };
}

export async function GET(request: Request): Promise<Response> {
  const found = await who(request);
  if (found === null) return unauthenticated();
  const { read } = await inboxOf(found);
  const { raw: _raw, ...answer } = read;
  return NextResponse.json(
    { ok: true, data: { ...answer, zone: found.person.timeZone ?? 'UTC' } },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request): Promise<Response> {
  const found = await who(request);
  if (found === null) return unauthenticated();
  const input = StateChangeInput.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 });
  }
  const { state, read } = await inboxOf(found);
  const at = new Date().toISOString();
  const c = input.data;
  const next = changed(
    state,
    c.kind === 'readAll'
      ? { kind: 'readAll', at }
      : c.kind === 'done'
        ? { kind: 'done', ids: c.ids, at }
        : c.kind === 'snooze'
          ? {
              kind: 'snooze',
              id: c.id,
              until: c.until,
              due: read.raw.find((i) => i.id === c.id)?.due ?? null,
            }
          : c,
  );
  const saved = await writePreferenceFor(
    found.tenantId,
    found.person.accountId,
    found.sessionId,
    'inbox',
    prune(next, read.raw),
  );
  return saved === 'saved'
    ? NextResponse.json({ ok: true, data: null }, { headers: NO_STORE })
    : NextResponse.json(
        {
          ok: false,
          code: saved === 'view_only' ? 'VIEW_ONLY' : 'UNAVAILABLE',
          message:
            saved === 'view_only'
              ? 'Viewing as somebody is read-only'
              : 'That did not save; try again',
        },
        { headers: NO_STORE },
      );
}
