import type {
  CalendarEntry,
  CalendarPort,
  Integration,
  ProviderAnswer,
} from '../../application/ports.js';
import { addDays } from '../../domain/days.js';

/**
 * Microsoft Outlook (TOF-110), by Microsoft Graph with application
 * permissions: one multi-tenant app of Kithena's, which a company's
 * Microsoft Entra administrator consents to for their directory. Graph then
 * writes to each member's calendar by their work address. Nothing secret is
 * stored per company: the directory's id is all connecting keeps.
 *
 * Documented APIs only:
 * - consent: the v2.0 admin consent endpoint, which returns `tenant`,
 *   `admin_consent` and the state (https://learn.microsoft.com/entra/identity-platform/v2-admin-consent);
 * - token: the client credentials grant for that directory, scope
 *   `https://graph.microsoft.com/.default`;
 * - events: `POST /users/{id}/events`, `PATCH` and `DELETE` on one, found by
 *   a single-value extended property holding Time Off's key, so a second put
 *   updates the first (https://learn.microsoft.com/graph/api/resources/event,
 *   …/singlevaluelegacyextendedproperty). `showAs: "oof"` is Outlook's "Out
 *   of office"; a holiday is `free`.
 *
 * **Inert without credentials**: `TIMEOFF_MICROSOFT_CLIENT_ID` and
 * `TIMEOFF_MICROSOFT_CLIENT_SECRET` unset, it is not configured and calls
 * nothing. The app needs Calendars.ReadWrite as an application permission.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';
/** Time Off's key on each event it writes: a property set of its own, named. */
export const KEY_PROPERTY = 'String {7c1f2a64-3b0e-4f5d-9a51-6d2c8e4b7f10} Name kithenaTimeOffKey';

export interface MicrosoftOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export function microsoftCalendar(
  env: NodeJS.ProcessEnv,
  options: MicrosoftOptions = {},
): CalendarPort {
  const http = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const clientId = env['TIMEOFF_MICROSOFT_CLIENT_ID'] ?? '';
  const clientSecret = env['TIMEOFF_MICROSOFT_CLIENT_SECRET'] ?? '';
  const configured = clientId !== '' && clientSecret !== '';
  // ponytail: one process's cache per directory; a shared one if replicas multiply.
  const tokens = new Map<string, { token: string; until: number }>();

  async function tokenFor(integration: Integration): Promise<string> {
    const directory = integration.config['directory'];
    if (!configured || directory === undefined) throw new Error('Outlook is not configured');
    const held = tokens.get(directory);
    if (held !== undefined && held.until > now() + 60_000) return held.token;
    const answer = await http(`${LOGIN}/${encodeURIComponent(directory)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    });
    if (!answer.ok) throw new Error(`Microsoft refused a token: ${String(answer.status)}`);
    const { access_token, expires_in } = (await answer.json()) as {
      access_token: string;
      expires_in: number;
    };
    tokens.set(directory, { token: access_token, until: now() + expires_in * 1000 });
    return access_token;
  }

  /** The event Time Off wrote under `key`, if there is one. */
  async function find(token: string, email: string, key: string): Promise<string | null> {
    const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${KEY_PROPERTY}' and ep/value eq '${key}')`;
    const answer = await http(
      `${GRAPH}/users/${encodeURIComponent(email)}/events?$filter=${encodeURIComponent(filter)}&$select=id`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!answer.ok) throw new Error(`Microsoft refused a search: ${String(answer.status)}`);
    const { value } = (await answer.json()) as { value: { id: string }[] };
    return value[0]?.id ?? null;
  }

  const body = (entry: CalendarEntry): Record<string, unknown> => ({
    subject: entry.title,
    isAllDay: true,
    showAs: entry.kind === 'out_of_office' ? 'oof' : 'free',
    isReminderOn: false,
    start: { dateTime: `${entry.from}T00:00:00`, timeZone: entry.timeZone },
    end: { dateTime: `${addDays(entry.to, 1)}T00:00:00`, timeZone: entry.timeZone },
    singleValueExtendedProperties: [{ id: KEY_PROPERTY, value: entry.key }],
  });

  return {
    provider: 'microsoft',
    configured,
    connectUrl: (state, redirectUri) =>
      `${LOGIN}/organizations/v2.0/adminconsent?${new URLSearchParams({
        client_id: clientId,
        scope: 'https://graph.microsoft.com/.default',
        redirect_uri: redirectUri,
        state,
      }).toString()}`,
    complete(answer: ProviderAnswer) {
      const directory = answer['tenant'];
      if (directory === undefined || answer['admin_consent']?.toLowerCase() !== 'true') {
        return Promise.reject(new Error('Microsoft did not say consent was given'));
      }
      return Promise.resolve({ config: { directory }, secret: null });
    },

    async put(integration, entry) {
      const token = await tokenFor(integration);
      const existing = await find(token, entry.email, entry.key);
      const user = `${GRAPH}/users/${encodeURIComponent(entry.email)}/events`;
      const answer = await http(existing === null ? user : `${user}/${existing}`, {
        method: existing === null ? 'POST' : 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body(entry)),
      });
      if (!answer.ok) throw new Error(`Microsoft refused an event: ${String(answer.status)}`);
    },

    async remove(integration, entry) {
      const token = await tokenFor(integration);
      const existing = await find(token, entry.email, entry.key);
      if (existing === null) return;
      const answer = await http(
        `${GRAPH}/users/${encodeURIComponent(entry.email)}/events/${existing}`,
        { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
      );
      if (!answer.ok && answer.status !== 404) {
        throw new Error(`Microsoft refused a deletion: ${String(answer.status)}`);
      }
    },
  };
}
