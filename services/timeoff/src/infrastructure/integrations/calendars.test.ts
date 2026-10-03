import { createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CalendarDate } from '@kithena/contracts';

import type { CalendarEntry, Integration } from '../../application/ports.js';
import { googleCalendar, googleEventId } from './google.js';
import { KEY_PROPERTY, microsoftCalendar } from './microsoft.js';
import { sealer } from './seal.js';

/**
 * The calendar adapters against fakes of the documented endpoints: what each
 * sends, never a real provider. No credentials, no calls.
 */

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string;
  readonly auth: string;
}

/** `fetch` answering by URL and method, recording every call. */
function provider(answer: (call: Call) => { status: number; json?: unknown }) {
  const calls: Call[] = [];
  const http = (input: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    const call = {
      url: input,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? init.body : '',
      auth: headers.get('authorization') ?? '',
    };
    calls.push(call);
    const { status, json } = answer(call);
    return Promise.resolve(
      new Response(json === undefined ? null : JSON.stringify(json), { status }),
    );
  };
  // The adapters only ever pass a URL string.
  return { calls, http: http as unknown as typeof fetch };
}

const entry: CalendarEntry = {
  key: 'request-r1-0',
  email: 'adam@acme.example',
  title: 'Out of office',
  from: CalendarDate.parse('2026-10-19'),
  to: CalendarDate.parse('2026-10-23'),
  kind: 'out_of_office',
  timeZone: 'Europe/Madrid',
};

const connected = (config: Record<string, string> = {}): Integration => ({
  provider: 'google',
  config,
  secret: null,
  connectedAt: '2026-09-01T00:00:00.000Z' as never,
  connectedBy: '00000000-0000-4000-8000-0000000000a1',
});

describe('Google Calendar', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = {
    TIMEOFF_GOOGLE_SERVICE_ACCOUNT: JSON.stringify({
      client_email: 'timeoff@kithena.iam.example',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }),
  };

  it('is inert without the service account', () => {
    expect(googleCalendar({}).configured).toBe(false);
    expect(googleCalendar(env).configured).toBe(true);
    expect(googleCalendar(env).connectUrl('state', 'https://to.example/cb')).toBeNull();
  });

  it('acts as the member with a signed assertion, then puts out of office midnight to midnight', async () => {
    const google = provider((c) =>
      c.url.startsWith('https://oauth2.googleapis.com/token')
        ? { status: 200, json: { access_token: 'g-token', expires_in: 3600 } }
        : c.method === 'PUT'
          ? { status: 404 }
          : { status: 200, json: {} },
    );
    await googleCalendar(env, { fetch: google.http, now: () => 1_790_000_000_000 }).put(
      connected(),
      entry,
    );

    const [token, update, insert] = google.calls;
    const assertion = new URLSearchParams(token?.body).get('assertion') ?? '';
    const [head = '', claims = '', signature = ''] = assertion.split('.');
    expect(
      createVerify('RSA-SHA256')
        .update(`${head}.${claims}`)
        .verify(publicKey, signature, 'base64url'),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({
      iss: 'timeoff@kithena.iam.example',
      sub: 'adam@acme.example',
      scope: 'https://www.googleapis.com/auth/calendar.events',
    });

    const id = googleEventId('request-r1-0');
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/u);
    expect(update).toMatchObject({ method: 'PUT', auth: 'Bearer g-token' });
    expect(update?.url).toBe(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}?sendUpdates=none`,
    );
    expect(insert?.method).toBe('POST');
    expect(JSON.parse(insert?.body ?? '{}')).toEqual({
      id,
      eventType: 'outOfOffice',
      summary: 'Out of office',
      start: { dateTime: '2026-10-19T00:00:00', timeZone: 'Europe/Madrid' },
      end: { dateTime: '2026-10-24T00:00:00', timeZone: 'Europe/Madrid' },
      transparency: 'opaque',
      outOfOfficeProperties: {
        autoDeclineMode: 'declineOnlyNewConflictingInvitations',
        declineMessage: 'Out of office',
      },
    });
  });

  it('puts a holiday as an all-day free day, and a removal that finds nothing is done', async () => {
    const google = provider((c) =>
      c.url.includes('/token')
        ? { status: 200, json: { access_token: 'g', expires_in: 3600 } }
        : c.method === 'DELETE'
          ? { status: 410 }
          : { status: 200, json: {} },
    );
    const port = googleCalendar(env, { fetch: google.http });
    await port.put(connected(), {
      ...entry,
      kind: 'holiday',
      title: 'Fiesta Nacional',
      to: entry.from,
    });
    await port.remove(connected(), entry);
    expect(JSON.parse(google.calls[1]?.body ?? '{}')).toMatchObject({
      start: { date: '2026-10-19' },
      end: { date: '2026-10-20' },
      transparency: 'transparent',
    });
    // One token for both calls: it is kept until it is nearly spent.
    expect(google.calls.filter((c) => c.url.includes('/token'))).toHaveLength(1);
  });
});

describe('Microsoft Outlook', () => {
  const env = {
    TIMEOFF_MICROSOFT_CLIENT_ID: 'client-id',
    TIMEOFF_MICROSOFT_CLIENT_SECRET: 'client-value',
  };

  it('is inert without its app, and asks the directory’s administrator to consent', async () => {
    expect(microsoftCalendar({}).configured).toBe(false);
    const url = new URL(microsoftCalendar(env).connectUrl('s-1', 'https://to.example/cb') ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/organizations/v2.0/adminconsent',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-id',
      scope: 'https://graph.microsoft.com/.default',
      redirect_uri: 'https://to.example/cb',
      state: 's-1',
    });
    expect(
      await microsoftCalendar(env).complete({ tenant: 'dir-1', admin_consent: 'True' }, ''),
    ).toEqual({ config: { directory: 'dir-1' }, secret: null });
    await expect(microsoftCalendar(env).complete({ tenant: 'dir-1' }, '')).rejects.toThrow();
  });

  it('finds Time Off’s own event by its key, and patches it rather than adding a second', async () => {
    const graph = provider((c) =>
      c.url.includes('/oauth2/v2.0/token')
        ? { status: 200, json: { access_token: 'm-token', expires_in: 3600 } }
        : c.method === 'GET'
          ? { status: 200, json: { value: [{ id: 'evt-1' }] } }
          : { status: 200, json: {} },
    );
    await microsoftCalendar(env, { fetch: graph.http }).put(
      connected({ directory: 'dir-1' }),
      entry,
    );
    const [token, search, patch] = graph.calls;
    expect(token?.url).toBe('https://login.microsoftonline.com/dir-1/oauth2/v2.0/token');
    expect(new URLSearchParams(token?.body).get('grant_type')).toBe('client_credentials');
    expect(decodeURIComponent(search?.url ?? '')).toContain(
      `ep/id eq '${KEY_PROPERTY}' and ep/value eq 'request-r1-0'`,
    );
    expect(patch).toMatchObject({
      method: 'PATCH',
      url: 'https://graph.microsoft.com/v1.0/users/adam%40acme.example/events/evt-1',
      auth: 'Bearer m-token',
    });
    expect(JSON.parse(patch?.body ?? '{}')).toMatchObject({
      subject: 'Out of office',
      showAs: 'oof',
      isAllDay: true,
      start: { dateTime: '2026-10-19T00:00:00', timeZone: 'Europe/Madrid' },
      end: { dateTime: '2026-10-24T00:00:00', timeZone: 'Europe/Madrid' },
      singleValueExtendedProperties: [{ id: KEY_PROPERTY, value: 'request-r1-0' }],
    });
  });
});

describe('a sealed secret', () => {
  it('opens to what was sealed, and to nothing under another key', () => {
    const one = sealer(randomBytes(32));
    const sealed = one.seal('xoxb-bot-token');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('xoxb');
    expect(one.open(sealed)).toBe('xoxb-bot-token');
    expect(() => sealer(randomBytes(32)).open(sealed)).toThrow();
  });
});
