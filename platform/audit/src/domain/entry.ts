import type * as z from 'zod';
import type {
  Actor,
  ExportCompleted,
  FullValuesDecided,
  FullValuesIssued,
  FullValuesRequested,
  ImportCompleted,
  PersonIdentifierRevealed,
  SettingsActivityRecorded,
  SupportSessionStarted,
  TenantAdministratorNamed,
} from '@kithena/contracts';

/**
 * One line of the activity log: who did what, when, to what, in words.
 *
 * It never holds a value. Every field below is a word the log chose, an id, a
 * label somebody gave a setting, or a reason somebody typed to justify what
 * they did — never a salary, an identifier, or what a record says. The events
 * it is made from were built not to carry one, and this takes only words from
 * them, so the log cannot show a viewer what the record would not.
 */

/** Filterable. A module a company lacks contributes none of its areas. */
export const AREAS = [
  'fields',
  'organisation',
  'roles',
  'integrations',
  'imports_exports',
  'sensitive_access',
  'sign_in',
] as const;
export type Area = (typeof AREAS)[number];

export const ACTOR_KINDS = ['person', 'support', 'system', 'integration'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface EntryActor {
  readonly kind: ActorKind;
  /** The account that acted; for support, the one whose rights it used. Null for system and integrations. */
  readonly accountId: string | null;
  /** The back-office operator, when Kithena support acted. */
  readonly onBehalfOf: string | null;
}

export interface EntrySubject {
  readonly kind: 'person' | 'account' | 'setting' | 'export' | 'import' | 'request' | 'session';
  readonly id: string | null;
  /** Its name at the time, in words. Never a person's value. */
  readonly label: string | null;
}

export interface Entry {
  readonly tenantId: string;
  /** Unique per tenant: a redelivered event is not a second entry. */
  readonly sourceEventId: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly module: 'people' | 'identity';
  readonly area: Area;
  readonly action: string;
  readonly detail: string | null;
  readonly actor: EntryActor;
  readonly subject: EntrySubject | null;
  readonly reason: string | null;
}

/** An envelope, already parsed against its contract. */
export interface SourceEvent {
  readonly eventId: string;
  readonly eventName: string;
  readonly tenantId: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actor: Actor;
  readonly payload: unknown;
}

type Payload<T extends { payload: z.ZodType }> = z.infer<T['payload']>;

/** The envelope's actor, as the log names it: support is never the account it signed in as. */
export function actorOf(actor: Actor): EntryActor {
  switch (actor.kind) {
    case 'user':
      return actor.onBehalfOf === undefined
        ? { kind: 'person', accountId: actor.userId, onBehalfOf: null }
        : { kind: 'support', accountId: actor.userId, onBehalfOf: actor.onBehalfOf };
    case 'integration':
      return { kind: 'integration', accountId: null, onBehalfOf: null };
    case 'system':
      return { kind: 'system', accountId: null, onBehalfOf: null };
  }
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/** What an event says, before the envelope's facts are put around it. */
type Said = Pick<Entry, 'module' | 'area' | 'action'> &
  Partial<Pick<Entry, 'detail' | 'subject' | 'reason' | 'actor'>>;

/** Each event the log keeps, and how it reads. Anything not here is not the log's. */
const SAYS: Readonly<Record<string, (payload: never) => Said>> = {
  'people.settings.activity_recorded': (p: Payload<typeof SettingsActivityRecorded>) => ({
    module: 'people',
    area: p.area,
    action: p.action,
    detail: p.detail,
    subject: p.subject === null ? null : { kind: 'setting', id: null, label: p.subject },
    reason: p.reason,
  }),

  'people.import.completed': (p: Payload<typeof ImportCompleted>) => {
    const parts = [
      p.counts.created > 0 ? `${String(p.counts.created)} added` : null,
      p.counts.updated > 0 ? `${String(p.counts.updated)} changed` : null,
      p.counts.blocked > 0 ? `${String(p.counts.blocked)} blocked` : null,
    ].filter((x) => x !== null);
    return {
      module: 'people',
      area: 'imports_exports',
      action: 'Imported people',
      detail: parts.length === 0 ? 'Nothing changed.' : `${parts.join(', ')}.`,
      subject: { kind: 'import', id: p.importId, label: null },
    };
  },

  'people.export.completed': (p: Payload<typeof ExportCompleted>) => ({
    module: 'people',
    area: 'imports_exports',
    action: 'Exported people',
    detail: `${plural(p.rowCount, 'person', 'people')}, ${plural(p.attributeKeys.length, 'field')}, as ${p.format.toUpperCase()}.`,
    subject: { kind: 'export', id: p.exportId, label: null },
    reason: p.reason,
  }),

  'people.export.full_values_requested': (p: Payload<typeof FullValuesRequested>) => ({
    module: 'people',
    area: 'sensitive_access',
    action: 'Asked for full values',
    detail: `${plural(p.attributeKeys.length, 'field')}.`,
    subject: { kind: 'request', id: p.requestId, label: null },
    reason: p.reason,
  }),

  'people.export.full_values_decided': (p: Payload<typeof FullValuesDecided>) => ({
    module: 'people',
    area: 'sensitive_access',
    action:
      p.decision === 'approved'
        ? 'Approved a full-values request'
        : 'Turned down a full-values request',
    subject: { kind: 'request', id: p.requestId, label: null },
    reason: p.note,
  }),

  'people.export.full_values_issued': (p: Payload<typeof FullValuesIssued>) => ({
    module: 'people',
    area: 'sensitive_access',
    action: 'Issued a full-values file',
    detail: `${plural(p.rowCount, 'person', 'people')}, ${plural(p.attributeKeys.length, 'field')}.`,
    subject: { kind: 'request', id: p.requestId, label: null },
  }),

  'people.export.full_values_downloaded': (p: { requestId: string }) => ({
    module: 'people',
    area: 'sensitive_access',
    action: 'Downloaded a full-values file',
    subject: { kind: 'request', id: p.requestId, label: null },
  }),

  'people.export.full_values_expired': (p: { requestId: string }) => ({
    module: 'people',
    area: 'sensitive_access',
    action: 'A full-values request lapsed undecided',
    subject: { kind: 'request', id: p.requestId, label: null },
  }),

  'people.person.identifier_revealed': (p: Payload<typeof PersonIdentifierRevealed>) => ({
    module: 'people',
    area: 'sensitive_access',
    action: 'Read an identifier in full',
    // The field's key, which names the field and holds nothing of anybody's.
    detail: `Field: ${p.attributeKey}.`,
    subject: { kind: 'person', id: p.personId, label: null },
  }),

  'identity.support.session_started': (p: Payload<typeof SupportSessionStarted>) => ({
    module: 'identity',
    area: 'sign_in',
    action: 'Kithena support signed in',
    subject: { kind: 'session', id: p.sessionId, label: null },
    reason: p.reason,
    actor: { kind: 'support', accountId: p.accountId, onBehalfOf: p.operatorId },
  }),

  'identity.tenant.administrator_named': (p: Payload<typeof TenantAdministratorNamed>) =>
    administrator('Named', p.entitlement, p.accountId, p.namedBy),

  'identity.tenant.administrator_removed': (p: {
    entitlement: string;
    accountId: string;
    removedBy: string | null;
  }) => administrator('Removed', p.entitlement, p.accountId, p.removedBy),
};

/** The back office naming or removing a module's administrator: Kithena support, when it says who. */
function administrator(
  verb: 'Named' | 'Removed',
  entitlement: string,
  accountId: string,
  operator: string | null,
): Said {
  const module = entitlement.replace(/^module\./, '');
  return {
    module: 'identity',
    area: 'roles',
    action: `${verb} an administrator of ${module.charAt(0).toUpperCase()}${module.slice(1)}`,
    subject: { kind: 'account', id: accountId, label: null },
    ...(operator === null
      ? {}
      : { actor: { kind: 'support' as const, accountId: null, onBehalfOf: operator } }),
  };
}

/** Whether the log keeps this event at all. */
export const kept = (eventName: string): boolean => eventName in SAYS;

/** The entry an event becomes, or null for one the log does not keep. */
export function entryFrom(event: SourceEvent): Entry | null {
  const say = SAYS[event.eventName];
  if (say === undefined) return null;
  const said = say(event.payload as never);
  return {
    tenantId: event.tenantId,
    sourceEventId: event.eventId,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    module: said.module,
    area: said.area,
    action: said.action,
    detail: said.detail ?? null,
    actor: said.actor ?? actorOf(event.actor),
    subject: said.subject ?? null,
    reason: said.reason ?? null,
  };
}
