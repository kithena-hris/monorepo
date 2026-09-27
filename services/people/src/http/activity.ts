import type { ActivityArea } from '../application/settings/activity.js';
import { PEOPLE_NOTICES } from '../application/settings/chat.js';

/** A chat app's name as the log says it. */
const appName = (key: string | undefined): string | null =>
  key === undefined ? null : `${key.charAt(0).toUpperCase()}${key.slice(1)}`;

/**
 * Which commands are changes to settings, and how each reads in the log.
 *
 * Matched on the path the router already matched, and described from the
 * request: a label or a name somebody typed, never a URL's secret, a token or
 * a value on somebody's record. A command not listed here is not a setting
 * and is not logged here (a person's own record has its own history).
 */

type Body = Record<string, unknown>;
type Said = { readonly action: string; readonly subject?: string | null };
interface Rule {
  readonly path: RegExp;
  readonly area: ActivityArea;
  readonly say: (method: string, body: Body, id: string | undefined) => Said | null;
}

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 300) : null;
const ID = '([^/]+)';

const RULES: readonly Rule[] = [
  {
    path: /^\/v1\/schema\/draft\/sections$/,
    area: 'fields',
    say: (_m, b) => ({ action: 'Added a section', subject: text(b['label']) }),
  },
  {
    path: /^\/v1\/schema\/draft\/sections\/order$/,
    area: 'fields',
    say: () => ({ action: 'Reordered the sections' }),
  },
  {
    path: new RegExp(`^/v1/schema/draft/sections/${ID}/order$`),
    area: 'fields',
    say: (_m, _b, id) => ({ action: 'Reordered the fields in a section', subject: id ?? null }),
  },
  {
    path: new RegExp(`^/v1/schema/draft/attributes/${ID}/signup$`),
    area: 'fields',
    say: (_m, b, id) => ({
      action:
        b['ask'] === 'off'
          ? 'Took a field off sign-up'
          : b['ask'] === 'required'
            ? 'Required a field at sign-up'
            : 'Asked a field at sign-up, optional',
      subject: id ?? null,
    }),
  },
  {
    path: new RegExp(`^/v1/schema/draft/attributes/${ID}/assistant$`),
    area: 'fields',
    say: (_m, b, id) => ({
      action:
        b['share'] === true
          ? 'Shared a field with the assistant'
          : 'Stopped sharing a field with the assistant',
      subject: id ?? null,
    }),
  },
  {
    path: /^\/v1\/schema\/draft\/attributes$/,
    area: 'fields',
    say: (_m, b) => {
      const input = (b['input'] ?? {}) as Body;
      return {
        action: text(b['editing']) === null ? 'Added a field' : 'Changed a field',
        subject: text(input['label']),
      };
    },
  },
  {
    path: /^\/v1\/schema\/draft\/publish$/,
    area: 'fields',
    say: () => ({ action: 'Published the employee fields' }),
  },
  {
    path: /^\/v1\/views\/setup\/publish$/,
    area: 'fields',
    say: () => ({ action: 'Set up People and published its fields' }),
  },
  {
    path: /^\/v1\/views\/setup\/entity$/,
    area: 'organisation',
    say: (_m, b) => ({ action: 'Added the first legal entity', subject: text(b['name']) }),
  },
  {
    path: /^\/v1\/settings$/,
    area: 'organisation',
    say: (_m, b) => ({
      action: 'Changed the company settings',
      subject:
        Object.keys(b)
          .map(
            (k) =>
              ({
                defaultTimeZone: 'default time zone',
                cohortMinimum: 'smallest group reported',
                photoAtSignup: 'photo at sign-up',
              })[k] ?? k,
          )
          .join(', ') || null,
    }),
  },
  {
    path: /^\/v1\/legal-entities$/,
    area: 'organisation',
    say: (_m, b) => ({ action: 'Added a legal entity', subject: text(b['name']) }),
  },
  {
    path: new RegExp(`^/v1/legal-entities/${ID}$`),
    area: 'organisation',
    say: (_m, b) => ({
      action: b['archived'] === true ? 'Archived a legal entity' : 'Changed a legal entity',
      subject: text(b['name']),
    }),
  },
  {
    path: new RegExp(`^/v1/legal-entities/${ID}/numbering$`),
    area: 'organisation',
    say: (_m, b) => ({ action: 'Set employee numbering', subject: text(b['prefix']) }),
  },
  {
    path: /^\/v1\/locations$/,
    area: 'organisation',
    say: (_m, b) => ({ action: 'Added a work location', subject: text(b['name']) }),
  },
  {
    path: new RegExp(`^/v1/locations/${ID}$`),
    area: 'organisation',
    say: (_m, b) => ({
      action: b['archived'] === true ? 'Archived a work location' : 'Changed a work location',
      subject: text(b['name']),
    }),
  },
  {
    path: new RegExp(`^/v1/locations/${ID}/zones$`),
    area: 'organisation',
    say: (_m, b) => ({ action: 'Changed a location’s time zone', subject: text(b['timeZone']) }),
  },
  {
    path: /^\/v1\/pay-bands$/,
    area: 'organisation',
    say: (_m, b) => ({ action: 'Changed a pay band', subject: text(b['grade']) }),
  },
  {
    path: /^\/v1\/roles\/grants$/,
    area: 'roles',
    say: (_m, b) => ({ action: 'Granted a role', subject: text(b['role']) }),
  },
  {
    path: /^\/v1\/roles\/revocations$/,
    area: 'roles',
    say: (_m, b) => ({ action: 'Removed a role', subject: text(b['role']) }),
  },
  {
    path: /^\/v1\/webhooks\/endpoints$/,
    area: 'integrations',
    say: () => ({ action: 'Added a webhook' }),
  },
  {
    path: new RegExp(`^/v1/webhooks/endpoints/${ID}$`),
    area: 'integrations',
    say: (m) => ({ action: m === 'DELETE' ? 'Removed a webhook' : 'Changed a webhook' }),
  },
  {
    path: new RegExp(`^/v1/webhooks/endpoints/${ID}/rotate$`),
    area: 'integrations',
    say: () => ({ action: 'Rotated a webhook’s signing secret' }),
  },
  {
    path: /^\/v1\/scim\/connections$/,
    area: 'integrations',
    say: (_m, b) => ({ action: 'Connected provisioning', subject: text(b['system']) }),
  },
  {
    path: new RegExp(`^/v1/scim/connections/${ID}/rotate$`),
    area: 'integrations',
    say: () => ({ action: 'Rotated a provisioning token' }),
  },
  {
    path: new RegExp(`^/v1/scim/connections/${ID}/revoke$`),
    area: 'integrations',
    say: () => ({ action: 'Disconnected provisioning' }),
  },
  {
    path: new RegExp(`^/v1/scim/connections/${ID}/mapping$`),
    area: 'integrations',
    say: () => ({ action: 'Changed which fields provisioning sets' }),
  },
  {
    path: /^\/v1\/chat\/apps\/([a-z]+)\/complete$/,
    area: 'integrations',
    say: (_m, _b, id) => ({ action: 'Connected a chat app', subject: appName(id) }),
  },
  {
    path: /^\/v1\/chat\/apps\/([a-z]+)\/disconnect$/,
    area: 'integrations',
    say: (_m, _b, id) => ({ action: 'Disconnected a chat app', subject: appName(id) }),
  },
  {
    path: /^\/v1\/chat\/notices\/([a-z_]+)$/,
    area: 'integrations',
    say: (_m, b, id) => ({
      action: b['on'] === true ? 'Turned on a chat notice' : 'Turned off a chat notice',
      subject: PEOPLE_NOTICES.find((n) => n.key === id)?.label ?? null,
    }),
  },
];

/** How a successful command reads in the settings log, or null for one that is not a setting. */
export function settingsActivity(
  method: string,
  path: string,
  rawBody: string,
): (Said & { readonly area: ActivityArea }) | null {
  if (method === 'GET') return null;
  for (const rule of RULES) {
    const match = rule.path.exec(path);
    if (match === null) continue;
    let body: Body = {};
    try {
      const parsed: unknown = rawBody === '' ? {} : JSON.parse(rawBody);
      if (typeof parsed === 'object' && parsed !== null) body = parsed as Body;
    } catch {
      // Described without it.
    }
    const said = rule.say(method, body, match[1]);
    return said === null ? null : { ...said, area: rule.area };
  }
  return null;
}
