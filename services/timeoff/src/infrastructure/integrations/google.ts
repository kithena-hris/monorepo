import { createHash, createSign } from 'node:crypto';

import type { CalendarEntry, CalendarPort, Integration } from '../../application/ports.js';
import { addDays } from '../../domain/days.js';

/**
 * Google Calendar (TOF-110), by a service account with domain-wide
 * delegation: one app of Kithena's, which a company's Google Workspace
 * administrator authorises for the Calendar events scope in their own admin
 * console (Security › API controls › Domain-wide delegation). It then acts as
 * each member, by their work address; nothing is stored per company or per
 * person, so connecting is recorded at once.
 *
 * Documented APIs only:
 * - token: the OAuth 2.0 JWT bearer grant, an RS256 assertion naming the
 *   member as `sub` (https://developers.google.com/identity/protocols/oauth2/service-account);
 * - events: Calendar API v3 `events.update` and `events.insert` on the
 *   `primary` calendar with a client-chosen id, so a second put updates the
 *   first; `eventType: "outOfOffice"`, which declines new meetings in the
 *   span (https://developers.google.com/calendar/api/v3/reference/events).
 *
 * **Inert without credentials**: `TIMEOFF_GOOGLE_SERVICE_ACCOUNT` (the
 * service account's JSON key) unset, it is not configured and calls nothing.
 */

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

interface ServiceAccount {
  readonly client_email: string;
  readonly private_key: string;
}

export interface GoogleOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

/** A Calendar event id: base32hex characters (a–v, 0–9), so the hex of the key's hash. */
export const googleEventId = (key: string): string =>
  createHash('sha256').update(key).digest('hex').slice(0, 40);

const b64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export function googleCalendar(env: NodeJS.ProcessEnv, options: GoogleOptions = {}): CalendarPort {
  const http = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const raw = env['TIMEOFF_GOOGLE_SERVICE_ACCOUNT'];
  const account = raw ? (JSON.parse(raw) as ServiceAccount) : null;
  // ponytail: one process's cache, an hour each; a shared one if replicas multiply.
  const tokens = new Map<string, { token: string; until: number }>();

  async function tokenFor(email: string): Promise<string> {
    if (account === null) throw new Error('Google Calendar is not configured');
    const held = tokens.get(email);
    if (held !== undefined && held.until > now() + 60_000) return held.token;
    const iat = Math.floor(now() / 1000);
    const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
      iss: account.client_email,
      sub: email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    })}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(account.private_key, 'base64url');
    const answer = await http(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }).toString(),
    });
    if (!answer.ok)
      throw new Error(`Google refused a token for a member: ${String(answer.status)}`);
    const { access_token, expires_in } = (await answer.json()) as {
      access_token: string;
      expires_in: number;
    };
    tokens.set(email, { token: access_token, until: now() + expires_in * 1000 });
    return access_token;
  }

  function body(entry: CalendarEntry): Record<string, unknown> {
    const end = addDays(entry.to, 1);
    const id = googleEventId(entry.key);
    if (entry.kind === 'holiday') {
      return {
        id,
        summary: entry.title,
        start: { date: entry.from },
        end: { date: end },
        transparency: 'transparent',
      };
    }
    // An out-of-office event cannot be all-day: it runs midnight to midnight in the member's zone.
    return {
      id,
      eventType: 'outOfOffice',
      summary: entry.title,
      start: { dateTime: `${entry.from}T00:00:00`, timeZone: entry.timeZone },
      end: { dateTime: `${end}T00:00:00`, timeZone: entry.timeZone },
      transparency: 'opaque',
      outOfOfficeProperties: {
        autoDeclineMode: 'declineOnlyNewConflictingInvitations',
        declineMessage: 'Out of office',
      },
    };
  }

  return {
    provider: 'google',
    configured: account !== null,
    connectUrl: () => null,
    complete: () => Promise.resolve({ config: {}, secret: null }),

    async put(_integration: Integration, entry: CalendarEntry) {
      const token = await tokenFor(entry.email);
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const user = `${EVENTS}?sendUpdates=none`;
      const id = googleEventId(entry.key);
      // Update first: it also revives an event deleted earlier, which insert would refuse.
      const updated = await http(`${EVENTS}/${id}?sendUpdates=none`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body(entry)),
      });
      if (updated.ok) return;
      if (updated.status !== 404) {
        throw new Error(`Google refused an event update: ${String(updated.status)}`);
      }
      const inserted = await http(user, {
        method: 'POST',
        headers,
        body: JSON.stringify(body(entry)),
      });
      if (!inserted.ok) throw new Error(`Google refused an event: ${String(inserted.status)}`);
    },

    async remove(_integration: Integration, entry: Pick<CalendarEntry, 'key' | 'email'>) {
      const token = await tokenFor(entry.email);
      const gone = await http(`${EVENTS}/${googleEventId(entry.key)}?sendUpdates=none`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      // Never there, or deleted already: either way it is gone.
      if (!gone.ok && gone.status !== 404 && gone.status !== 410) {
        throw new Error(`Google refused a deletion: ${String(gone.status)}`);
      }
    },
  };
}
