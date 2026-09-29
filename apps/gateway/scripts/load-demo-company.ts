import { createHash, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

import {
  CLIENT_NAME,
  OPERATIONS,
  type OperationName,
} from '../../web/src/lib/people-operations.ts';
import {
  DUNDER_MIFFLIN,
  PART_TIME,
  type SeedPerson,
} from '../../../services/people/src/seed-companies.ts';
import { avatarFor, drawAvatar } from '../../../services/people/src/seed-photos.ts';

/**
 * Loads the Dunder Mifflin roster into a company that already exists, through
 * the product, the way its administrator would: `docs/demo-company.md` is the
 * runbook.
 *
 * It is a client of the router and nothing else. Every call is one of the
 * tenant app's persisted operations (`people-operations.ts`, the router's
 * safelist), sent with an access token identity issues for a signed-in
 * session — the administrator's, made by signing in with their passkey — so
 * People authorizes each write as that person, records it as theirs and runs
 * every rule it runs for the screen. It reads no table and holds no People
 * secret. The one privileged value is identity's internal token, which is how
 * the tenant app's own server turns a session into an access token
 * (`apps/web/src/lib/people.ts`); nothing else about this script is trusted.
 *
 * What it loads, each step skipped where it is already done, so a second run
 * changes nothing: version 1 of the profile (the setup wizard's publish), the
 * seed's fields, the locations, the people (added by work email, hired from
 * their start date), their details and reporting lines, where they work, and
 * a photo for everybody who has none (`seed-photos.ts`).
 *
 * `--dry-run` reads everything and writes nothing, and says what it would
 * have written.
 *
 *     KITHENA_IDENTITY_URL=https://identity.kithena.com \
 *     KITHENA_ROUTER_URL=https://api.kithena.com \
 *     KITHENA_INTERNAL_TOKEN=… KITHENA_SESSION=… \
 *     pnpm --filter @kithena/gateway load-demo -- --company dunder-mifflin --dry-run
 */

const { values: flags } = parseArgs({
  options: {
    company: { type: 'string' },
    identity: { type: 'string' },
    router: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

/** A setting from its flag, else the environment; secrets only from the environment. */
function setting(flag: string | undefined, env: string): string {
  const value = flag ?? process.env[env] ?? '';
  if (value === '') {
    console.error(`${env} is not set. See docs/demo-company.md.`);
    process.exit(2);
  }
  return value;
}

const dryRun = flags['dry-run'];
const slug = setting(flags.company, 'KITHENA_COMPANY');
const identityUrl = setting(flags.identity, 'KITHENA_IDENTITY_URL').replace(/\/$/, '');
const routerUrl = setting(flags.router, 'KITHENA_ROUTER_URL').replace(/\/$/, '');
const internalToken = setting(undefined, 'KITHENA_INTERNAL_TOKEN');
const sessionId = setting(undefined, 'KITHENA_SESSION');

const company = DUNDER_MIFFLIN;
const emailOf = (handle: string): string => `${handle}@${company.slug}.example`;
const today = new Date().toISOString().slice(0, 10);
/** What the registry makes of an option's label: "Human Resources" is `human_resources`. */
const optionKey = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/* ---------------------------------------------------------- transport -- */

/** Identity's internal API, as the tenant app's server calls it: a GET, or a POST of `body`. */
async function identity(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${identityUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': internalToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`identity answered ${String(response.status)} for ${path}`);
  return response.json();
}

const tenant = (await identity(`/api/internal/tenant/${encodeURIComponent(slug)}`)) as {
  id: string;
  branding: { displayName: string };
};

let token: { value: string; until: number } | null = null;
/** An access token for the session, refreshed a minute before it lapses. */
async function accessToken(): Promise<string> {
  if (token !== null && Date.now() < token.until) return token.value;
  const issued = (await identity('/api/internal/session/token', {
    sessionId,
    tenantId: tenant.id,
  }).catch(() => {
    throw new Error(
      `identity refused the session for ${slug}: sign in again and copy the new cookie`,
    );
  })) as { accessToken: string; expiresAt: string };
  token = { value: issued.accessToken, until: Date.parse(issued.expiresAt) - 60_000 };
  return token.value;
}

/** One persisted operation, through the router, as the person signed in. */
async function gql<T>(name: OperationName, variables: Record<string, unknown> = {}): Promise<T> {
  const query = OPERATIONS[name];
  const keyed = query.includes('$key: String!');
  const response = await fetch(`${routerUrl}/graphql`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      'graphql-client-name': CLIENT_NAME,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query,
      operationName: name,
      variables: keyed ? { ...variables, key: randomUUID() } : variables,
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: createHash('sha256').update(query).digest('hex'),
        },
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if ([502, 503, 504, 521, 522, 523, 530].includes(response.status)) {
    throw new Error(
      `the router did not answer (${String(response.status)}): is the VM asleep? Open People in the browser to wake it.`,
    );
  }
  const answer = (await response.json().catch(() => null)) as {
    data?: Record<string, unknown> | null;
    errors?: { message?: string }[];
  } | null;
  const error = answer?.errors?.[0];
  if (error !== undefined || answer?.data == null) {
    throw new Error(`${name}: ${error?.message ?? `HTTP ${String(response.status)}`}`);
  }
  return Object.values(answer.data)[0] as T;
}

let writes = 0;
/** A write, or in a dry run the sentence saying what it would have been. */
async function write<T>(
  what: string,
  name: OperationName,
  variables: Record<string, unknown>,
): Promise<T | null> {
  writes += 1;
  console.log(`${dryRun ? 'would ' : ''}${what}`);
  return dryRun ? null : gql<T>(name, variables);
}

/* -------------------------------------------------------------- steps -- */

console.log(
  `${dryRun ? 'Dry run: ' : ''}loading ${company.displayName} into ${tenant.branding.displayName} (${slug}) at ${routerUrl}`,
);

const roles = await gql<{ hr: boolean; admin: boolean }>('Home');
if (!roles.admin || !roles.hr) {
  throw new Error('the signed-in person is not People’s administrator and HR at this company');
}

// 1. Version 1: the setup wizard's publish, in the country of the first entity.
const setup = await gql<{ published: boolean; legalEntity: { country: string } | null }>('Setup');
if (!setup.published) {
  await write('publish version 1 of the profile', 'PublishSetup', {
    country: setup.legalEntity?.country ?? company.country,
    sections: [],
  });
}

// 2. The seed's fields, then one publish for all of them.
const registry = await gql<{ fields: { key: string; pending: boolean }[] }>('Registry');
const known = new Map(registry.fields.map((f) => [f.key, f.pending]));
let drafted = [...known.values()].some(Boolean);
for (const f of company.fields) {
  if (known.has(f.key)) continue;
  drafted = true;
  await write(`add the field ${f.key}`, 'SaveDraftField', {
    editing: null,
    input: {
      key: f.key,
      sectionKey: f.sectionKey,
      label: f.label,
      description: f.description ?? null,
      dataType: f.dataType,
      options: f.options ?? [],
      requiredness: f.requiredness ?? 'never',
      ownership: f.ownership ?? ['hr'],
      collectAt: f.collectAt ?? 'hr_only',
      visibility: f.visibility ?? ['self', 'manager', 'manager_chain', 'hr', 'directory'],
      classification: f.classification ?? 'internal',
      piiKind: f.piiKind ?? 'none',
      classificationSource: 'human',
    },
  });
}
if (drafted) await write('publish the new fields', 'PublishDraft', { requiredFrom: today });

// 3. The locations, under the first legal entity.
const org = await gql<{
  legalEntities: { id: string; archived: boolean }[];
  locations: { id: string; name: string }[];
}>('Organisation');
const entityId = org.legalEntities.find((e) => !e.archived)?.id;
if (entityId === undefined) throw new Error('the company has no legal entity');
const locationId = new Map<string, string>();
for (const loc of company.locations) {
  const had = org.locations.find((l) => l.name === loc.name);
  if (had !== undefined) {
    locationId.set(loc.key, had.id);
    continue;
  }
  const made = await write<{ id: string }>(`add the location ${loc.name}`, 'CreateLocation', {
    legalEntityId: entityId,
    name: loc.name,
    country: company.country,
    timeZone: loc.timeZone,
  });
  if (made !== null) locationId.set(loc.key, made.id);
}

// Nothing about people can be read before version 1 is published.
if (dryRun && !setup.published) {
  console.log(
    `would then add ${String(company.people.length - 1)} people, complete the administrator's own record, and set everybody's details, places and photos`,
  );
  process.exit(0);
}

// 4. The people, by work email. The administrator is the person signed in,
// whose record identity's account already made.
type Directory = {
  people: { id: string; email: string | null }[];
  next: string | null;
};
const byEmail = new Map<string, string>();
for (let after: string | null = null; ;) {
  const page: Directory = await gql<Directory>('Directory', { after });
  for (const p of page.people) if (p.email !== null) byEmail.set(p.email.toLowerCase(), p.id);
  if (page.next === null) break;
  after = page.next;
}
const me = await gql<{ me: { id: string; name: string | null; email: string | null } }>('Overview');
// Their own record becomes Toby's: refuse anybody who already has another name.
const signedIn = me.me.name ?? '';
if (signedIn !== '' && signedIn !== me.me.email && !/toby/i.test(signedIn)) {
  throw new Error(
    `the signed-in administrator is ${signedIn}; sign in as Toby, whom the back office named`,
  );
}
const idOf = (person: SeedPerson): string | undefined =>
  person.handle === company.admin.handle ? me.me.id : byEmail.get(emailOf(person.handle));

for (const person of company.people) {
  if (idOf(person) !== undefined) continue;
  const location = person.location === undefined ? undefined : locationId.get(person.location);
  const made = await write<{ id: string }>(
    `add ${person.given} ${person.family}${person.hireDate === null ? '' : `, hired from ${person.hireDate}`}`,
    'CreatePerson',
    {
      attributes: [
        { key: 'given_name', text: person.given },
        { key: 'family_name', text: person.family },
        { key: 'work_email', text: emailOf(person.handle) },
        { key: 'legal_entity_id', text: entityId },
        ...(location === undefined ? [] : [{ key: 'location_id', text: location }]),
      ],
      hireDate: person.hireDate,
    },
  );
  if (made !== null) byEmail.set(emailOf(person.handle), made.id);
}

// 5. Everybody's details, reporting line, place and photo: only what differs.
type Profile = {
  person: { avatarUrl: string | null };
  values: { key: string; text?: string | null }[];
  placement: { legalEntityId: string | null; locationId: string | null };
  employment: { status: string };
};
let held = 0;
for (const [index, person] of company.people.entries()) {
  const id = idOf(person);
  const name = `${person.given} ${person.family}`;
  if (id === undefined) continue; // added in a dry run
  const profile = await gql<Profile>('Profile', { personId: id });
  const current = new Map(profile.values.map((v) => [v.key, v.text ?? null]));
  const managerId =
    person.manager === null
      ? undefined
      : idOf(company.people.find((p) => p.handle === person.manager) as SeedPerson);
  const choices = new Set(company.fields.filter((f) => f.dataType === 'select').map((f) => f.key));
  const wanted: Record<string, string> = {
    given_name: person.given,
    family_name: person.family,
    job_title: person.title,
    department: optionKey(person.department),
    working_hours: optionKey(PART_TIME.has(person.handle) ? 'Part time' : 'Full time'),
    ...(managerId === undefined ? {} : { manager_id: managerId }),
    ...Object.fromEntries(
      Object.entries(person.details ?? {}).map(([key, value]) => [
        key,
        choices.has(key) ? optionKey(String(value)) : String(value),
      ]),
    ),
  };
  const changed = Object.entries(wanted)
    .filter(([key, text]) => current.get(key) !== text)
    .map(([key, text]) => ({ key, text }));
  if (changed.length > 0) {
    const saved = await write<{ held: string[] | null }>(
      `set ${changed.map((c) => c.key).join(', ')} for ${name}`,
      'SavePersonSection',
      { personId: id, changed },
    );
    held += saved?.held?.length ?? 0;
  }

  const location = person.location === undefined ? null : (locationId.get(person.location) ?? null);
  if (
    location !== null &&
    (profile.placement.locationId !== location || profile.placement.legalEntityId !== entityId)
  ) {
    await write(`place ${name} at ${person.location ?? ''}`, 'PlacePerson', {
      personId: id,
      legalEntityId: entityId,
      locationId: location,
    });
  }

  // The administrator's record starts provisional, as identity made it.
  if (profile.employment.status === 'provisional' && person.hireDate !== null) {
    await write(`hire ${name} from ${person.hireDate}`, 'HirePerson', {
      personId: id,
      hireDate: person.hireDate,
    });
  }

  if (profile.person.avatarUrl === null) {
    const bytes = drawAvatar(avatarFor(person.handle, index));
    writes += 1;
    console.log(`${dryRun ? 'would ' : ''}upload a photo for ${name}`);
    if (dryRun) continue;
    const target = await gql<{
      uploadId: string;
      url: string;
      method: string;
      headers: { name: string; value: string }[];
    }>('StartPhotoUpload', { personId: id, size: bytes.byteLength });
    const put = await fetch(target.url, {
      method: target.method,
      headers: Object.fromEntries(
        target.headers
          .filter((h) => h.name.toLowerCase() !== 'content-length')
          .map((h) => [h.name, h.value]),
      ),
      body: bytes as Uint8Array<ArrayBuffer>,
    });
    if (!put.ok) throw new Error(`the photo for ${name} was not stored: ${String(put.status)}`);
    await gql('CompletePhotoUpload', { personId: id, uploadId: target.uploadId });
  }
}

console.log(
  writes === 0
    ? 'Nothing to do: the company already has everything.'
    : `${dryRun ? 'Would have made' : 'Made'} ${String(writes)} change${writes === 1 ? '' : 's'}.${held > 0 ? ` ${String(held)} value${held === 1 ? ' is' : 's are'} waiting for approval.` : ''}`,
);
