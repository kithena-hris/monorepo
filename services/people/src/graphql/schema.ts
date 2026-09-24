import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { maskError } from 'graphql-yoga';
import { toGraphQLError } from '@kithena/graphql-kit';
import { COUNTRIES } from '@kithena/contracts';
import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';

import type { Attribute } from '../domain/schema/draft.js';
import type { PublishedVersion } from '../domain/schema/publish.js';
import type { HistoryEntry } from '../domain/person/history.js';
import type {
  LegalEntityView,
  LocationView,
  OrgAdmin,
  TenantSettings,
} from '../application/org/org.js';
import type { NumberingView } from '../application/org/numbering.js';
import type { Asking, PersonView } from '../application/person/person-access.js';
import { run, type PeopleService } from '../application/person/service.js';
import type { CallerFrom } from '../http/caller.js';
import { LIFECYCLE_ACTIONS } from '../http/lifecycle.js';
import type { RestRequest, RestResponse } from '../http/rest.js';
import type { RoleHolder, TenantRoles } from '../application/roles/roles.js';
import { LEAVING_REASONS, type EmploymentPeriodRow } from '../domain/person/person.js';
import { statutoryFloors, type FloorView } from '../domain/retention/floors.js';
import { builder, type RequestContext, type ViaRest } from './builder.js';
import { defineScreens } from './screens.js';

export type { RequestContext } from './builder.js';

/**
 * The People subgraph. Thin: it maps a request to a use case and a domain
 * failure to a GraphQL error, and decides nothing.
 *
 * Every value comes from `personAccess`, which has already removed what the
 * viewer may not read. That is why attributes are a list of a union rather
 * than one field per attribute: a list can leave a withheld attribute out, and
 * a field cannot — GraphQL answers every field it was asked for, so a
 * `salary` field would come back `null` and tell a manager the field exists.
 *
 * Which member of the union an attribute is comes from its `dataType` in the
 * published version, never from the shape of the value.
 */

/* ------------------------------------------------------------- wiring -- */

/** REST's own dispatcher (`restHandler`): a write here is the same route's write. */
export type RestDispatch = (request: RestRequest) => Promise<RestResponse | null>;

let wiring: { service: PeopleService; callerFrom: CallerFrom; rest?: RestDispatch } | null = null;

/** Called once at boot by the composition root. */
export function configureGraphQL(next: {
  service: PeopleService;
  callerFrom: CallerFrom;
  rest?: RestDispatch;
}): void {
  wiring = next;
}

function fail(failure: DomainFailure): never {
  throw toGraphQLError(failure);
}

async function caller(ctx: RequestContext): Promise<{ service: PeopleService; asking: Asking }> {
  if (!wiring) return fail(failure('UNAVAILABLE', 'People is not configured'));
  const headers = Object.fromEntries(ctx.request?.headers.entries() ?? []);
  const asking = await wiring.callerFrom({ headers });
  if (!asking.ok) return fail(asking.error);
  return { service: wiring.service, asking: asking.value };
}

function unwrap<T>(result: Result<T>): T {
  return result.ok ? result.value : fail(result.error);
}


/**
 * One of REST's routes, in-process, as this request's caller (PEO-113).
 *
 * A mutation is the REST write of the same name: the same Zod body parses its
 * arguments, the same `Idempotency-Key` row makes a retry answer as the first
 * did (PEO-116), and the same refusal comes back — here as a GraphQL error
 * with the domain's code. The caller headers are the request's own, so the
 * route's caller check is the one every transport runs; an idempotency key
 * comes only from the argument.
 */
const viaRest: ViaRest = async <T>(
  ctx: RequestContext,
  method: string,
  path: string,
  options: { readonly body?: unknown; readonly key?: string } = {},
): Promise<T> => {
  const rest = wiring?.rest;
  if (!rest) return fail(failure('UNAVAILABLE', 'People is not configured'));
  const headers: Record<string, string> = {};
  for (const [name, value] of ctx.request?.headers.entries() ?? []) {
    if (name !== 'idempotency-key') headers[name] = value;
  }
  if (options.key !== undefined) headers['idempotency-key'] = options.key;
  const answer = await rest({
    method,
    url: path,
    headers,
    body: options.body === undefined ? '' : JSON.stringify(options.body),
  });
  if (answer === null) return fail(failure('NOT_FOUND', 'No such route'));
  if (answer.status >= 400) {
    const refused = (
      answer.body as {
        error?: { code?: string; message?: string; path?: string[]; link?: string };
      }
    ).error;
    const why = failure(refused?.code ?? 'INTERNAL', refused?.message ?? 'People refused', refused?.path);
    // A re-uploaded import's answer is the stored report of the first (PEO-090).
    return fail(refused?.link === undefined ? why : { ...why, link: refused.link });
  }
  return answer.body as T;
};

/** The person a write answered with, typed by the version in force. */
async function asPerson(ctx: RequestContext, view: PersonView): Promise<PersonShape> {
  const { service, asking } = await caller(ctx);
  const version = unwrap(
    await run(service, asking.tenantId, async (tx) =>
      ok(await service.schemas.current(tx, asking.tenantId)),
    ),
  );
  return { view, version };
}

/* --------------------------------------------------------- attributes -- */

type Member =
  | 'TextAttribute'
  | 'NumberAttribute'
  | 'BooleanAttribute'
  | 'DateAttribute'
  | 'MoneyAttribute'
  | 'ListAttribute'
  | 'AddressAttribute'
  | 'SealedAttribute'
  | 'RepeatingAttribute';

interface AttributeShape {
  readonly key: string;
  readonly member: Member;
  readonly value: unknown;
}

function scalarMember(definition: Attribute): Member {
  switch (definition.dataType) {
    case 'number':
    case 'percentage':
    case 'duration':
      return 'NumberAttribute';
    case 'boolean':
      return 'BooleanAttribute';
    case 'date':
    case 'datetime':
      return 'DateAttribute';
    case 'money':
      return 'MoneyAttribute';
    case 'multi_select':
    case 'tags':
      return 'ListAttribute';
    case 'address':
      return 'AddressAttribute';
    default:
      return 'TextAttribute';
  }
}

function shapeOf(definition: Attribute, value: unknown): AttributeShape {
  if (definition.encrypted) return { key: definition.key, member: 'SealedAttribute', value };
  if (definition.cardinality === 'repeating') {
    const items = Array.isArray(value) ? value : [];
    const member = scalarMember(definition);
    return {
      key: definition.key,
      member: 'RepeatingAttribute',
      value: items.map((item: unknown) => ({ key: definition.key, member, value: item })),
    };
  }
  return { key: definition.key, member: scalarMember(definition), value };
}

/** The view's attributes in the version's order, typed by the version. */
function attributesOf(view: PersonView, version: PublishedVersion | null): AttributeShape[] {
  if (!version) return [];
  return version.document.attributes
    .filter((d) => Object.hasOwn(view.attributes, d.key))
    .map((d) => shapeOf(d, view.attributes[d.key]));
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string | null =>
  typeof value === 'string'
    ? value
    : value === null || value === undefined
      ? null
      : JSON.stringify(value);

const member = (name: Member) => builder.objectRef<AttributeShape>(name);

const TextAttribute = member('TextAttribute').implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    value: t.string({ nullable: true, resolve: (a) => text(a.value) }),
  }),
});
const NumberAttribute = member('NumberAttribute').implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    value: t.float({
      nullable: true,
      resolve: (a) => (typeof a.value === 'number' ? a.value : null),
    }),
  }),
});
const BooleanAttribute = member('BooleanAttribute').implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    value: t.boolean({
      nullable: true,
      resolve: (a) => (typeof a.value === 'boolean' ? a.value : null),
    }),
  }),
});
const DateAttribute = member('DateAttribute').implement({
  description: 'A calendar date (YYYY-MM-DD) or an ISO 8601 instant, per the attribute.',
  fields: (t) => ({
    key: t.exposeString('key'),
    value: t.string({ nullable: true, resolve: (a) => text(a.value) }),
  }),
});
const MoneyAttribute = member('MoneyAttribute').implement({
  description: 'Minor units as a string: an Int is 32 bits, and money is never a float.',
  fields: (t) => ({
    key: t.exposeString('key'),
    amountMinor: t.string({ nullable: true, resolve: (a) => text(record(a.value)['amountMinor']) }),
    currency: t.string({ nullable: true, resolve: (a) => text(record(a.value)['currency']) }),
  }),
});
const ListAttribute = member('ListAttribute').implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    values: t.stringList({
      resolve: (a) => (Array.isArray(a.value) ? a.value.map((v: unknown) => String(v)) : []),
    }),
  }),
});
const AddressAttribute = member('AddressAttribute').implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    country: t.string({ nullable: true, resolve: (a) => text(record(a.value)['country']) }),
    line1: t.string({ nullable: true, resolve: (a) => text(record(a.value)['line1']) }),
    line2: t.string({ nullable: true, resolve: (a) => text(record(a.value)['line2']) }),
    city: t.string({ nullable: true, resolve: (a) => text(record(a.value)['city']) }),
    subdivision: t.string({ nullable: true, resolve: (a) => text(record(a.value)['subdivision']) }),
    postcode: t.string({ nullable: true, resolve: (a) => text(record(a.value)['postcode']) }),
  }),
});
const SealedAttribute = member('SealedAttribute').implement({
  description: 'An encrypted value. Only its last four characters are ever served.',
  fields: (t) => ({
    key: t.exposeString('key'),
    last4: t.string({ nullable: true, resolve: (a) => text(record(a.value)['last4']) }),
  }),
});

const PersonAttribute = builder.unionType('PersonAttribute', {
  types: [
    TextAttribute,
    NumberAttribute,
    BooleanAttribute,
    DateAttribute,
    MoneyAttribute,
    ListAttribute,
    AddressAttribute,
    SealedAttribute,
  ],
  resolveType: (a) => a.member,
});

const RepeatingAttribute = member('RepeatingAttribute').implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    items: t.field({ type: [PersonAttribute], resolve: (a) => a.value as AttributeShape[] }),
  }),
});

const AnyAttribute = builder.unionType('Attribute', {
  description: 'One attribute the viewer may read. A withheld attribute is absent from the list.',
  types: [
    TextAttribute,
    NumberAttribute,
    BooleanAttribute,
    DateAttribute,
    MoneyAttribute,
    ListAttribute,
    AddressAttribute,
    SealedAttribute,
    RepeatingAttribute,
  ],
  resolveType: (a) => a.member,
});

/* ------------------------------------------------------------- person -- */

interface PersonShape {
  readonly view: PersonView;
  readonly version: PublishedVersion | null;
}

/** People owns the Person key. Other modules extend it. */
const Person = builder.objectRef<PersonShape>('Person').implement({
  fields: (t) => ({
    id: t.id({ resolve: (p) => p.view.id }),
    status: t.string({ resolve: (p) => p.view.status }),
    schemaVersion: t.int({ nullable: true, resolve: (p) => p.view.schemaVersion }),
    attributes: t.field({ type: [AnyAttribute], resolve: (p) => attributesOf(p.view, p.version) }),
  }),
});

async function readPerson(ctx: RequestContext, id: string, asOf?: string): Promise<PersonShape> {
  const { service, asking } = await caller(ctx);
  return unwrap(
    await run(service, asking.tenantId, async (tx) => {
      const view = await service.access.read(tx, {
        ...asking,
        personId: id,
        ...(asOf ? { asOf } : {}),
      });
      if (!view.ok) return view;
      return ok({ view: view.value, version: await service.schemas.current(tx, asking.tenantId) });
    }),
  );
}

builder.asEntity(Person, {
  key: builder.selection<{ id: string }>('id'),
  resolveReference: (ref, ctx) => readPerson(ctx, ref.id),
});

const PersonPage = builder
  .objectRef<{ nodes: PersonShape[]; next: string | null }>('PersonPage')
  .implement({
    fields: (t) => ({
      nodes: t.field({ type: [Person], resolve: (p) => p.nodes }),
      nextCursor: t.string({ nullable: true, resolve: (p) => p.next }),
    }),
  });

const AttributeDescriptor = builder.objectRef<Attribute>('AttributeDescriptor').implement({
  fields: (t) => ({
    key: t.string({ resolve: (a) => a.key }),
    sectionKey: t.string({ resolve: (a) => a.sectionKey }),
    dataType: t.string({ resolve: (a) => a.dataType }),
    cardinality: t.string({ resolve: (a) => a.cardinality }),
    label: t.string({ resolve: (a) => a.label.default }),
  }),
});

const PeopleSchema = builder.objectRef<PublishedVersion>('PeopleSchema').implement({
  fields: (t) => ({
    version: t.exposeInt('version'),
    checksum: t.exposeString('checksum'),
    publishedAt: t.exposeString('publishedAt'),
    attributes: t.field({
      type: [AttributeDescriptor],
      resolve: (v) => [...v.document.attributes],
    }),
  }),
});

const HistoryEntryRef = builder.objectRef<HistoryEntry>('HistoryEntry').implement({
  fields: (t) => ({
    id: t.id({ resolve: (e) => e.id }),
    attributeKey: t.exposeString('attributeKey'),
    effectiveFrom: t.exposeString('effectiveFrom'),
    recordedAt: t.exposeString('recordedAt'),
    supersedes: t.id({ nullable: true, resolve: (e) => e.supersedes }),
  }),
});

/* ----------------------------------------- legal entities and settings -- */

const PeopleSettingsRef = builder.objectRef<TenantSettings>('PeopleSettings').implement({
  fields: (t) => ({
    defaultTimeZone: t.exposeString('defaultTimeZone'),
    cohortMinimum: t.exposeInt('cohortMinimum'),
    slug: t.string({ nullable: true, resolve: (s) => s.slug }),
    displayName: t.string({ nullable: true, resolve: (s) => s.displayName }),
  }),
});

const LegalEntityRef = builder.objectRef<LegalEntityView>('LegalEntity').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    country: t.exposeString('country'),
    timeZone: t.exposeString('timeZone'),
    archived: t.exposeBoolean('archived'),
  }),
});

const LocationZoneRef = builder.objectRef<LocationView['zones'][number]>('LocationZone').implement({
  fields: (t) => ({
    effectiveFrom: t.exposeString('effectiveFrom'),
    timeZone: t.exposeString('timeZone'),
  }),
});

const LocationRef = builder.objectRef<LocationView>('Location').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    legalEntityId: t.exposeID('legalEntityId'),
    name: t.exposeString('name'),
    country: t.exposeString('country'),
    timeZone: t.exposeString('timeZone', { description: 'The zone in force today.' }),
    zones: t.field({ type: [LocationZoneRef], resolve: (l) => [...l.zones] }),
    archived: t.exposeBoolean('archived'),
  }),
});

/** A legal entity, location or settings use case for this caller, in its own transaction. */
async function inOrg<T>(
  ctx: RequestContext,
  fn: (org: OrgAdmin, tx: PostgresJsDatabase, asking: Asking) => Promise<Result<T>>,
): Promise<T> {
  const { service, asking } = await caller(ctx);
  const { org } = service;
  if (!org) return fail(failure('UNAVAILABLE', 'Legal entities and settings are not configured'));
  return unwrap(await run(service, asking.tenantId, (tx) => fn(org, tx, asking)));
}

/** Only the arguments a caller actually sent, for `exactOptionalPropertyTypes`. */
function sent<T extends object>(args: T): { [K in keyof T]?: Exclude<T[K], null | undefined> } {
  return Object.fromEntries(
    Object.entries(args).filter(([, v]) => v !== null && v !== undefined),
  ) as { [K in keyof T]?: Exclude<T[K], null | undefined> };
}

/* ------------------------------------------------------------- inputs -- */

const MoneyInput = builder.inputType('MoneyInput', {
  fields: (t) => ({
    amountMinor: t.string({ required: true }),
    currency: t.string({ required: true }),
  }),
});

const AddressInput = builder.inputType('AddressInput', {
  fields: (t) => ({
    country: t.string({ required: true }),
    line1: t.string({ required: true }),
    line2: t.string(),
    city: t.string({ required: true }),
    subdivision: t.string(),
    postcode: t.string(),
  }),
});

/**
 * One value, in exactly one of its typed slots. `clear: true` removes it.
 *
 * The slot says what kind of value this is; the application checks it against
 * the attribute's definition, as it does for REST.
 */
const AttributeValueInput = builder.inputType('AttributeValueInput', {
  fields: (t) => ({
    key: t.string({ required: true }),
    text: t.string(),
    number: t.float(),
    boolean: t.boolean(),
    money: t.field({ type: MoneyInput }),
    list: t.stringList(),
    address: t.field({ type: AddressInput }),
    clear: t.boolean(),
  }),
});

type ValueInput = typeof AttributeValueInput.$inferInput;

/** The one slot that was filled, as the value the application validates. */
export function valueOf(input: Partial<ValueInput>): Result<unknown> {
  const slots = Object.entries(input).filter(
    ([slot, v]) => slot !== 'key' && v !== null && v !== undefined,
  );
  if (slots.length !== 1) {
    return err(
      failure('BAD_INPUT', 'Exactly one of text, number, boolean, money, list, address or clear'),
    );
  }
  const [slot, value] = slots[0] as [string, unknown];
  if (slot === 'clear')
    return value === true ? ok(null) : err(failure('BAD_INPUT', 'clear is only ever true'));
  if (slot === 'money') {
    const money = value as { amountMinor: string; currency: string };
    const amount = Number(money.amountMinor);
    if (!/^-?\d+$/.test(money.amountMinor) || !Number.isSafeInteger(amount)) {
      return err(failure('BAD_INPUT', 'amountMinor is a whole number of minor units'));
    }
    return ok({ amountMinor: amount, currency: money.currency });
  }
  if (slot === 'address') {
    const a = value as Record<string, unknown>;
    return ok({
      country: a['country'],
      line1: a['line1'],
      line2: a['line2'] ?? null,
      city: a['city'],
      subdivision: a['subdivision'] ?? null,
      postcode: a['postcode'] ?? null,
    });
  }
  return ok(value);
}

/* --------------------------------------------------------- operations -- */

builder.queryType({
  fields: (t) => ({
    person: t.field({
      type: Person,
      args: { id: t.arg.id({ required: true }), asOf: t.arg.string() },
      resolve: (_root, args, ctx) => readPerson(ctx, args.id, args.asOf ?? undefined),
    }),
    people: t.field({
      type: PersonPage,
      args: { first: t.arg.int(), after: t.arg.string(), asOf: t.arg.string() },
      resolve: async (_root, args, ctx) => {
        const { service, asking } = await caller(ctx);
        return unwrap(
          await run(service, asking.tenantId, async (tx) => {
            const page = await service.access.list(tx, {
              ...asking,
              limit: Math.min(Math.max(args.first ?? 50, 1), 200),
              after: args.after ?? null,
              ...(args.asOf ? { asOf: args.asOf } : {}),
            });
            if (!page.ok) return page;
            const version = await service.schemas.current(tx, asking.tenantId);
            return ok({
              nodes: page.value.items.map((view) => ({ view, version })),
              next: page.value.next,
            });
          }),
        );
      },
    }),
    peopleSettings: t.field({
      type: PeopleSettingsRef,
      resolve: (_root, _args, ctx) => inOrg(ctx, (org, tx, asking) => org.settings(tx, asking)),
    }),
    legalEntities: t.field({
      type: [LegalEntityRef],
      resolve: async (_root, _args, ctx) => [
        ...(await inOrg(ctx, (org, tx, asking) => org.legalEntities(tx, asking))),
      ],
    }),
    locations: t.field({
      type: [LocationRef],
      resolve: async (_root, _args, ctx) => [
        ...(await inOrg(ctx, (org, tx, asking) => org.locations(tx, asking))),
      ],
    }),
    peopleSchema: t.field({
      type: PeopleSchema,
      nullable: true,
      args: { version: t.arg.int() },
      resolve: async (_root, args, ctx) => {
        const { service, asking } = await caller(ctx);
        return unwrap(
          await run(service, asking.tenantId, async (tx) =>
            ok(
              args.version === null || args.version === undefined
                ? await service.schemas.current(tx, asking.tenantId)
                : await service.schemas.byNumber(tx, asking.tenantId, args.version),
            ),
          ),
        );
      },
    }),
  }),
});

/**
 * Every write takes an `idempotencyKey`, as every REST write takes an
 * `Idempotency-Key` (PEO-116), and is that REST write (`viaRest`).
 */
const idempotencyKey = { type: 'String', required: true } as const;

const personPath = (id: string | number) => `/v1/people/${encodeURIComponent(id)}`;

builder.mutationType({
  fields: (t) => ({
    updatePerson: t.field({
      type: Person,
      args: {
        id: t.arg.id({ required: true }),
        changes: t.arg({ type: [AttributeValueInput], required: true }),
        effectiveFrom: t.arg.string(),
        idempotencyKey: t.arg(idempotencyKey),
      },
      resolve: async (_root, args, ctx) => {
        const attributes: Record<string, unknown> = {};
        for (const input of args.changes) attributes[input.key] = unwrap(valueOf(input));
        const view = await viaRest<PersonView>(ctx, 'PATCH', personPath(args.id), {
          body: { attributes, ...sent({ effectiveFrom: args.effectiveFrom }) },
          key: args.idempotencyKey,
        });
        return asPerson(ctx, view);
      },
    }),
    updatePeopleSettings: t.field({
      type: PeopleSettingsRef,
      args: {
        defaultTimeZone: t.arg.string(),
        cohortMinimum: t.arg.int(),
        idempotencyKey: t.arg(idempotencyKey),
      },
      resolve: (_root, { idempotencyKey: key, ...patch }, ctx) =>
        viaRest<TenantSettings>(ctx, 'PATCH', '/v1/settings', { body: sent(patch), key }),
    }),
    createLegalEntity: t.field({
      type: LegalEntityRef,
      args: {
        name: t.arg.string({ required: true }),
        country: t.arg.string({ required: true }),
        timeZone: t.arg.string({ required: true }),
        idempotencyKey: t.arg(idempotencyKey),
      },
      resolve: (_root, { idempotencyKey: key, ...entity }, ctx) =>
        viaRest<LegalEntityView>(ctx, 'POST', '/v1/legal-entities', { body: entity, key }),
    }),
    updateLegalEntity: t.field({
      type: LegalEntityRef,
      args: {
        id: t.arg.id({ required: true }),
        name: t.arg.string(),
        timeZone: t.arg.string(),
        archived: t.arg.boolean(),
        idempotencyKey: t.arg(idempotencyKey),
      },
      resolve: (_root, { id, idempotencyKey: key, ...patch }, ctx) =>
        viaRest<LegalEntityView>(
          ctx,
          'PATCH',
          `/v1/legal-entities/${encodeURIComponent(id)}`,
          { body: sent(patch), key },
        ),
    }),
    createLocation: t.field({
      type: LocationRef,
      args: {
        legalEntityId: t.arg.id({ required: true }),
        name: t.arg.string({ required: true }),
        country: t.arg.string({ required: true }),
        timeZone: t.arg.string({ required: true }),
        effectiveFrom: t.arg.string(),
        idempotencyKey: t.arg(idempotencyKey),
      },
      resolve: (_root, { idempotencyKey: key, legalEntityId, ...place }, ctx) =>
        viaRest<LocationView>(ctx, 'POST', '/v1/locations', {
          body: { legalEntityId: legalEntityId, ...sent(place) },
          key,
        }),
    }),
    updateLocation: t.field({
      type: LocationRef,
      args: {
        id: t.arg.id({ required: true }),
        name: t.arg.string(),
        archived: t.arg.boolean(),
        idempotencyKey: t.arg(idempotencyKey),
      },
      resolve: (_root, { id, idempotencyKey: key, ...patch }, ctx) =>
        viaRest<LocationView>(ctx, 'PATCH', `/v1/locations/${encodeURIComponent(id)}`, {
          body: sent(patch),
          key,
        }),
    }),
    changeLocationZone: t.field({
      type: LocationRef,
      description: 'From a date, in the new zone. The same date again corrects the earlier change.',
      args: {
        id: t.arg.id({ required: true }),
        timeZone: t.arg.string({ required: true }),
        effectiveFrom: t.arg.string({ required: true }),
        idempotencyKey: t.arg(idempotencyKey),
      },
      resolve: (_root, args, ctx) =>
        viaRest<LocationView>(
          ctx,
          'POST',
          `/v1/locations/${encodeURIComponent(args.id)}/zones`,
          {
            body: { timeZone: args.timeZone, effectiveFrom: args.effectiveFrom },
            key: args.idempotencyKey,
          },
        ),
    }),
    correctAttribute: t.field({
      type: HistoryEntryRef,
      args: {
        personId: t.arg.id({ required: true }),
        supersedes: t.arg.id({ required: true }),
        value: t.arg({ type: AttributeValueInput, required: true }),
        reason: t.arg.string(),
        idempotencyKey: t.arg(idempotencyKey),
      },
      resolve: (_root, args, ctx) =>
        // The attribute is the one `supersedes` names; `key` is not consulted.
        viaRest<HistoryEntry>(ctx, 'POST', `${personPath(args.personId)}/corrections`, {
          body: {
            supersedes: args.supersedes,
            value: unwrap(valueOf(args.value)),
            reason: args.reason ?? null,
          },
          key: args.idempotencyKey,
        }),
    }),
  }),
});

/* -------------------------------------------------- employee numbering -- */

/**
 * PEO-101's scheme per legal entity, beside REST's `/numbering`. The sequence
 * is a Float because a scheme may be twelve digits wide and an Int is 32 bits;
 * `setNumbering` refuses anything but a whole number.
 */
const EmployeeNumberingRef = builder.objectRef<NumberingView>('EmployeeNumbering').implement({
  description: 'An entity’s employee numbering: `ES-` and 5 digits write `ES-00042`.',
  fields: (t) => ({
    legalEntityId: t.exposeID('legalEntityId'),
    prefix: t.exposeString('prefix'),
    digits: t.exposeInt('digits'),
    nextValue: t.exposeFloat('nextValue', {
      description: 'The number the next hire in this entity is given.',
    }),
  }),
});

builder.queryFields((t) => ({
  employeeNumbering: t.field({
    type: EmployeeNumberingRef,
    nullable: true,
    description: 'Null for an entity that does not number its people.',
    args: { legalEntityId: t.arg.id({ required: true }) },
    resolve: async (_root, args, ctx) =>
      (await inOrg(ctx, (org, tx, asking) => org.numberings(tx, asking))).find(
        (n) => n.legalEntityId === args.legalEntityId,
      ) ?? null,
  }),
}));

builder.mutationFields((t) => ({
  setEmployeeNumbering: t.field({
    type: EmployeeNumberingRef,
    description:
      'Set or change an entity’s scheme; people_admin only. Never moves the sequence back.',
    args: {
      legalEntityId: t.arg.id({ required: true }),
      prefix: t.arg.string({ required: true }),
      digits: t.arg.int({ required: true }),
      start: t.arg.float({ required: true }),
      idempotencyKey: t.arg(idempotencyKey),
    },
    resolve: (_root, { legalEntityId, idempotencyKey: key, ...scheme }, ctx) =>
      viaRest<NumberingView>(
        ctx,
        'PUT',
        `/v1/legal-entities/${encodeURIComponent(legalEntityId)}/numbering`,
        { body: scheme, key },
      ),
  }),
}));

/* ------------------------------------------------ the settings screen -- */

/**
 * Everything the organisation settings screen draws, in one read (PEO-119):
 * the entities, their locations and zones, each entity's numbering, the
 * tenant's settings, and whether this viewer may change any of it. Anybody in
 * the tenant reads it (§9.4); writing is `people_admin`'s, decided by the use
 * cases the mutations above reach.
 */
interface OrganisationShape {
  readonly canManage: boolean;
  readonly settings: TenantSettings;
  readonly legalEntities: readonly LegalEntityView[];
  readonly locations: readonly LocationView[];
  readonly numberings: readonly NumberingView[];
}

const OrgCountryRef = builder
  .objectRef<{ readonly code: string; readonly name: string }>('OrgCountry')
  .implement({
    fields: (t) => ({ code: t.exposeString('code'), name: t.exposeString('name') }),
  });

/** Every IANA zone this runtime knows, plus UTC, which `supportedValuesOf` leaves out. */
const TIME_ZONES = [...new Set(['Etc/UTC', ...Intl.supportedValuesOf('timeZone')])];

/**
 * A statutory retention floor, and whether counsel has reviewed it (PEO-126).
 * While `unreviewed`, nothing erases against it automatically.
 */
const RetentionFloorRef = builder.objectRef<FloorView>('RetentionFloor').implement({
  fields: (t) => ({
    floor: t.string({ resolve: (f) => f.floor }),
    months: t.exposeInt('months'),
    status: t.field({
      type: builder.enumType('RetentionFloorStatus', { values: ['unreviewed', 'reviewed'] as const }),
      resolve: (f) => f.review.status,
    }),
    reviewedBy: t.string({
      nullable: true,
      resolve: (f) => (f.review.status === 'reviewed' ? f.review.reviewer : null),
    }),
    reviewedOn: t.string({
      nullable: true,
      resolve: (f) => (f.review.status === 'reviewed' ? f.review.reviewedOn : null),
    }),
  }),
});

const OrganisationRef = builder.objectRef<OrganisationShape>('PeopleOrganisation').implement({
  fields: (t) => ({
    canManage: t.exposeBoolean('canManage'),
    settings: t.field({ type: PeopleSettingsRef, resolve: (o) => o.settings }),
    legalEntities: t.field({ type: [LegalEntityRef], resolve: (o) => [...o.legalEntities] }),
    locations: t.field({ type: [LocationRef], resolve: (o) => [...o.locations] }),
    numberings: t.field({ type: [EmployeeNumberingRef], resolve: (o) => [...o.numberings] }),
    countries: t.field({
      type: [OrgCountryRef],
      description: 'The countries an entity or a location may be in.',
      resolve: () => COUNTRIES.map((c) => ({ code: c.code, name: c.name })),
    }),
    timeZones: t.stringList({ resolve: () => TIME_ZONES }),
    retentionFloors: t.field({
      type: [RetentionFloorRef],
      description: 'The statutory retention floors and their legal review; law, the same for every tenant.',
      resolve: () => [...statutoryFloors()],
    }),
  }),
});

const PeopleHomeRef = builder
  .objectRef<{ hr: boolean; admin: boolean; finance: boolean }>('PeopleHome')
  .implement({
    description: 'Which of People’s areas this viewer’s roles open (PEO-119).',
    fields: (t) => ({
      hr: t.exposeBoolean('hr'),
      admin: t.exposeBoolean('admin'),
      finance: t.exposeBoolean('finance'),
    }),
  });

builder.queryFields((t) => ({
  peopleOrganisation: t.field({
    type: OrganisationRef,
    resolve: (_root, _args, ctx) =>
      inOrg(ctx, async (org, tx, asking) => {
        const settings = await org.settings(tx, asking);
        if (!settings.ok) return settings;
        const legalEntities = await org.legalEntities(tx, asking);
        if (!legalEntities.ok) return legalEntities;
        const locations = await org.locations(tx, asking);
        if (!locations.ok) return locations;
        const numberings = await org.numberings(tx, asking);
        if (!numberings.ok) return numberings;
        return ok({
          canManage: asking.viewer.roles.has('people_admin'),
          settings: settings.value,
          legalEntities: legalEntities.value,
          locations: locations.value,
          numberings: numberings.value,
        });
      }),
  }),
  peopleHome: t.field({
    type: PeopleHomeRef,
    resolve: async (_root, _args, ctx) => {
      const { roles } = (await caller(ctx)).asking.viewer;
      return { hr: roles.has('hr'), admin: roles.has('people_admin'), finance: roles.has('finance') };
    },
  }),
}));

/* ---------------------------------------------------------- lifecycle -- */

/**
 * Notice, termination, leave and discarding (PEO-108). The arguments are
 * parsed by the same Zod body REST parses, and the move is `PersonAccess`'s,
 * which is where HR-only is decided.
 */
const LeavingReasonRef = builder.enumType('LeavingReason', { values: LEAVING_REASONS });

/** One employment on a person (PEO-110). */
const EmploymentPeriodRef = builder
  .objectRef<EmploymentPeriodRow>('EmploymentPeriod')
  .implement({
    fields: (t) => ({
      period: t.exposeInt('period'),
      legalEntityId: t.id({ nullable: true, resolve: (p) => p.legalEntityId }),
      startedOn: t.exposeString('startedOn'),
      lastWorkingDay: t.string({ nullable: true, resolve: (p) => p.lastWorkingDay }),
      leavingReason: t.field({
        type: LeavingReasonRef,
        nullable: true,
        resolve: (p) => p.leavingReason,
      }),
      eligibleForRehire: t.boolean({ nullable: true, resolve: (p) => p.eligibleForRehire }),
      noticeFrom: t.string({ nullable: true, resolve: (p) => p.noticeFrom }),
      rehireOverrideReason: t.string({ nullable: true, resolve: (p) => p.rehireOverrideReason }),
    }),
  });

builder.queryFields((t) => ({
  employmentPeriods: t.field({
    type: [EmploymentPeriodRef],
    description: 'Every employment on a person, first first; HR only.',
    args: { personId: t.arg.id({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const { service, asking } = await caller(ctx);
      return [
        ...unwrap(
          await run(service, asking.tenantId, (tx) =>
            service.access.employmentPeriods(tx, { ...asking, personId: args.personId }),
          ),
        ),
      ];
    },
  }),
}));

async function move(
  ctx: RequestContext,
  name: string,
  personId: string | number,
  input: Record<string, unknown>,
  key: string,
): Promise<PersonShape> {
  const action = LIFECYCLE_ACTIONS.find((a) => a.name === name);
  if (!action) return fail(failure('UNAVAILABLE', `No lifecycle action ${name}`));
  const view = await viaRest<PersonView>(ctx, 'POST', `${personPath(personId)}/${action.path}`, {
    body: input,
    key,
  });
  return asPerson(ctx, view);
}

builder.mutationFields((t) => ({
  giveNotice: t.field({
    type: Person,
    description: 'Put an active or on-leave person on notice until a last working day; HR only.',
    args: {
      personId: t.arg.id({ required: true }),
      lastWorkingDay: t.arg.string({ required: true }),
      reason: t.arg({ type: LeavingReasonRef }),
      idempotencyKey: t.arg(idempotencyKey),
    },
    resolve: (_root, args, ctx) =>
      move(
        ctx,
        'giveNotice',
        args.personId,
        sent({ lastWorkingDay: args.lastWorkingDay, reason: args.reason }),
        args.idempotencyKey,
      ),
  }),
  terminatePerson: t.field({
    type: Person,
    description: 'End the employment once its last working day has come; HR only.',
    args: {
      personId: t.arg.id({ required: true }),
      lastWorkingDay: t.arg.string({ required: true }),
      reason: t.arg({ type: LeavingReasonRef, required: true }),
      note: t.arg.string(),
      eligibleForRehire: t.arg.boolean(),
      endAccessNow: t.arg.boolean({
        description: 'End their access now, for a dismissal for cause.',
      }),
      idempotencyKey: t.arg(idempotencyKey),
    },
    resolve: (_root, { personId, idempotencyKey: key, ...rest }, ctx) =>
      move(ctx, 'terminatePerson', personId, sent(rest), key),
  }),
  withdrawNotice: t.field({
    type: Person,
    description:
      'Withdraw a person’s notice before their last working day ends on their calendar; back to active or on leave; HR only.',
    args: { personId: t.arg.id({ required: true }), idempotencyKey: t.arg(idempotencyKey) },
    resolve: (_root, args, ctx) =>
      move(ctx, 'withdrawNotice', args.personId, {}, args.idempotencyKey),
  }),
  rehirePerson: t.field({
    type: Person,
    description:
      'Hire a leaver again: a new employment period on the same record, pre-hire until it starts; HR only.',
    args: {
      personId: t.arg.id({ required: true }),
      startDate: t.arg.string({ required: true }),
      legalEntityId: t.arg.id(),
      overrideReason: t.arg.string(),
      idempotencyKey: t.arg(idempotencyKey),
    },
    resolve: (_root, { personId, idempotencyKey: key, ...rest }, ctx) =>
      move(ctx, 'rehirePerson', personId, sent(rest), key),
  }),
  placePerson: t.field({
    type: Person,
    description:
      'Place a person at a legal entity, work location, org unit or cost centre from a date; a new entity is a transfer; HR only.',
    args: {
      personId: t.arg.id({ required: true }),
      legalEntityId: t.arg.id(),
      locationId: t.arg.id(),
      orgUnitId: t.arg.id(),
      costCentre: t.arg.string(),
      effectiveFrom: t.arg.string(),
      idempotencyKey: t.arg(idempotencyKey),
    },
    resolve: (_root, { personId, idempotencyKey: key, ...rest }, ctx) =>
      // An explicit null clears a field; an absent one leaves it.
      move(
        ctx,
        'placePerson',
        personId,
        Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        key,
      ),
  }),
  endPersonAccess: t.field({
    type: Person,
    description:
      'End a terminated person’s access now rather than at the end of their last working day; HR only.',
    args: { personId: t.arg.id({ required: true }), idempotencyKey: t.arg(idempotencyKey) },
    resolve: (_root, args, ctx) => move(ctx, 'endPersonAccess', args.personId, {}, args.idempotencyKey),
  }),
  startLeave: t.field({
    type: Person,
    description: 'An active person goes on leave from today, on their calendar; HR only.',
    args: { personId: t.arg.id({ required: true }), idempotencyKey: t.arg(idempotencyKey) },
    resolve: (_root, args, ctx) => move(ctx, 'startLeave', args.personId, {}, args.idempotencyKey),
  }),
  endLeave: t.field({
    type: Person,
    description: 'A person on leave is back from today, on their calendar; HR only.',
    args: { personId: t.arg.id({ required: true }), idempotencyKey: t.arg(idempotencyKey) },
    resolve: (_root, args, ctx) => move(ctx, 'endLeave', args.personId, {}, args.idempotencyKey),
  }),
  discardPerson: t.field({
    type: Person,
    description: 'Withdraw a provisional record that was never a person; HR only.',
    args: { personId: t.arg.id({ required: true }), idempotencyKey: t.arg(idempotencyKey) },
    resolve: (_root, args, ctx) => move(ctx, 'discardPerson', args.personId, {}, args.idempotencyKey),
  }),
}));

/* -------------------------------------------------------------- roles -- */

/**
 * Tenant roles (PEO-112). The arguments are parsed by the same Zod body REST
 * parses, and who may grant or revoke is `TenantRoles`' to decide.
 */
const TenantRoleRef = builder.enumType('TenantRole', {
  values: ['hr', 'finance', 'people_admin'] as const,
});

const RoleHolderRef = builder.objectRef<RoleHolder>('RoleHolder').implement({
  description: 'An account and the tenant roles it holds.',
  fields: (t) => ({
    accountId: t.exposeID('accountId'),
    roles: t.field({ type: [TenantRoleRef], resolve: (h) => [...h.roles] }),
  }),
});

async function inRoles<T>(
  ctx: RequestContext,
  fn: (roles: TenantRoles, tx: PostgresJsDatabase, asking: Asking) => Promise<Result<T>>,
): Promise<T> {
  const { service, asking } = await caller(ctx);
  const { roles } = service;
  if (!roles) return fail(failure('UNAVAILABLE', 'Roles are not configured'));
  return unwrap(await run(service, asking.tenantId, (tx) => fn(roles, tx, asking)));
}

async function changeRole(
  ctx: RequestContext,
  path: 'grants' | 'revocations',
  { idempotencyKey: key, ...change }: { idempotencyKey: string; accountId: string | number; role: string; reason: string },
): Promise<RoleHolder> {
  return viaRest<RoleHolder>(ctx, 'POST', `/v1/roles/${path}`, {
    body: { ...change, accountId: change.accountId },
    key,
  });
}

builder.queryFields((t) => ({
  peopleRoles: t.field({
    type: [RoleHolderRef],
    description: 'Who holds a tenant role; HR and people_admin only.',
    resolve: async (_root, _args, ctx) => [
      ...(await inRoles(ctx, (roles, tx, asking) => roles.list(tx, asking))).holders,
    ],
  }),
}));

builder.mutationFields((t) => ({
  grantRole: t.field({
    type: RoleHolderRef,
    description: 'people_admin only, never to oneself. A role already held changes nothing.',
    args: {
      accountId: t.arg.id({ required: true }),
      role: t.arg({ type: TenantRoleRef, required: true }),
      reason: t.arg.string({ required: true }),
      idempotencyKey: t.arg(idempotencyKey),
    },
    resolve: (_root, input, ctx) => changeRole(ctx, 'grants', input),
  }),
  revokeRole: t.field({
    type: RoleHolderRef,
    description: 'people_admin only; never the last people_admin.',
    args: {
      accountId: t.arg.id({ required: true }),
      role: t.arg({ type: TenantRoleRef, required: true }),
      reason: t.arg.string({ required: true }),
      idempotencyKey: t.arg(idempotencyKey),
    },
    resolve: (_root, input, ctx) => changeRole(ctx, 'revocations', input),
  }),
}));

defineScreens(builder, viaRest);

export const schema = builder.toSubGraphSchema({
  linkUrl: 'https://specs.apollo.dev/federation/v2.6',
});

/**
 * How People's Yoga is served, wherever it is (`main.ts`, the router test).
 * No file comes this way: an import's goes straight to storage (§14.2), so the
 * body is JSON and Yoga's own limit stands.
 */
export const yogaOptions = {
  schema,
  graphqlEndpoint: '/graphql',
  multipart: false,
  maskedErrors: {
    // Yoga loads graphql's CommonJS build and `toGraphQLError` its ESM one, so
    // Yoga's `instanceof` took every domain refusal for an unexpected error and
    // masked its code. One raised by `toGraphQLError` carries only a code, a
    // message and a field path, so it passes; anything else is masked as before.
    maskError: (error: unknown, message: string, isDev?: boolean) => {
      const original = (error as { originalError?: unknown } | null)?.originalError;
      return original instanceof Error && original.name === 'GraphQLError'
        ? (error as Error)
        : maskError(error, message, isDev);
    },
  },
} as const;
