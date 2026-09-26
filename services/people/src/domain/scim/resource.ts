import { CORE_USER, ENTERPRISE_USER, KITHENA_USER, getCI, isObject, type Json } from './paths.js';

export { CORE_USER, CORE_GROUP, ENTERPRISE_USER, KITHENA_USER } from './paths.js';

/**
 * A SCIM User and a Kithena record, both ways (PRD §13.5).
 *
 * A mapping names paths from this list, or a tenant-defined attribute under
 * Kithena's extension (`<urn>:<attribute key>`), and nothing else of a User
 * reaches a record. `userName`, `externalId` and `active` are the link
 * between the two systems; `userName` may also be mapped, usually to the
 * work email.
 */

const WORK_EMAIL = 'emails[type eq "work"].value';
const PHONES = { 'phoneNumbers[type eq "work"].value': 'work', 'phoneNumbers[type eq "mobile"].value': 'mobile' } as const;
const NAME = ['givenName', 'familyName', 'middleName'] as const;
const TOP = ['displayName', 'nickName', 'title', 'userType', 'preferredLanguage', 'locale', 'timezone'] as const;
const ENTERPRISE = ['employeeNumber', 'costCenter', 'organization', 'division', 'department'] as const;

/** Every core path a mapping may name, in the order a settings screen lists them. */
export const USER_PATHS: readonly string[] = [
  'userName',
  ...NAME.map((n) => `name.${n}`),
  ...TOP,
  WORK_EMAIL,
  ...Object.keys(PHONES),
  ...ENTERPRISE.map((n) => `${ENTERPRISE_USER}:${n}`),
];

const EXTENSION_KEY = new RegExp(`^${KITHENA_USER.replaceAll('.', '\\.')}:([a-z][a-z0-9_]{0,63})$`, 'u');

export function isMappablePath(path: string): boolean {
  return USER_PATHS.includes(path) || EXTENSION_KEY.test(path);
}

/** The attribute a Kithena extension path names; null for a core path. */
export const extensionKeyOf = (path: string): string | null => EXTENSION_KEY.exec(path)?.[1] ?? null;

type Values = Readonly<Record<string, unknown>>;

const typed = (items: unknown, type: string): Json | undefined =>
  Array.isArray(items)
    ? (items.find((i) => isObject(i) && String(getCI(i, 'type')).toLowerCase() === type) as Json | undefined)
    : undefined;

const isPrimary = (i: unknown) => isObject(i) && String(getCI(i, 'primary')).toLowerCase() === 'true';

/** A User's values under the paths a mapping may name. Absent stays absent. */
export function valuesOf(resource: Json): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (path: string, value: unknown) => {
    if (value !== undefined) out[path] = value;
  };
  put('userName', getCI(resource, 'userName'));
  const name = getCI(resource, 'name');
  for (const n of NAME) put(`name.${n}`, getCI(name, n));
  for (const n of TOP) put(n, getCI(resource, n));

  const emails = getCI(resource, 'emails');
  const email = Array.isArray(emails)
    ? (typed(emails, 'work') ?? emails.find(isPrimary) ?? (emails[0] as unknown))
    : undefined;
  put(WORK_EMAIL, getCI(email, 'value'));
  const phones = getCI(resource, 'phoneNumbers');
  for (const [path, type] of Object.entries(PHONES)) put(path, getCI(typed(phones, type), 'value'));

  const enterprise = getCI(resource, ENTERPRISE_USER);
  for (const n of ENTERPRISE) put(`${ENTERPRISE_USER}:${n}`, getCI(enterprise, n));
  const kithena = getCI(resource, KITHENA_USER);
  if (isObject(kithena)) {
    for (const [key, value] of Object.entries(kithena)) {
      if (EXTENSION_KEY.test(`${KITHENA_USER}:${key}`)) put(`${KITHENA_USER}:${key}`, value);
    }
  }
  return out;
}

export interface MappingEntry {
  readonly path: string;
  readonly key: string;
}

/**
 * What a User's values write to a record, through the mapping.
 *
 * `replace` is a PUT: a mapped path the body leaves out is cleared. `merge`
 * is a POST or a PATCH's result: only what the body carries. An empty string
 * is a cleared value, as a form's is.
 */
export function changesFor(
  values: Values,
  mapping: readonly MappingEntry[],
  mode: 'replace' | 'merge',
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { path, key } of mapping) {
    const value = values[path];
    if (value === undefined) {
      if (mode === 'replace') out[key] = null;
      continue;
    }
    out[key] = value === '' ? null : value;
  }
  return out;
}

export interface UserInput {
  readonly id: string;
  readonly userName: string;
  readonly externalId: string | null;
  readonly active: boolean;
  /** The record's values, under the paths they are mapped from. */
  readonly values: Values;
  readonly meta: { readonly created: string; readonly lastModified: string; readonly location: string };
}

/** A User as the RFC shapes one: only what is set, and each extension only when it holds something. */
export function userResource(input: UserInput): Json {
  const v = (path: string) => {
    const value = input.values[path];
    return value === undefined || value === null ? undefined : value;
  };
  const pick = (entries: [string, unknown][]) =>
    Object.fromEntries(entries.filter(([, value]) => value !== undefined));

  const name = pick(NAME.map((n) => [n, v(`name.${n}`)]));
  const email = v(WORK_EMAIL);
  const phones = Object.entries(PHONES).flatMap(([path, type]) => {
    const value = v(path);
    return value === undefined ? [] : [{ value, type }];
  });
  const enterprise = pick(ENTERPRISE.map((n) => [n, v(`${ENTERPRISE_USER}:${n}`)]));
  const kithena = pick(
    Object.keys(input.values).flatMap((path) => {
      const key = extensionKeyOf(path);
      return key === null ? [] : [[key, v(path)] as [string, unknown]];
    }),
  );
  const has = (o: Json) => Object.keys(o).length > 0;

  return {
    schemas: [CORE_USER, ...(has(enterprise) ? [ENTERPRISE_USER] : []), ...(has(kithena) ? [KITHENA_USER] : [])],
    id: input.id,
    ...(input.externalId === null ? {} : { externalId: input.externalId }),
    userName: input.userName,
    active: input.active,
    ...(has(name) ? { name } : {}),
    ...pick(TOP.map((n) => [n, v(n)])),
    ...(email === undefined ? {} : { emails: [{ value: email, type: 'work', primary: true }] }),
    ...(phones.length === 0 ? {} : { phoneNumbers: phones }),
    ...(has(enterprise) ? { [ENTERPRISE_USER]: enterprise } : {}),
    ...(has(kithena) ? { [KITHENA_USER]: kithena } : {}),
    meta: { resourceType: 'User', ...input.meta },
  };
}
