import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createBuilder, toGraphQLError } from '@kithena/graphql-kit';
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
import { RoleChangeBody } from '../http/roles.js';
import type { RoleHolder, TenantRoles } from '../application/roles/roles.js';
import { LEAVING_REASONS } from '../domain/person/person.js';

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

/** Yoga's default context carries the Fetch request; that is all this needs. */
interface RequestContext {
  readonly request?: { readonly headers: Headers };
}

const builder = createBuilder<{ Context: RequestContext }>();

/* ------------------------------------------------------------- wiring -- */

let wiring: { service: PeopleService; callerFrom: CallerFrom } | null = null;

/** Called once at boot by the composition root. */
export function configureGraphQL(next: { service: PeopleService; callerFrom: CallerFrom }): void {
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

builder.mutationType({
  fields: (t) => ({
    updatePerson: t.field({
      type: Person,
      args: {
        id: t.arg.id({ required: true }),
        changes: t.arg({ type: [AttributeValueInput], required: true }),
        effectiveFrom: t.arg.string(),
      },
      resolve: async (_root, args, ctx) => {
        const { service, asking } = await caller(ctx);
        const changes: Record<string, unknown> = {};
        for (const input of args.changes) {
          changes[input.key] = unwrap(valueOf(input));
        }
        return unwrap(
          await run(service, asking.tenantId, async (tx) => {
            const view = await service.access.update(tx, {
              ...asking,
              personId: args.id,
              changes,
              ...(args.effectiveFrom ? { effectiveFrom: args.effectiveFrom } : {}),
            });
            if (!view.ok) return view;
            return ok({
              view: view.value,
              version: await service.schemas.current(tx, asking.tenantId),
            });
          }),
        );
      },
    }),
    updatePeopleSettings: t.field({
      type: PeopleSettingsRef,
      args: { defaultTimeZone: t.arg.string(), cohortMinimum: t.arg.int() },
      resolve: (_root, args, ctx) =>
        inOrg(ctx, (org, tx, asking) => org.updateSettings(tx, { ...asking, ...sent(args) })),
    }),
    createLegalEntity: t.field({
      type: LegalEntityRef,
      args: {
        name: t.arg.string({ required: true }),
        country: t.arg.string({ required: true }),
        timeZone: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        inOrg(ctx, (org, tx, asking) => org.createLegalEntity(tx, { ...asking, ...args })),
    }),
    updateLegalEntity: t.field({
      type: LegalEntityRef,
      args: {
        id: t.arg.id({ required: true }),
        name: t.arg.string(),
        timeZone: t.arg.string(),
        archived: t.arg.boolean(),
      },
      resolve: (_root, args, ctx) =>
        inOrg(ctx, (org, tx, asking) =>
          org.updateLegalEntity(tx, { ...asking, ...sent(args), id: args.id }),
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
      },
      resolve: (_root, args, ctx) =>
        inOrg(ctx, (org, tx, asking) =>
          org.createLocation(tx, {
            ...asking,
            ...sent(args),
            legalEntityId: args.legalEntityId,
            name: args.name,
            country: args.country,
            timeZone: args.timeZone,
          }),
        ),
    }),
    updateLocation: t.field({
      type: LocationRef,
      args: { id: t.arg.id({ required: true }), name: t.arg.string(), archived: t.arg.boolean() },
      resolve: (_root, args, ctx) =>
        inOrg(ctx, (org, tx, asking) =>
          org.updateLocation(tx, { ...asking, ...sent(args), id: args.id }),
        ),
    }),
    changeLocationZone: t.field({
      type: LocationRef,
      description: 'From a date, in the new zone. The same date again corrects the earlier change.',
      args: {
        id: t.arg.id({ required: true }),
        timeZone: t.arg.string({ required: true }),
        effectiveFrom: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        inOrg(ctx, (org, tx, asking) =>
          org.changeLocationZone(tx, {
            ...asking,
            id: args.id,
            timeZone: args.timeZone,
            effectiveFrom: args.effectiveFrom,
          }),
        ),
    }),
    correctAttribute: t.field({
      type: HistoryEntryRef,
      args: {
        personId: t.arg.id({ required: true }),
        supersedes: t.arg.id({ required: true }),
        value: t.arg({ type: AttributeValueInput, required: true }),
        reason: t.arg.string(),
      },
      resolve: async (_root, args, ctx) => {
        const { service, asking } = await caller(ctx);
        // The attribute is the one `supersedes` names; `key` is not consulted.
        const value = unwrap(valueOf(args.value));
        return unwrap(
          await run(service, asking.tenantId, (tx) =>
            service.access.correct(tx, {
              ...asking,
              personId: args.personId,
              supersedes: args.supersedes,
              value,
              reason: args.reason ?? null,
            }),
          ),
        );
      },
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
    },
    resolve: (_root, args, ctx) =>
      inOrg(ctx, (org, tx, asking) => org.setNumbering(tx, { ...asking, ...args })),
  }),
}));

/* ---------------------------------------------------------- lifecycle -- */

/**
 * Notice, termination, leave and discarding (PEO-108). The arguments are
 * parsed by the same Zod body REST parses, and the move is `PersonAccess`'s,
 * which is where HR-only is decided.
 */
const LeavingReasonRef = builder.enumType('LeavingReason', { values: LEAVING_REASONS });

async function move(
  ctx: RequestContext,
  name: string,
  personId: string,
  input: Record<string, unknown>,
): Promise<PersonShape> {
  const action = LIFECYCLE_ACTIONS.find((a) => a.name === name);
  if (!action) return fail(failure('UNAVAILABLE', `No lifecycle action ${name}`));
  const parsed = action.body.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      failure(
        'BAD_INPUT',
        issue?.message ?? 'invalid input',
        issue?.path.map((p) => String(p)),
      ),
    );
  }
  const { service, asking } = await caller(ctx);
  return unwrap(
    await run(service, asking.tenantId, async (tx) => {
      const view = await action.run(service.access, tx, { ...asking, personId }, parsed.data);
      if (!view.ok) return view;
      return ok({ view: view.value, version: await service.schemas.current(tx, asking.tenantId) });
    }),
  );
}

builder.mutationFields((t) => ({
  giveNotice: t.field({
    type: Person,
    description: 'Put an active or on-leave person on notice until a last working day; HR only.',
    args: {
      personId: t.arg.id({ required: true }),
      lastWorkingDay: t.arg.string({ required: true }),
      reason: t.arg({ type: LeavingReasonRef }),
    },
    resolve: (_root, args, ctx) =>
      move(
        ctx,
        'giveNotice',
        args.personId,
        sent({ lastWorkingDay: args.lastWorkingDay, reason: args.reason }),
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
    },
    resolve: (_root, { personId, ...rest }, ctx) =>
      move(ctx, 'terminatePerson', personId, sent(rest)),
  }),
  endPersonAccess: t.field({
    type: Person,
    description:
      'End a terminated person’s access now rather than at the end of their last working day; HR only.',
    args: { personId: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) => move(ctx, 'endPersonAccess', args.personId, {}),
  }),
  startLeave: t.field({
    type: Person,
    description: 'An active person goes on leave from today, on their calendar; HR only.',
    args: { personId: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) => move(ctx, 'startLeave', args.personId, {}),
  }),
  endLeave: t.field({
    type: Person,
    description: 'A person on leave is back from today, on their calendar; HR only.',
    args: { personId: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) => move(ctx, 'endLeave', args.personId, {}),
  }),
  discardPerson: t.field({
    type: Person,
    description: 'Withdraw a provisional record that was never a person; HR only.',
    args: { personId: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) => move(ctx, 'discardPerson', args.personId, {}),
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
  kind: 'grant' | 'revoke',
  input: Record<string, unknown>,
): Promise<RoleHolder> {
  const parsed = RoleChangeBody.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      failure(
        'BAD_INPUT',
        issue?.message ?? 'invalid input',
        issue?.path.map((p) => String(p)),
      ),
    );
  }
  return inRoles(ctx, (roles, tx, asking) => roles[kind](tx, { ...asking, ...parsed.data }));
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
    },
    resolve: (_root, input, ctx) => changeRole(ctx, 'grant', input),
  }),
  revokeRole: t.field({
    type: RoleHolderRef,
    description: 'people_admin only; never the last people_admin.',
    args: {
      accountId: t.arg.id({ required: true }),
      role: t.arg({ type: TenantRoleRef, required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: (_root, input, ctx) => changeRole(ctx, 'revoke', input),
  }),
}));


export const schema = builder.toSubGraphSchema({
  linkUrl: 'https://specs.apollo.dev/federation/v2.6',
});
