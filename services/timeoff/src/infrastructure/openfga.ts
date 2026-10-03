import { OpenFgaClient, type TupleKey } from '@openfga/sdk';
import type { CalendarDate, PersonId, TeamKey, TenantId } from '@kithena/contracts';

import type { Authorizer, UnitOfWork } from '../application/ports.js';
import type { DateRange } from '../domain/days.js';

/**
 * Time Off's authorization graph, in OpenFGA (PRD §9, §10.1, TOF-048). The
 * application asks `Authorizer.check` (`application/ports.ts`); this answers
 * it from Time Off's own store, beside People's rather than in it, because
 * a module is sold alone.
 *
 *     type account
 *     type person
 *       relations
 *         define covered_by: [person with covering]
 *     type team
 *       relations
 *         define member: [person]
 *     type tenant
 *       relations
 *         define hr_admin: [account]
 *     type member
 *       relations
 *         define subject: [person]
 *         define team: [team]
 *         define approver: [person]
 *         define delegate: covered_by from approver
 *         define teammate: member from team but not subject
 *     condition covering(today: string, ranges: list<map<string>>) {
 *       ranges.exists(r, r["from"] <= today && today <= r["to"])
 *     }
 *
 * A member's approver is their manager in Time Off's projection; whoever
 * covers for that manager is a delegate on the days the tuple's ranges hold
 * — a set range, or the manager's approved time off — and on no others,
 * which the check decides from `today` (ISO dates order as text). A
 * teammate shares a team and is not the member: they may see that someone
 * is off, and the application shows them "Off" unless the leave type says
 * otherwise. HR is an account role on the tenant.
 *
 * `subject` is the person the member is (OpenFGA reserves `self`).
 *
 * Person, member and team ids are prefixed with the tenant (`<tenant>_<id>`):
 * a team key is the tenant's own word, and two tenants may both have a
 * "platform".
 */
export const TIMEOFF_AUTHORIZATION_MODEL = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'account' },
    {
      type: 'person',
      relations: { covered_by: { this: {} } },
      metadata: {
        relations: {
          covered_by: { directly_related_user_types: [{ type: 'person', condition: 'covering' }] },
        },
      },
    },
    {
      type: 'team',
      relations: { member: { this: {} } },
      metadata: { relations: { member: { directly_related_user_types: [{ type: 'person' }] } } },
    },
    {
      type: 'tenant',
      relations: { hr_admin: { this: {} } },
      metadata: { relations: { hr_admin: { directly_related_user_types: [{ type: 'account' }] } } },
    },
    {
      type: 'member',
      relations: {
        subject: { this: {} },
        team: { this: {} },
        approver: { this: {} },
        delegate: {
          tupleToUserset: {
            tupleset: { relation: 'approver' },
            computedUserset: { relation: 'covered_by' },
          },
        },
        teammate: {
          difference: {
            base: {
              tupleToUserset: {
                tupleset: { relation: 'team' },
                computedUserset: { relation: 'member' },
              },
            },
            subtract: { computedUserset: { relation: 'subject' } },
          },
        },
      },
      metadata: {
        relations: {
          subject: { directly_related_user_types: [{ type: 'person' }] },
          team: { directly_related_user_types: [{ type: 'team' }] },
          approver: { directly_related_user_types: [{ type: 'person' }] },
        },
      },
    },
  ],
  conditions: {
    covering: {
      name: 'covering',
      expression: 'ranges.exists(r, r["from"] <= today && today <= r["to"])',
      parameters: {
        today: { type_name: 'TYPE_NAME_STRING' },
        ranges: {
          type_name: 'TYPE_NAME_LIST',
          generic_types: [
            { type_name: 'TYPE_NAME_MAP', generic_types: [{ type_name: 'TYPE_NAME_STRING' }] },
          ],
        },
      },
    },
  },
} as const;

const scoped = (tenantId: TenantId, ref: string): string => {
  const [type, id] = ref.split(':', 2) as [string, string];
  return type === 'account' || type === 'tenant' ? ref : `${type}:${tenantId}_${id}`;
};

export interface TimeOffFga {
  readonly authorizer: Authorizer;
  /** A member's own tuples — who they are, their team, their approver — in line with the projection. */
  syncMember(
    tenantId: TenantId,
    member: {
      readonly personId: PersonId;
      readonly teamKey: TeamKey | null;
      readonly managerPersonId: PersonId | null;
      readonly status: 'active' | 'on_leave' | 'left';
    },
  ): Promise<'applied' | 'unchanged'>;
  /** Who covers for an approver, and on which days; `null` for nobody. */
  syncCover(
    tenantId: TenantId,
    approverId: PersonId,
    cover: { readonly delegateId: PersonId; readonly ranges: readonly DateRange[] } | null,
  ): Promise<'applied' | 'unchanged'>;
  /** HR, as an account role on the tenant. */
  setHrAdmin(tenantId: TenantId, accountId: string, holds: boolean): Promise<void>;
}

const same = (a: TupleKey, b: TupleKey) =>
  a.user === b.user &&
  a.relation === b.relation &&
  a.object === b.object &&
  JSON.stringify(a.condition ?? null) === JSON.stringify(b.condition ?? null);

/** Make the tuples `held` matches into `wanted`, in one write. */
async function replace(
  fga: OpenFgaClient,
  held: readonly TupleKey[],
  wanted: readonly TupleKey[],
): Promise<'applied' | 'unchanged'> {
  const writes = wanted.filter((w) => !held.some((h) => same(h, w)));
  const deletes = held
    .filter((h) => !wanted.some((w) => same(h, w)))
    .map(({ user, relation, object }) => ({ user, relation, object }));
  if (writes.length === 0 && deletes.length === 0) return 'unchanged';
  await fga.write({
    ...(writes.length > 0 ? { writes } : {}),
    ...(deletes.length > 0 ? { deletes } : {}),
  });
  return 'applied';
}

async function readAll(
  fga: OpenFgaClient,
  filter: { user?: string; relation?: string; object: string },
) {
  const held: TupleKey[] = [];
  let token: string | undefined;
  do {
    const page = await fga.read(filter, token === undefined ? {} : { continuationToken: token });
    held.push(...page.tuples.map((t) => t.key));
    token = page.continuation_token === '' ? undefined : page.continuation_token;
  } while (token !== undefined);
  return held;
}

/**
 * The client, with Time Off's store and model in place, prepared lazily so a
 * process whose OpenFGA is briefly down still boots. `today` is the date the
 * `covering` condition is checked against.
 */
export function openFga(
  apiUrl: string,
  options: { readonly storeId?: string; readonly today: () => CalendarDate },
): TimeOffFga {
  let ready: Promise<OpenFgaClient> | undefined;
  const client = (): Promise<OpenFgaClient> => {
    ready ??= prepare(apiUrl, options.storeId).catch((cause: unknown) => {
      ready = undefined;
      throw cause;
    });
    return ready;
  };

  return {
    authorizer: {
      async check(tenantId, tuple) {
        const fga = await client();
        const { allowed } = await fga.check({
          user: scoped(tenantId, tuple.user),
          relation: tuple.relation,
          object: scoped(tenantId, tuple.object),
          context: { today: options.today() },
        });
        return allowed === true;
      },
    },

    async syncMember(tenantId, member) {
      const fga = await client();
      const person = scoped(tenantId, `person:${member.personId}`);
      const object = scoped(tenantId, `member:${member.personId}`);
      const here = member.status !== 'left';
      const team = member.teamKey === null ? null : scoped(tenantId, `team:${member.teamKey}`);
      const wanted: TupleKey[] = here
        ? [
            { user: person, relation: 'subject', object },
            ...(team === null ? [] : [{ user: team, relation: 'team', object }]),
            ...(member.managerPersonId === null
              ? []
              : [
                  {
                    user: scoped(tenantId, `person:${member.managerPersonId}`),
                    relation: 'approver',
                    object,
                  },
                ]),
          ]
        : [];
      const own = await replace(fga, await readAll(fga, { object }), wanted);
      const memberships = await readAll(fga, { user: person, relation: 'member', object: 'team:' });
      const teams = await replace(
        fga,
        memberships,
        here && team !== null ? [{ user: person, relation: 'member', object: team }] : [],
      );
      return own === 'applied' || teams === 'applied' ? 'applied' : 'unchanged';
    },

    async syncCover(tenantId, approverId, cover) {
      const fga = await client();
      const object = scoped(tenantId, `person:${approverId}`);
      const wanted: TupleKey[] =
        cover === null || cover.ranges.length === 0
          ? []
          : [
              {
                user: scoped(tenantId, `person:${cover.delegateId}`),
                relation: 'covered_by',
                object,
                condition: {
                  name: 'covering',
                  context: { ranges: cover.ranges.map((r) => ({ from: r.from, to: r.to })) },
                },
              },
            ];
      return replace(fga, await readAll(fga, { relation: 'covered_by', object }), wanted);
    },

    async setHrAdmin(tenantId, accountId, holds) {
      const fga = await client();
      const tuple = {
        user: `account:${accountId}`,
        relation: 'hr_admin',
        object: `tenant:${tenantId}`,
      };
      await replace(fga, await readAll(fga, tuple), holds ? [tuple] : []);
    },
  };
}

/**
 * Time Off's graph when `OPENFGA_URL` is set, in its own store: named by
 * `TIMEOFF_OPENFGA_STORE_ID`, or found by name ("timeoff") and created when
 * that is unset. `OPENFGA_STORE_ID` is People's store and never this one.
 * Null without `OPENFGA_URL`.
 */
export function timeoffFgaFrom(
  env: NodeJS.ProcessEnv,
  today: () => CalendarDate,
): TimeOffFga | null {
  const apiUrl = env['OPENFGA_URL'];
  if (apiUrl === undefined || apiUrl === '') return null;
  const storeId = env['TIMEOFF_OPENFGA_STORE_ID'];
  return openFga(apiUrl, { today, ...(storeId ? { storeId } : {}) });
}

/**
 * Without OpenFGA nobody holds a relation, so nobody approves, covers or is
 * HR: the member's own screens answer, as they ask no question, and every
 * other is refused. Closed, the way audit refuses without it; there is no
 * second copy of the graph to fall back on.
 */
export const nobodyRelates: Authorizer = {
  check: () => Promise.resolve(false),
};

/** What the member consumers ask of the graph beside the projection. */
export interface MemberTuples {
  /** Read the member's row and bring its tuples in line with it. */
  resync(tenantId: TenantId, personId: PersonId): Promise<void>;
  setHrAdmin(tenantId: TenantId, accountId: string, holds: boolean): Promise<void>;
}

/**
 * The member tuples follow the projection (TOF-050a): every member a unit of
 * work saved is read back once it commits, and its `subject`, `team` and
 * `approver` tuples — and so who is their teammate — are brought in line
 * with the row. Read back rather than taken from the save, because the row
 * is the truth: the upsert refuses an older event, and a redelivery or a
 * replay converges on the same tuples. People's rule for its own
 * (`services/people/src/infrastructure/openfga.ts`, `sync`).
 *
 * A delegate's `covered_by` follows the same way (TOF-050b): a delegation
 * set or removed, or a request of the approver's saved — their own time off
 * approved, cancelled or withdrawn, which an automatic delegation covers —
 * re-reads the delegation and the approver's approved time off after the
 * commit and writes the ranges `covering` checks.
 *
 * Every path that changes a member, a delegation or a request goes through
 * a unit of work — People's events, the import, a location's zone, a
 * decision, the escalation worker — so wrapping it is the one place none
 * can miss. A tuple write that fails after the commit throws; the
 * consumer's redelivery then finds the event applied and calls `resync`.
 */
export function syncingTuples(
  uow: UnitOfWork,
  fga: Pick<TimeOffFga, 'syncMember' | 'syncCover' | 'setHrAdmin'>,
): { readonly uow: UnitOfWork; readonly tuples: MemberTuples } {
  const resync = async (tenantId: TenantId, personId: PersonId): Promise<void> => {
    const row = await uow.run(tenantId, (tx) => tx.members.get(personId));
    if (row !== null) await fga.syncMember(tenantId, row);
  };
  /**
   * An approver's `covered_by`, from their delegation and, when it is
   * automatic, their approved time off. `delegationChanged` false means only
   * a request moved: with no delegation there is then no tuple to clear.
   */
  const resyncCover = async (
    tenantId: TenantId,
    approverId: PersonId,
    delegationChanged: boolean,
  ): Promise<void> => {
    const cover = await uow.run(tenantId, async (tx) => {
      const d = await tx.approvals.delegation(approverId);
      if (d === null) return null;
      // ponytail: every approved request the approver ever had; keep only
      // those not yet over if a tuple's condition context grows too large.
      const away = d.automatic
        ? await tx.requests.list({ personIds: [approverId], statuses: ['approved'] })
        : [];
      return {
        delegateId: d.delegateId,
        ranges: [...(d.range === null ? [] : [d.range]), ...away.flatMap((r) => r.request.spans)],
      };
    });
    if (cover === null && !delegationChanged) return;
    await fga.syncCover(tenantId, approverId, cover);
  };
  return {
    uow: {
      async run(tenantId, fn) {
        const saved = new Set<PersonId>();
        const delegations = new Set<PersonId>();
        const requesters = new Set<PersonId>();
        const result = await uow.run(tenantId, (tx) =>
          fn({
            ...tx,
            members: {
              ...tx.members,
              save: async (member) => {
                saved.add(member.personId);
                await tx.members.save(member);
              },
            },
            approvals: {
              ...tx.approvals,
              saveDelegation: async (delegation) => {
                delegations.add(delegation.approverId);
                await tx.approvals.saveDelegation(delegation);
              },
              removeDelegation: async (approverId) => {
                delegations.add(approverId);
                await tx.approvals.removeDelegation(approverId);
              },
            },
            requests: {
              ...tx.requests,
              save: async (record) => {
                requesters.add(record.request.personId);
                await tx.requests.save(record);
              },
            },
          }),
        );
        for (const personId of saved) {
          // oxlint-disable-next-line no-await-in-loop -- one member's tuples at a time, in order
          await resync(tenantId, personId);
        }
        for (const approverId of new Set([...delegations, ...requesters])) {
          // oxlint-disable-next-line no-await-in-loop -- one approver's cover at a time, in order
          await resyncCover(tenantId, approverId, delegations.has(approverId));
        }
        return result;
      },
    },
    tuples: {
      resync,
      setHrAdmin: (tenantId, accountId, holds) => fga.setHrAdmin(tenantId, accountId, holds),
    },
  };
}

const STORE_NAME = 'timeoff';

async function prepare(apiUrl: string, storeId?: string): Promise<OpenFgaClient> {
  const bare = new OpenFgaClient({ apiUrl });
  let id = storeId;
  if (id === undefined || id === '') {
    let token: string | undefined;
    do {
      const page = await bare.listStores(token === undefined ? {} : { continuationToken: token });
      id = page.stores.find((s) => s.name === STORE_NAME)?.id;
      token = page.continuation_token === '' ? undefined : page.continuation_token;
    } while (id === undefined && token !== undefined);
    id ??= (await bare.createStore({ name: STORE_NAME })).id;
  }
  const inStore = new OpenFgaClient({ apiUrl, storeId: id });
  const latest = await inStore.readLatestAuthorizationModel().catch(() => undefined);
  const current = latest?.authorization_model;
  let modelId = current?.id;
  if (
    current === undefined ||
    JSON.stringify(current.type_definitions) !==
      JSON.stringify(TIMEOFF_AUTHORIZATION_MODEL.type_definitions)
  ) {
    modelId = (
      await inStore.writeAuthorizationModel(structuredClone(TIMEOFF_AUTHORIZATION_MODEL) as never)
    ).authorization_model_id;
  }
  return new OpenFgaClient({
    apiUrl,
    storeId: id,
    ...(modelId === undefined ? {} : { authorizationModelId: modelId }),
  });
}
