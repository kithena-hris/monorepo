import type { AttributeDefinition } from '@kithena/contracts';

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
type Said = {
  readonly action: string;
  readonly subject?: string | null;
  /** What it did, in one plain sentence. */
  readonly detail?: string | null;
};
interface Rule {
  readonly path: RegExp;
  readonly area: ActivityArea;
  readonly say: (method: string, body: Body, id: string | undefined) => Said | null;
}

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 300) : null;
const ID = '([^/]+)';

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const joined = (words: readonly string[]): string =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;

/** Who a field's settings name, as the log says them. */
const WRITER: Readonly<Record<string, string>> = {
  employee: 'the employee',
  manager: 'their manager',
  hr: 'HR',
  finance: 'finance',
  admin: 'People administrators',
  system: 'an integration',
};
const SEER: Readonly<Record<string, string>> = {
  self: 'the employee',
  manager: 'their manager',
  manager_chain: 'managers above them',
  hr: 'HR',
  finance: 'finance',
  admin: 'People administrators',
  directory: 'everyone in the directory',
};
const ROLE: Readonly<Record<string, string>> = {
  people_admin: 'People administrator',
  hr: 'HR',
  finance: 'Finance',
  manager: 'Manager',
};

/** A field's settings as one sentence: who fills it in, who sees it, whether it is required. */
function fieldDetail(input: Body): string | null {
  const writers = list(input['ownership']).map((w) => WRITER[w] ?? w);
  const seers = list(input['visibility']).map((v) => SEER[v] ?? v);
  const need =
    input['requiredness'] === 'always'
      ? 'Required.'
      : input['requiredness'] === 'conditional'
        ? 'Required on some records.'
        : 'Optional.';
  const parts = [
    writers.length === 0 ? null : `Filled in by ${joined(writers)}.`,
    seers.length === 0 ? null : `Seen by ${joined(seers)}.`,
    need,
  ].filter((x) => x !== null);
  return parts.length === 0 ? null : `${parts.join(' ')} In the draft until published.`;
}

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
      detail:
        b['ask'] === 'off'
          ? 'Sign-up no longer asks for it.'
          : b['ask'] === 'required'
            ? 'Everyone signing up must fill it in.'
            : 'Sign-up asks for it, and people may skip it.',
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
      detail:
        b['share'] === true
          ? 'The assistant can answer questions about it, in Kithena and in chat apps. It learns the field’s name and choices, never anybody’s value.'
          : 'The assistant no longer uses it, and chat messages no longer show its values.',
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
        detail: fieldDetail(input),
      };
    },
  },
  {
    path: /^\/v1\/schema\/draft\/publish$/,
    area: 'fields',
    say: () => ({
      action: 'Published the employee fields',
      detail: 'Every form now uses the fields as drafted, for everyone.',
    }),
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
      detail:
        [
          typeof b['defaultTimeZone'] === 'string' ? `Default time zone is now ${b['defaultTimeZone']}.` : null,
          typeof b['cohortMinimum'] === 'number'
            ? `Reports hide any group smaller than ${String(b['cohortMinimum'])}.`
            : null,
          b['photoAtSignup'] === 'off'
            ? 'Sign-up no longer asks for a photo.'
            : b['photoAtSignup'] === 'optional'
              ? 'Sign-up asks for a photo, and people may skip it.'
              : b['photoAtSignup'] === 'required'
                ? 'Everyone signing up must add a photo.'
                : null,
        ]
          .filter((x) => x !== null)
          .join(' ') || null,
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
    say: (_m, b) => ({
      action: 'Granted a role',
      subject: ROLE[String(b['role'])] ?? text(b['role']),
    }),
  },
  {
    path: /^\/v1\/roles\/revocations$/,
    area: 'roles',
    say: (_m, b) => ({
      action: 'Removed a role',
      subject: ROLE[String(b['role'])] ?? text(b['role']),
    }),
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
    say: (_m, _b, id) => ({
      action: 'Connected a chat app',
      subject: appName(id),
      detail: 'People can ask Kithena questions there, and switched-on notices arrive there.',
    }),
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
      detail:
        b['on'] === true
          ? 'Now sent to connected chat apps as well as by email.'
          : 'By email only from now on.',
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


/* ------------------------------------------------ what changed, from what -- */

/** What a settings command changes, to read before and after it. */
export type ActivityTarget = { readonly kind: 'field'; readonly key: string } | { readonly kind: 'settings' };

/** What the log reads to compare: the thing, as it is. */
export interface ActivityReads {
  field(key: string): Promise<AttributeDefinition | null>;
  settings(): Promise<{
    readonly defaultTimeZone: string;
    readonly cohortMinimum: number;
    readonly photoAtSignup: string;
  } | null>;
}

const FIELD_ROUTE = /^\/v1\/schema\/draft\/attributes\/([a-z][a-z0-9_]{0,63})\/(signup|assistant)$/;

/** Which thing a successful command changes, when it is one the log compares. */
export function activityTarget(method: string, path: string, rawBody: string): ActivityTarget | null {
  if (method === 'GET') return null;
  if (path === '/v1/settings') return { kind: 'settings' };
  const own = FIELD_ROUTE.exec(path);
  if (own?.[1] !== undefined) return { kind: 'field', key: own[1] };
  if (path === '/v1/schema/draft/attributes') {
    try {
      const body = JSON.parse(rawBody) as Body;
      const editing = text(body['editing']);
      return editing === null ? null : { kind: 'field', key: editing };
    } catch {
      return null;
    }
  }
  return null;
}

const yes = (b: boolean): string => (b ? 'Yes' : 'No');
const REQUIRED: Readonly<Record<string, string>> = {
  always: 'Yes',
  conditional: 'On some records',
  never: 'No',
};

/** A field's settings as the log compares them, in words. */
export function fieldFacts(a: AttributeDefinition): Record<string, string> {
  return {
    Name: a.label.default,
    Description: a.description?.default ?? '',
    'Filled in by': joined(a.ownership.map((w) => WRITER[w] ?? w)),
    'Seen by':
      joined(a.visibility.map((v) => SEER[v] ?? v)) +
      ((a.visibilityRules ?? []).length === 0 ? '' : ', and more on some records'),
    Required: REQUIRED[a.requiredness.mode] ?? a.requiredness.mode,
    Protection: a.classification.classification,
    Encrypted: yes(a.encrypted),
    'Assistant and chat': a.classification.aiEligible ? 'Shared' : 'Not shared',
    'Asked at': a.collectAt.replaceAll('_', ' '),
  };
}

export function settingsFacts(s: NonNullable<Awaited<ReturnType<ActivityReads['settings']>>>): Record<string, string> {
  return {
    'Default time zone': s.defaultTimeZone,
    'Smallest group reported': String(s.cohortMinimum),
    'Photo at sign-up': s.photoAtSignup === 'off' ? 'Not asked' : s.photoAtSignup === 'optional' ? 'Optional' : 'Required',
  };
}

/** What differs, as "Seen by: HR → HR and their manager." — or null when nothing does. */
export function changes(
  before: Readonly<Record<string, string>> | null,
  after: Readonly<Record<string, string>> | null,
): string | null {
  if (before === null || after === null) return null;
  const said = Object.keys(after)
    .filter((k) => (before[k] ?? '') !== (after[k] ?? ''))
    .map((k) => `${k}: ${before[k] === '' || before[k] === undefined ? 'none' : before[k]} → ${after[k] === '' ? 'none' : (after[k] ?? '')}.`);
  if (said.length === 0) return null;
  const all = said.join(' ');
  return all.length <= 500 ? all : `${all.slice(0, 497)}…`;
}

export async function factsOf(
  target: ActivityTarget,
  reads: ActivityReads,
): Promise<Record<string, string> | null> {
  if (target.kind === 'settings') {
    const s = await reads.settings();
    return s === null ? null : settingsFacts(s);
  }
  const a = await reads.field(target.key);
  return a === null ? null : fieldFacts(a);
}
