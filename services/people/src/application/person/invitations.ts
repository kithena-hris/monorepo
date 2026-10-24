import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

import { personZone, placementOf } from '../../domain/org/calendar.js';
import { NOT_STARTED, Person } from '../../domain/person/person.js';
import { signupQuestions } from '../../domain/schema/signup.js';
import type { Calendars } from '../org/org.js';
import type { PersonRepository } from '../person-repository.js';
import type { Asking, PersonReader, RelationsResolver, SchemaVersions } from './ports.js';

/**
 * A hire, invited to their company's Kithena (People PRD §8.2, step 8):
 * HR sends it now or on a day they choose, from People or from the hire's
 * candidate profile in Recruiting, through the shell.
 *
 * Identity holds the account and sends the link; People asks for it with the
 * person's work email, their start date and zone, and what the sign-up page
 * shows already filled in — the name on file and its answers to the
 * company's own sign-up questions — so the hire confirms rather than types.
 * The account is the person's from then on: People links it at once, and
 * their first enrolment makes them `onboarding` (`beginOnboarding`).
 *
 * A day in the future is kept and sent by the background job on that day, on
 * the person's own calendar. Sending again re-issues the link to an account
 * that has not enrolled; one that has is refused.
 */

type Tx = PostgresJsDatabase;

export interface InvitationRow {
  readonly personId: string;
  /** The day it goes, on the person's calendar. */
  readonly sendOn: string;
  readonly sentAt: string | null;
  readonly accountId: string | null;
}

export interface InvitationStore {
  get(tx: Tx, tenantId: string, personId: string): Promise<InvitationRow | null>;
  save(tx: Tx, tenantId: string, row: InvitationRow, by: string | null): Promise<void>;
  /** The person holding this work email, not discarded or merged; null for nobody. */
  byEmail(tx: Tx, tenantId: string, email: string): Promise<string | null>;
  /** Scheduled and not sent, due on or before this day somewhere. */
  due(tx: Tx, tenantId: string, onOrBefore: string, limit: number): Promise<readonly string[]>;
}

export interface IdentityInviter {
  invite(
    tenantId: string,
    input: {
      readonly email: string;
      readonly employmentStart: string;
      readonly timeZone: string;
      readonly name: {
        readonly given: string;
        readonly family: string;
        readonly preferred: string | null;
      } | null;
      readonly answers: Readonly<Record<string, string>>;
    },
  ): Promise<Result<{ readonly accountId: string; readonly expiresAt: string }>>;
}

export interface InvitationDeps {
  readonly reader: PersonReader;
  readonly people: PersonRepository;
  readonly schemas: SchemaVersions;
  readonly relations: RelationsResolver;
  readonly calendars: Calendars;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly store: InvitationStore;
  /** Absent where identity is not wired: inviting answers UNAVAILABLE. */
  readonly inviter?: IdentityInviter | undefined;
}

/** Where a hire stands with their account, for the card that sends it. */
export interface InvitationView {
  readonly personId: string;
  readonly status: string;
  readonly state: 'not_invited' | 'scheduled' | 'invited' | 'signed_up';
  readonly sendOn: string | null;
  readonly sentAt: string | null;
}

const NOBODY = '00000000-0000-0000-0000-000000000000';
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

export function invitations(deps: InvitationDeps) {
  const hrOnly = async (tx: Tx, asking: Asking): Promise<Result<true>> => {
    const r = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    return r.isHr ? ok(true) : err(failure('FORBIDDEN', 'Only HR invites a person to the company'));
  };

  const viewOf = (
    status: string,
    row: InvitationRow | null,
    linked: boolean,
  ): InvitationView['state'] => {
    if (status === 'onboarding' || (!NOT_STARTED.has(status as never) && linked))
      return 'signed_up';
    if (row?.sentAt != null || linked) return 'invited';
    return row === null ? 'not_invited' : 'scheduled';
  };

  const view = async (
    tx: Tx,
    tenantId: string,
    personId: string,
  ): Promise<InvitationView | null> => {
    const record = await deps.reader.record(tx, tenantId, personId);
    if (record === null) return null;
    const row = await deps.store.get(tx, tenantId, personId);
    const status = record.snapshot.status;
    return {
      personId,
      status,
      state: viewOf(status, row, record.snapshot.identityAccountId !== null),
      sendOn: row?.sendOn ?? null,
      sentAt: row?.sentAt ?? null,
    };
  };

  /** The link, now: identity commissions or re-issues, and People links the account. */
  const send = async (
    tx: Tx,
    tenantId: string,
    personId: string,
  ): Promise<Result<InvitationRow>> => {
    const inviter = deps.inviter;
    if (inviter === undefined)
      return err(failure('UNAVAILABLE', 'Inviting is not set up on this deployment'));
    const record = await deps.reader.record(tx, tenantId, personId, true);
    if (record === null) return err(failure('NOT_FOUND', 'No such person'));
    const s = record.snapshot;
    if (s.status === 'onboarding') return err(failure('SIGNED_UP', 'They have already signed up'));
    if (!NOT_STARTED.has(s.status) && s.status !== 'active')
      return err(failure('NOT_INVITABLE', `A record that is ${s.status} is not invited`));
    const email =
      typeof record.values['work_email'] === 'string' ? record.values['work_email'] : '';
    if (email === '')
      return err(failure('NO_EMAIL', 'They have no email to send it to', ['work_email']));
    const at = deps.clock.instant();
    const zone = personZone(
      await deps.calendars.load(tx, tenantId),
      placementOf(record.values),
      at,
    );
    const version = await deps.schemas.current(tx, tenantId);
    const keys =
      version === null ? [] : signupQuestions(version.document.attributes).map((q) => q.key);
    const answers = Object.fromEntries(
      keys.flatMap((key) => {
        const value = record.values[key];
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          ? [[key, String(value)]]
          : [];
      }),
    );
    const given = record.values['given_name'];
    const family = record.values['family_name'];
    const preferred = record.values['preferred_name'];
    const invited = await inviter.invite(tenantId, {
      email,
      employmentStart: s.hireDate ?? deps.clock.date(zone),
      timeZone: zone,
      name:
        typeof given === 'string' && typeof family === 'string' && given !== '' && family !== ''
          ? { given, family, preferred: typeof preferred === 'string' ? preferred : null }
          : null,
      answers,
    });
    if (!invited.ok) return invited;
    if (s.identityAccountId === null) {
      const person = Person.rehydrate(s);
      const linked = person.linkAccount(invited.value.accountId, {
        clock: deps.clock,
        newEventId: deps.newId,
        actor: { kind: 'system', process: 'people-invitations' },
        correlationId: deps.newId(),
        causationId: null,
      });
      if (!linked.ok) return linked;
      await deps.people.save(tx, person, {
        fields: { identityAccountId: invited.value.accountId },
      });
    }
    return ok({
      personId,
      sendOn: deps.clock.date(zone),
      sentAt: at,
      accountId: invited.value.accountId,
    });
  };

  return {
    /** Where the hire holding this work email stands; null when nobody here holds it. */
    async forEmail(
      tx: Tx,
      asking: Asking & { readonly email: string },
    ): Promise<Result<InvitationView | null>> {
      const allowed = await hrOnly(tx, asking);
      if (!allowed.ok) return allowed;
      const personId = await deps.store.byEmail(tx, asking.tenantId, asking.email.trim());
      return ok(personId === null ? null : await view(tx, asking.tenantId, personId));
    },

    /** Where this person stands with their account. */
    async forPerson(
      tx: Tx,
      asking: Asking & { readonly personId: string },
    ): Promise<Result<InvitationView | null>> {
      const allowed = await hrOnly(tx, asking);
      if (!allowed.ok) return allowed;
      return ok(await view(tx, asking.tenantId, asking.personId));
    },

    /** Send it now (no day, or today or before on their calendar), or keep it for the day given. */
    async invite(
      tx: Tx,
      asking: Asking & { readonly personId: string; readonly sendOn: string | null },
    ): Promise<Result<InvitationView>> {
      const allowed = await hrOnly(tx, asking);
      if (!allowed.ok) return allowed;
      if (asking.sendOn !== null && !DAY.test(asking.sendOn))
        return err(failure('VALUE_INVALID', 'sendOn is a calendar date', ['sendOn']));
      const record = await deps.reader.record(tx, asking.tenantId, asking.personId);
      if (record === null) return err(failure('NOT_FOUND', 'No such person'));
      const zone = personZone(
        await deps.calendars.load(tx, asking.tenantId),
        placementOf(record.values),
        deps.clock.instant(),
      );
      const by = asking.viewer.accountId;
      if (asking.sendOn !== null && asking.sendOn > deps.clock.date(zone)) {
        if (record.snapshot.status === 'onboarding')
          return err(failure('SIGNED_UP', 'They have already signed up'));
        await deps.store.save(
          tx,
          asking.tenantId,
          { personId: asking.personId, sendOn: asking.sendOn, sentAt: null, accountId: null },
          by,
        );
      } else {
        const sent = await send(tx, asking.tenantId, asking.personId);
        if (!sent.ok) return sent;
        await deps.store.save(tx, asking.tenantId, sent.value, by);
      }
      const shown = await view(tx, asking.tenantId, asking.personId);
      return shown === null ? err(failure('NOT_FOUND', 'No such person')) : ok(shown);
    },

    /**
     * The background job's: every invitation kept for a day that has come.
     * One failing (identity away) stays due and goes on the next run.
     */
    async sendDue(tx: Tx, tenantId: string, limit = 50): Promise<number> {
      // The latest date anywhere: each is then judged on the person's own day inside `send`.
      const latest = deps.clock.date('Pacific/Kiritimati');
      let sent = 0;
      for (const personId of await deps.store.due(tx, tenantId, latest, limit)) {
        // eslint-disable-next-line no-await-in-loop -- a few a day, each its own identity call
        const row = await deps.store.get(tx, tenantId, personId);
        // eslint-disable-next-line no-await-in-loop -- as above
        const record = await deps.reader.record(tx, tenantId, personId);
        if (row === null || record === null) continue;
        const zone = personZone(
          // eslint-disable-next-line no-await-in-loop -- as above
          await deps.calendars.load(tx, tenantId),
          placementOf(record.values),
          deps.clock.instant(),
        );
        if (row.sendOn > deps.clock.date(zone)) continue;
        // eslint-disable-next-line no-await-in-loop -- as above
        const done = await send(tx, tenantId, personId);
        if (!done.ok) continue;
        // eslint-disable-next-line no-await-in-loop -- as above
        await deps.store.save(tx, tenantId, { ...done.value, sendOn: row.sendOn }, null);
        sent += 1;
      }
      return sent;
    },
  };
}

export type Invitations = ReturnType<typeof invitations>;
