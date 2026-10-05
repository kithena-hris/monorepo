import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import {
  CHECKS,
  MANAGER_PAY,
  MARK_DAYS,
  CONTACT_DAYS,
  isCheckCode,
  payChangePercent,
  payReach,
  payReadable,
  unusual,
  type CheckCode,
  type Flagging,
  type Mark,
  type Money,
} from '../../domain/approval/unusual.js';
import { answerQuestion, askRequester, type Question } from '../../domain/approval/question.js';
import { stateAt } from '../../domain/approval/approval.js';
import { personZone, placementOf } from '../../domain/org/calendar.js';
import { mayEditPayBands } from '../../domain/pay/pay.js';
import type { Calendars } from '../org/org.js';
import type { Approval } from '../../domain/approval/approval.js';
import type { Asking, PersonReader, RelationsResolver, SchemaVersions } from './ports.js';

/**
 * The checks that flag a change waiting for approval, as the company set them
 * up, and what they read to decide (design AI7, AI8; the rules are
 * `domain/approval/unusual.ts`).
 *
 * Read here, never by a model: the team's raises this year, the band of the
 * person's grade, when their address or email last changed, whether the
 * decider and the requester share a manager, the company's switches, and the
 * "Not unusual" marks of the last 90 days. Pay, the team's raises and the band
 * are read only when the decider may read the field changed, so a flag never
 * says more about pay than the decider could see for themselves.
 *
 * And what the decider does with a flag: mark it not unusual, ask the
 * requester, or approve it with a note (`pending-changes.ts`).
 */

type Tx = PostgresJsDatabase;

const DAY_MS = 86_400_000;
/** The field a team is read from, and a band's grade: the PRD's keys (Appendix A). */
export const TEAM_KEY = 'department';
export const GRADE_KEY = 'grade';

export interface FlagStats {
  /** Changes asked for in the window that a check flagged (decided, or marked). */
  readonly flagged: number;
  /** Of those, how many were rejected. */
  readonly rejected: number;
  /** How many were marked not unusual. */
  readonly marked: number;
}

export interface ApprovalFlagStore {
  /** The company's switches: a row is a check set on or off; no row is its default. */
  switches(tx: Tx, tenantId: string): Promise<ReadonlyMap<string, boolean>>;
  setSwitch(
    tx: Tx,
    tenantId: string,
    to: {
      readonly code: CheckCode | typeof MANAGER_PAY.code;
      readonly on: boolean;
      readonly by: string;
      readonly at: string;
    },
  ): Promise<void>;
  /** The company's marks since an instant. */
  marks(tx: Tx, tenantId: string, since: string): Promise<readonly Mark[]>;
  /** Record marks on one change; a reason already marked stays as it was. */
  mark(
    tx: Tx,
    tenantId: string,
    changeId: string,
    marks: readonly Mark[],
    by: string,
  ): Promise<void>;
  /** The checks that flagged a change when it was decided. */
  recordDecided(tx: Tx, tenantId: string, changeId: string, codes: readonly string[]): Promise<void>;
  /** Changes asked for since an instant: flagged, rejected of those, marked. */
  stats(tx: Tx, tenantId: string, since: string): Promise<FlagStats>;
  questions(tx: Tx, tenantId: string, changeIds: readonly string[]): Promise<readonly Question[]>;
  question(tx: Tx, tenantId: string, id: string): Promise<Question | null>;
  ask(tx: Tx, tenantId: string, question: Question): Promise<void>;
  /** Write the answer only if there is none yet; false when somebody answered first. */
  answer(tx: Tx, tenantId: string, question: Question): Promise<boolean>;
  /**
   * Other people's raises in a team this year: each recorded change of the
   * pay field, effective between `from` and `until`, with the value before it.
   */
  teamRaises(
    tx: Tx,
    tenantId: string,
    team: {
      readonly teamKey: string;
      readonly team: string;
      readonly payKey: string;
      readonly except: string;
      readonly from: string;
      readonly until: string;
    },
  ): Promise<readonly { readonly before: Money; readonly after: Money }[]>;
  /** The band of a grade and currency in force on a day, in minor units. */
  band(
    tx: Tx,
    tenantId: string,
    of: { readonly grade: string; readonly currency: string; readonly day: string },
  ): Promise<{ readonly minimumMinor: string; readonly maximumMinor: string } | null>;
  /** When these fields of one person were recorded since an instant. */
  changedAt(
    tx: Tx,
    tenantId: string,
    of: { readonly personId: string; readonly keys: readonly string[]; readonly since: string },
  ): Promise<readonly { readonly key: string; readonly at: string }[]>;
}

export interface FlagDeps {
  readonly store: ApprovalFlagStore;
  readonly calendars: Calendars;
  /**
   * The value in force of a sealed field, opened in memory: the same audited
   * `SecretStore.reveal` People opens a sealed value with anywhere else.
   * Absent, a sealed pay field gets no raise or band check.
   */
  readonly sealed?: SealedPay;
}

/**
 * Opening sealed pay for one flag computation (design AI7; PEO-145).
 *
 * Only for a decider who may read the field on that person (the rule a
 * profile shows it to them by), only for a money field, and only inside the
 * request: the plaintext is parsed into an amount, compared, and dropped. It
 * is never returned, stored, cached or logged; what leaves is percentages
 * and the band's limits (`unusual.ts`, `sealed`).
 */
export interface SealedPay {
  current(
    tx: Tx,
    where: { readonly tenantId: string; readonly personId: string; readonly attributeKey: string },
  ): Promise<string | null>;
}

/**
 * A change held for approval, as far as the checks read one: the shape of
 * `PendingChange`, said here so this file and `pending-changes.ts`, which
 * calls it at decision time, do not import each other.
 */
export interface PendingChange {
  readonly tenantId: string;
  readonly personId: string;
  readonly attributeKey: string;
  readonly approval: Approval;
  readonly effectiveFrom: string;
  readonly sealed: boolean;
  readonly value: unknown;
}

/** What the checks and their use cases need of `PendingChangeDeps`, which satisfies it. */
export interface PendingChangeDeps {
  readonly clock: { instant(): string };
  readonly newId: () => string;
  readonly flags?: FlagDeps;
  readonly reader: PersonReader;
  readonly schemas: SchemaVersions;
  readonly relations: RelationsResolver;
  readonly store: {
    find(tx: Tx, tenantId: string, id: string): Promise<PendingChange | null>;
    forPerson(tx: Tx, tenantId: string, personId: string): Promise<readonly PendingChange[]>;
    /** A sealed pending value's plaintext, while it waits. */
    unseal(tx: Tx, tenantId: string, id: string): Promise<string | null>;
  };
}

/** A company's switches: the checks on, and whether pay read through a reporting line counts. */
export interface Switches {
  readonly enabled: ReadonlySet<CheckCode>;
  /** `MANAGER_PAY`. */
  readonly managerPay: boolean;
}

export async function switchesOf(
  tx: Tx,
  flags: FlagDeps | undefined,
  tenantId: string,
): Promise<Switches> {
  const set = flags ? await flags.store.switches(tx, tenantId) : new Map<string, boolean>();
  return {
    enabled: new Set(CHECKS.filter((c) => set.get(c.code) ?? c.on).map((c) => c.code)),
    managerPay: set.get(MANAGER_PAY.code) ?? MANAGER_PAY.on,
  };
}

const moneyOf = (value: unknown): Money | null =>
  value !== null &&
  typeof value === 'object' &&
  'amountMinor' in value &&
  'currency' in value &&
  !('last4' in value)
    ? { amountMinor: String(value.amountMinor), currency: String(value.currency) }
    : null;

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function optionLabel(definition: AttributeDefinition | undefined, value: string): string {
  return definition?.typeConfig.kind === 'select'
    ? (definition.typeConfig.options.find((o) => o.value === value)?.label.default ?? value)
    : value;
}

const pairOf = (before: Money | null, after: Money | null) =>
  before !== null && after !== null ? { before, after } : null;

/** A sealed amount's plaintext as money, or null: never kept as text past this call. */
function parsedMoney(plaintext: string | null): Money | null {
  if (plaintext === null) return null;
  try {
    return moneyOf(JSON.parse(plaintext) as unknown);
  } catch {
    return null;
  }
}

/**
 * Both amounts of a change to sealed pay, opened in memory for this
 * computation (PEO-145): what is in force through `SealedPay`, what is asked
 * for from the change's own seal. Null without the port, or when either is
 * missing. The caller has already established the decider may read the field.
 */
async function openedPay(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'flags' | 'store'>,
  change: PendingChange,
): Promise<{ before: Money; after: Money; sealed: true } | null> {
  const sealed = deps.flags?.sealed;
  if (sealed === undefined) return null;
  const before = parsedMoney(
    await sealed.current(tx, {
      tenantId: change.tenantId,
      personId: change.personId,
      attributeKey: change.attributeKey,
    }),
  );
  const after = change.sealed
    ? parsedMoney(await deps.store.unseal(tx, change.tenantId, change.approval.id))
    : moneyOf(change.value);
  return before === null || after === null ? null : { before, after, sealed: true };
}

/** What surrounds one look at the inbox: read once, used for every change in it. */
export interface Looking extends Switches {
  readonly marks: readonly Mark[];
  readonly definitions: readonly AttributeDefinition[];
  /** The decider's manager, as their own record holds it. */
  readonly managerOfDecider: string | null;
  /** The decider may read pay bands (HR or finance): a band flag names its limits. */
  readonly bandReadable: boolean;
}

export async function looking(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'clock' | 'flags' | 'reader' | 'schemas'>,
  asking: Asking,
): Promise<Looking> {
  const now = deps.clock.instant();
  const version = await deps.schemas.current(tx, asking.tenantId);
  const me = await deps.reader.personOf(tx, asking.tenantId, asking.viewer.accountId);
  const mine = me === null ? null : await deps.reader.record(tx, asking.tenantId, me);
  return {
    ...(await switchesOf(tx, deps.flags, asking.tenantId)),
    marks:
      deps.flags === undefined
        ? []
        : await deps.flags.store.marks(
            tx,
            asking.tenantId,
            new Date(Date.parse(now) - MARK_DAYS * DAY_MS).toISOString(),
          ),
    definitions: version?.document.attributes ?? [],
    managerOfDecider: text(mine?.values['manager_id']),
    bandReadable: mayEditPayBands(asking.viewer.roles),
  };
}

/**
 * What the checks find about one change, for the decider looking at it now.
 * `readable`: the decider may read the field changed, so pay may be compared.
 */
export async function flagChange(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'clock' | 'flags' | 'reader' | 'store'>,
  look: Looking,
  input: {
    readonly change: PendingChange;
    readonly readable: boolean;
    /** The requester, as the decider may name them. */
    readonly requesterName: string;
  },
): Promise<Flagging> {
  const { change } = input;
  const tenantId = change.tenantId;
  const at = deps.clock.instant();
  const byKey = new Map(look.definitions.map((d) => [d.key as string, d]));
  const definition = byKey.get(change.attributeKey);
  const dataType = definition?.dataType ?? 'text';
  const subject = await deps.reader.record(tx, tenantId, change.personId);
  const values = subject?.values ?? {};
  const requesterId = await deps.reader.personOf(tx, tenantId, change.approval.requestedBy);
  const requester =
    requesterId === null ? null : await deps.reader.record(tx, tenantId, requesterId);
  const calendar = deps.flags ? await deps.flags.calendars.load(tx, tenantId) : null;
  const zone =
    calendar === null
      ? 'UTC'
      : personZone(calendar, placementOf(requester?.values ?? values), change.approval.requestedAt);

  const pay = !input.readable
    ? null
    : change.sealed || definition?.encrypted === true
      ? dataType === 'money'
        ? await openedPay(tx, deps, change)
        : null
      : pairOf(moneyOf(values[change.attributeKey]), moneyOf(change.value));
  const store = deps.flags?.store;

  let team: { name: string; raises: string[] } | null = null;
  const teamValue = text(values[TEAM_KEY]);
  if (pay !== null && !('sealed' in pay) && store !== undefined && teamValue !== null) {
    const year = change.approval.requestedAt.slice(0, 4);
    const pairs = await store.teamRaises(tx, tenantId, {
      teamKey: TEAM_KEY,
      team: teamValue,
      payKey: change.attributeKey,
      except: change.personId,
      from: `${year}-01-01`,
      until: `${year}-12-31`,
    });
    team = {
      name: optionLabel(byKey.get(TEAM_KEY), teamValue),
      raises: pairs.flatMap((p) => {
        const pct = payChangePercent(p);
        return pct !== null && pct.isPositive() && !pct.isZero() ? [pct.toString()] : [];
      }),
    };
  }

  let band = null;
  const grade = text(values[GRADE_KEY]);
  if (pay !== null && store !== undefined && grade !== null) {
    const found = await store.band(tx, tenantId, {
      grade,
      currency: pay.after.currency,
      day: change.effectiveFrom,
    });
    band =
      found === null
        ? null
        : {
            grade: optionLabel(byKey.get(GRADE_KEY), grade),
            currency: pay.after.currency,
            ...found,
            limitsShown: look.bandReadable,
          };
  }

  const contact: { kind: 'address' | 'email'; at: string }[] = [];
  if (dataType === 'bank_account') {
    const kindOf = new Map(
      look.definitions
        .filter((d) => d.dataType === 'address' || d.dataType === 'email')
        .map((d) => [d.key as string, d.dataType as 'address' | 'email']),
    );
    const since = new Date(
      Date.parse(change.approval.requestedAt) - CONTACT_DAYS * DAY_MS,
    ).toISOString();
    const recorded =
      store === undefined || kindOf.size === 0
        ? []
        : await store.changedAt(tx, tenantId, {
            personId: change.personId,
            keys: [...kindOf.keys()],
            since,
          });
    // A change still waiting counts as much as one recorded.
    const waiting = (await deps.store.forPerson(tx, tenantId, change.personId)).filter(
      (o) => kindOf.has(o.attributeKey) && o.approval.state !== 'withdrawn',
    );
    for (const r of recorded) {
      const kind = kindOf.get(r.key);
      if (kind !== undefined) contact.push({ kind, at: r.at });
    }
    for (const w of waiting) {
      const kind = kindOf.get(w.attributeKey);
      if (kind !== undefined) contact.push({ kind, at: w.approval.requestedAt });
    }
  }

  const theirManager = text(requester?.values['manager_id']);
  const colleagues =
    look.managerOfDecider !== null && theirManager === look.managerOfDecider
      ? { name: input.requesterName }
      : null;

  return unusual(
    {
      id: change.approval.id,
      dataType,
      requestedAt: change.approval.requestedAt,
      requestedBy: change.approval.requestedBy,
      subjectAccountId: subject?.snapshot.identityAccountId ?? null,
      effectiveFrom: change.effectiveFrom,
      pay,
    },
    { zone, at, team, band, contact, colleagues, enabled: look.enabled, marks: look.marks },
  );
}

/* ------------------------------------------------------------ settings -- */

export interface CheckView {
  readonly code: CheckCode | typeof MANAGER_PAY.code;
  readonly title: string;
  readonly detail: string;
  readonly on: boolean;
}

/** Every check, then the setting beside them (`MANAGER_PAY`), as AI8's card lists them. */
export const checksOf = (switches: Switches): CheckView[] => [
  ...CHECKS.map((c) => ({
    code: c.code,
    title: c.title,
    detail: c.detail,
    on: switches.enabled.has(c.code),
  })),
  { ...MANAGER_PAY, on: switches.managerPay },
];

/**
 * A People administrator switches one check, or `MANAGER_PAY`, on or off
 * (AI8). It holds from the next read: what each change's checks found is kept
 * with pay read, and every read applies the switches as they are then.
 */
export async function setCheck(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'clock' | 'flags' | 'relations'>,
  asking: Asking & { readonly code: string; readonly on: boolean },
): Promise<Result<readonly CheckView[]>> {
  if (!deps.flags) return err(failure('UNAVAILABLE', 'Approval checks are not configured'));
  if (!isCheckCode(asking.code) && asking.code !== MANAGER_PAY.code) {
    return err(failure('NOT_FOUND', `Kithena runs no check called ${asking.code}`));
  }
  const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
  if (!everyone.isAdmin) {
    return err(failure('FORBIDDEN', 'Only a People administrator switches the checks'));
  }
  await deps.flags.store.setSwitch(tx, asking.tenantId, {
    code: asking.code,
    on: asking.on,
    by: asking.viewer.accountId,
    at: deps.clock.instant(),
  });
  return ok(checksOf(await switchesOf(tx, deps.flags, asking.tenantId)));
}

const NOBODY = '00000000-0000-0000-0000-000000000000';

/** Whoever may decide it: HR, not the requester, not the person it is about. */
async function mayDecide(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'reader' | 'relations'>,
  asking: Asking,
  change: PendingChange,
): Promise<boolean> {
  const person = await deps.reader.record(tx, asking.tenantId, change.personId);
  if (!person) return false;
  const relations = await deps.relations.relations(
    tx,
    asking.tenantId,
    asking.viewer,
    change.personId,
  );
  const me = asking.viewer.accountId;
  return (
    relations.isHr && change.approval.requestedBy !== me && person.snapshot.identityAccountId !== me
  );
}

/**
 * "Not unusual" (AI7): whoever may decide the change says its flags were not
 * worth raising. Each reason it carries now is marked, so the same check is
 * quieter for the same requester for 90 days. It decides nothing.
 */
export async function markNotUnusual(
  tx: Tx,
  deps: PendingChangeDeps,
  asking: Asking & { readonly changeId: string; readonly requesterName?: string },
): Promise<Result<{ readonly marked: number }>> {
  const flags = deps.flags;
  if (!flags) return err(failure('UNAVAILABLE', 'Approval checks are not configured'));
  const change = await deps.store.find(tx, asking.tenantId, asking.changeId);
  if (!change || stateAt(change.approval, deps.clock.instant()) !== 'pending') {
    return err(failure('NOT_FOUND', 'No such pending change'));
  }
  if (!(await mayDecide(tx, deps, asking, change))) {
    return err(failure('FORBIDDEN', 'Only whoever may decide a change marks its flags'));
  }
  const look = await looking(tx, deps, asking);
  const found = await flagChange(tx, deps, look, {
    change,
    readable: await readableBy(tx, deps, asking, change, look),
    requesterName: asking.requesterName ?? 'the requester',
  });
  const at = deps.clock.instant();
  await flags.store.mark(
    tx,
    asking.tenantId,
    change.approval.id,
    found.reasons.map((r) => ({
      code: r.code,
      requestedBy: change.approval.requestedBy,
      magnitude: r.magnitude,
      at,
    })),
    asking.viewer.accountId,
  );
  return ok({ marked: found.reasons.length });
}

/**
 * Whether the decider's pay checks may read the field a change is to, on its
 * person (`payReadable`): by the rule the Flagged count and list apply in
 * their query (`flaggedWhere`), so the detail pane flags what the list does.
 */
export async function readableBy(
  tx: Tx,
  deps: Pick<PendingChangeDeps, 'relations'>,
  asking: Asking,
  change: PendingChange,
  look: Pick<Looking, 'definitions' | 'managerPay'>,
): Promise<boolean> {
  const relations = await deps.relations.relations(
    tx,
    asking.tenantId,
    asking.viewer,
    change.personId,
  );
  return payReadable(payReach(look.definitions, relations, look.managerPay), change.attributeKey, {
    direct: relations.isManager,
    chain: relations.isManager || relations.isInManagerChain,
  });
}

/* ----------------------------------------------------------- questions -- */

/** The decider asks the requester before deciding ("Ask Nora"). */
export async function askAboutChange(
  tx: Tx,
  deps: PendingChangeDeps,
  asking: Asking & { readonly changeId: string; readonly question: string },
): Promise<Result<Question>> {
  const flags = deps.flags;
  if (!flags) return err(failure('UNAVAILABLE', 'Questions are not configured'));
  const change = await deps.store.find(tx, asking.tenantId, asking.changeId);
  if (!change) return err(failure('NOT_FOUND', 'No such pending change'));
  if (!(await mayDecide(tx, deps, asking, change))) {
    return err(failure('FORBIDDEN', 'Only whoever may decide a change asks about it'));
  }
  const asked = askRequester(change.approval, {
    id: deps.newId(),
    by: asking.viewer.accountId,
    question: asking.question,
    at: deps.clock.instant(),
  });
  if (!asked.ok) return asked;
  await flags.store.ask(tx, asking.tenantId, asked.value);
  return asked;
}

/** The requester answers a question about their change, once. */
export async function answerAboutChange(
  tx: Tx,
  deps: PendingChangeDeps,
  asking: Asking & { readonly questionId: string; readonly answer: string },
): Promise<Result<Question>> {
  const flags = deps.flags;
  if (!flags) return err(failure('UNAVAILABLE', 'Questions are not configured'));
  const NotFound = failure('NOT_FOUND', 'No such question');
  const question = await flags.store.question(tx, asking.tenantId, asking.questionId);
  if (!question) return err(NotFound);
  const change = await deps.store.find(tx, asking.tenantId, question.changeId);
  if (!change) return err(NotFound);
  const answered = answerQuestion(question, change.approval, {
    by: asking.viewer.accountId,
    answer: asking.answer,
    at: deps.clock.instant(),
  });
  if (!answered.ok) {
    // Somebody else's question is not theirs to learn about.
    return answered.error.code === 'FORBIDDEN' ? err(NotFound) : answered;
  }
  if (!(await flags.store.answer(tx, asking.tenantId, answered.value))) {
    return err(failure('ALREADY_ANSWERED', 'This question was already answered'));
  }
  return answered;
}
