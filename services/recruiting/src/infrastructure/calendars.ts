import { createSign, randomUUID } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import type {
  CalendarEvent,
  CalendarProvider,
  CalendarSession,
  Connection,
  ConnectionKind,
  VideoProvider,
  VideoSession,
} from '../application/ports.js';

/**
 * Google Workspace and Microsoft 365 calendars by OAuth per member (PRD §26.2,
 * REC-135): busy times, an event on the organiser's calendar with the
 * interviewers invited, and its Meet or Teams link. The narrowest scopes that
 * do it: Google's free/busy and events, Microsoft's `Calendars.ReadWrite`
 * (Teams links come with it). The grant kept is the refresh token, sealed by
 * the application before it is stored. Zoom the same way, for a meeting link
 * of the member's own in place of Meet or Teams.
 */

interface Client {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

type Json = Record<string, unknown>;

const unavailable = (kind: ConnectionKind, status: number) => {
  logger.warn({ module: 'recruiting', kind, status }, 'calendar refused');
  return err(failure('UNAVAILABLE', 'The calendar did not answer just now. Try again.'));
};

async function send(
  url: string,
  init: {
    method?: string;
    token?: string;
    form?: Record<string, string>;
    json?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: Json }> {
  const response = await fetch(url, {
    method: init.method ?? (init.form === undefined && init.json === undefined ? 'GET' : 'POST'),
    headers: {
      ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
      ...(init.form === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
      ...(init.json === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    ...(init.form === undefined ? {} : { body: new URLSearchParams(init.form).toString() }),
    ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Json };
}

/** The token endpoint's two grants: a code once, then the refresh token each session. */
async function tokens(
  kind: ConnectionKind,
  url: string,
  client: Client,
  grant: { code: string } | { refreshToken: string },
  scope?: string,
): Promise<Result<{ access: string; refresh: string | null }>> {
  // Zoom takes the client in a Basic header; Google and Microsoft in the form.
  const basic = kind === 'zoom';
  const answer = await send(url, {
    ...(basic
      ? {
          headers: {
            authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}`,
          },
        }
      : {}),
    form: {
      ...(basic ? {} : { client_id: client.clientId, client_secret: client.clientSecret }),
      ...('code' in grant
        ? { grant_type: 'authorization_code', code: grant.code, redirect_uri: client.redirectUri }
        : { grant_type: 'refresh_token', refresh_token: grant.refreshToken }),
      ...(scope === undefined ? {} : { scope }),
    },
  });
  const access = answer.body['access_token'];
  if (answer.status !== 200 || typeof access !== 'string') return unavailable(kind, answer.status);
  const refresh = answer.body['refresh_token'];
  return ok({ access, refresh: typeof refresh === 'string' ? refresh : null });
}

const end = (e: CalendarEvent) =>
  new Date(Date.parse(e.startsAt) + e.minutes * 60_000).toISOString();

const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar.events';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** Google Calendar under an access token, however it was got: by OAuth or by delegation. */
function googleSession(token: string, grant: string): CalendarSession {
  const kind = 'google';
  return {
    grant,
    async busy(from, to) {
      // The events themselves, not free/busy: `calendar.events` reads them, so a
      // Workspace that delegated that scope for Time Off needs nothing more.
      const answer = await send(
        `${GOOGLE_EVENTS}?${new URLSearchParams({
          timeMin: from,
          timeMax: to,
          singleEvents: 'true',
          maxResults: '2500',
          fields: 'items(start,end,transparency,status)',
        }).toString()}`,
        { token },
      );
      if (answer.status !== 200) return unavailable(kind, answer.status);
      const items = (answer.body['items'] ?? []) as {
        start?: { dateTime?: string };
        end?: { dateTime?: string };
        transparency?: string;
        status?: string;
      }[];
      return ok(
        items.flatMap((e) =>
          e.status === 'cancelled' ||
          e.transparency === 'transparent' ||
          e.start?.dateTime === undefined ||
          e.end?.dateTime === undefined
            ? []
            : [[e.start.dateTime, e.end.dateTime] as const],
        ),
      );
    },
    async create(event) {
      const answer = await send(`${GOOGLE_EVENTS}?conferenceDataVersion=1&sendUpdates=all`, {
        token,
        json: {
          summary: event.title,
          description: event.description,
          ...(event.location === null ? {} : { location: event.location }),
          start: { dateTime: event.startsAt },
          end: { dateTime: end(event) },
          attendees: event.attendees.map((email) => ({ email })),
          ...(event.video
            ? {
                conferenceData: {
                  createRequest: {
                    requestId: randomUUID(),
                    conferenceSolutionKey: { type: 'hangoutsMeet' },
                  },
                },
              }
            : {}),
        },
      });
      const id = answer.body['id'];
      if (answer.status !== 200 || typeof id !== 'string') return unavailable(kind, answer.status);
      const meet = answer.body['hangoutLink'];
      return ok({ eventId: id, videoUrl: typeof meet === 'string' ? meet : null });
    },
    async cancel(eventId) {
      const answer = await send(`${GOOGLE_EVENTS}/${encodeURIComponent(eventId)}?sendUpdates=all`, {
        token,
        method: 'DELETE',
      });
      // Already gone is what cancelling wanted.
      return [200, 204, 404, 410].includes(answer.status)
        ? ok(undefined)
        : unavailable(kind, answer.status);
    },
  };
}

export function googleCalendar(client: Client): CalendarProvider {
  const kind = 'google';
  return {
    kind,
    consentUrl: (state) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        // A refresh token, every time: without `consent` a second grant comes back without one.
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString()}`,
    async redeem(code) {
      const got = await tokens(kind, GOOGLE_TOKEN, client, { code });
      if (!got.ok) return got;
      return got.value.refresh === null ? unavailable(kind, 200) : ok(got.value.refresh);
    },
    async open(grant) {
      const got = await tokens(kind, GOOGLE_TOKEN, client, { refreshToken: grant });
      if (!got.ok) return got;
      const token = got.value.access;
      return ok(googleSession(token, got.value.refresh ?? grant));
    },
  };
}

/**
 * Google Workspace by domain-wide delegation: Kithena's service account acts
 * as the member, once the company's Workspace administrator has allowed it
 * `calendar.events`. The same account and scope as Time Off's calendar
 * (TOF-110), so a company that allowed it there has nothing to connect here.
 * Null when the member's address is not in a Workspace that allowed it.
 */
export function workspaceGoogle(
  serviceAccountJson: string,
): (email: string) => Promise<CalendarSession | null> {
  const account = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string };
  const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  // ponytail: one process's cache, an hour each, as Time Off's.
  const held = new Map<string, { token: string; until: number }>();
  return async (email) => {
    const kept = held.get(email);
    if (kept !== undefined && kept.until > Date.now() + 60_000)
      return googleSession(kept.token, '');
    const iat = Math.floor(Date.now() / 1000);
    const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
      iss: account.client_email,
      sub: email,
      scope: GOOGLE_SCOPES,
      aud: GOOGLE_TOKEN,
      iat,
      exp: iat + 3600,
    })}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(account.private_key, 'base64url');
    const answer = await send(GOOGLE_TOKEN, {
      form: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      },
    });
    const token = answer.body['access_token'];
    const lasts = answer.body['expires_in'];
    if (answer.status !== 200 || typeof token !== 'string') return null;
    held.set(email, {
      token,
      until: Date.now() + (typeof lasts === 'number' ? lasts : 3600) * 1000,
    });
    return googleSession(token, '');
  };
}

const MICROSOFT_SCOPES = 'offline_access Calendars.ReadWrite';
const MICROSOFT_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH = 'https://graph.microsoft.com/v1.0/me';

export function microsoftCalendar(client: Client): CalendarProvider {
  const kind = 'microsoft';
  return {
    kind,
    consentUrl: (state) =>
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        response_type: 'code',
        response_mode: 'query',
        scope: MICROSOFT_SCOPES,
        state,
      }).toString()}`,
    async redeem(code) {
      const got = await tokens(kind, MICROSOFT_TOKEN, client, { code }, MICROSOFT_SCOPES);
      if (!got.ok) return got;
      return got.value.refresh === null ? unavailable(kind, 200) : ok(got.value.refresh);
    },
    async open(grant) {
      const got = await tokens(
        kind,
        MICROSOFT_TOKEN,
        client,
        { refreshToken: grant },
        MICROSOFT_SCOPES,
      );
      if (!got.ok) return got;
      const token = got.value.access;
      // Times in and out in UTC, so `dateTime` without an offset is UTC.
      const utc = { prefer: 'outlook.timezone="UTC"' };
      const session: CalendarSession = {
        // Microsoft rotates the refresh token; keep the newest.
        grant: got.value.refresh ?? grant,
        async busy(from, to) {
          const answer = await send(
            `${GRAPH}/calendarView?${new URLSearchParams({
              startDateTime: from,
              endDateTime: to,
              $select: 'start,end,showAs',
              $top: '500',
            }).toString()}`,
            { token, headers: utc },
          );
          if (answer.status !== 200) return unavailable(kind, answer.status);
          const events = (answer.body['value'] ?? []) as {
            start: { dateTime: string };
            end: { dateTime: string };
            showAs?: string;
          }[];
          return ok(
            events
              .filter((e) => e.showAs !== 'free')
              .map((e) => [`${e.start.dateTime}Z`, `${e.end.dateTime}Z`] as const),
          );
        },
        async create(event) {
          const answer = await send(`${GRAPH}/events`, {
            token,
            headers: utc,
            json: {
              subject: event.title,
              body: { contentType: 'text', content: event.description },
              start: { dateTime: event.startsAt.replace(/Z$/u, ''), timeZone: 'UTC' },
              end: { dateTime: end(event).replace(/Z$/u, ''), timeZone: 'UTC' },
              ...(event.location === null ? {} : { location: { displayName: event.location } }),
              attendees: event.attendees.map((address) => ({
                emailAddress: { address },
                type: 'required',
              })),
              ...(event.video
                ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' }
                : {}),
            },
          });
          const id = answer.body['id'];
          if (answer.status !== 201 || typeof id !== 'string')
            return unavailable(kind, answer.status);
          const join = (answer.body['onlineMeeting'] as { joinUrl?: string } | null)?.joinUrl;
          return ok({ eventId: id, videoUrl: join ?? null });
        },
        async cancel(eventId) {
          const answer = await send(`${GRAPH}/events/${encodeURIComponent(eventId)}`, {
            token,
            method: 'DELETE',
          });
          return [204, 404].includes(answer.status)
            ? ok(undefined)
            : unavailable(kind, answer.status);
        },
      };
      return ok(session);
    },
  };
}

const ZOOM_TOKEN = 'https://zoom.us/oauth/token';
const ZOOM_API = 'https://api.zoom.us/v2';

/** Scopes are set on the Zoom app itself: `meeting:write:meeting` and `meeting:delete:meeting`. */
export function zoomVideo(client: Client): VideoProvider {
  const kind = 'zoom';
  return {
    kind,
    consentUrl: (state) =>
      `https://zoom.us/oauth/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        state,
      }).toString()}`,
    async redeem(code) {
      const got = await tokens(kind, ZOOM_TOKEN, client, { code });
      if (!got.ok) return got;
      return got.value.refresh === null ? unavailable(kind, 200) : ok(got.value.refresh);
    },
    async open(grant) {
      const got = await tokens(kind, ZOOM_TOKEN, client, { refreshToken: grant });
      if (!got.ok) return got;
      const token = got.value.access;
      const session: VideoSession = {
        // Zoom rotates the refresh token and retires the old one: keep the newest.
        grant: got.value.refresh ?? grant,
        async meeting(input) {
          const answer = await send(`${ZOOM_API}/users/me/meetings`, {
            token,
            json: {
              topic: input.title,
              type: 2,
              start_time: input.startsAt,
              duration: input.minutes,
              timezone: 'UTC',
              settings: { waiting_room: true, join_before_host: false },
            },
          });
          const id = answer.body['id'];
          const url = answer.body['join_url'];
          if (answer.status !== 201 || typeof url !== 'string' || id === undefined)
            return unavailable(kind, answer.status);
          return ok({ meetingId: String(id as number), url });
        },
        async end(meetingId) {
          const answer = await send(`${ZOOM_API}/meetings/${encodeURIComponent(meetingId)}`, {
            token,
            method: 'DELETE',
          });
          return [204, 404].includes(answer.status)
            ? ok(undefined)
            : unavailable(kind, answer.status);
        },
      };
      return ok(session);
    },
  };
}

/** Each calendar and video app whose OAuth client is configured; none, scheduling uses working hours. */
export function connectionsFrom(env: NodeJS.ProcessEnv): Connection[] {
  const redirectUri =
    env['CALENDAR_REDIRECT_URI'] ??
    'https://api.kithena.com/v1/recruiting/public/calendar-callback';
  const out: Connection[] = [];
  const client = (prefix: string): Client | null => {
    const clientId = env[`${prefix}_CLIENT_ID`];
    const clientSecret = env[`${prefix}_CLIENT_SECRET`];
    return clientId && clientSecret ? { clientId, clientSecret, redirectUri } : null;
  };
  const google = client('GOOGLE_CALENDAR');
  if (google !== null) out.push(googleCalendar(google));
  const microsoft = client('MICROSOFT_CALENDAR');
  if (microsoft !== null) out.push(microsoftCalendar(microsoft));
  const zoom = client('ZOOM');
  if (zoom !== null) out.push(zoomVideo(zoom));
  return out;
}
