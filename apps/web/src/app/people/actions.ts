'use server';

import { people, type PeopleAnswer } from '../../lib/people';
import { VIEWS } from '../../lib/people-views';

/**
 * What the People screens' buttons do: server actions, each one operation
 * sent to People through the router as the person signed in (PEO-098,
 * PEO-113).
 *
 * One action per thing a screen can ask for, each naming its operation here.
 * The browser chooses the arguments and never the operation, and every
 * argument is validated again by People, which also decides whether this
 * person may do it at all. Nothing here authorizes anything. Every write
 * carries a fresh idempotency key (`lib/people.ts`).
 */

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

const outcome = async (answer: Promise<PeopleAnswer<unknown>>): Promise<Outcome> => {
  const a = await answer;
  return a.ok ? { ok: true } : { ok: false, message: a.message };
};

type Values = Readonly<Record<string, unknown>>;

/** A form's changed values as People's `FormValueInput`s: one slot each, null clears. */
function formInputs(changed: Values): Record<string, unknown>[] {
  return Object.entries(changed).flatMap(([key, value]): Record<string, unknown>[] => {
    if (value === null || value === undefined) return [{ key, clear: true }];
    if (typeof value === 'string') return [{ key, text: value }];
    if (typeof value === 'boolean') return [{ key, flag: value }];
    if (Array.isArray(value)) return [{ key, items: value.map(String) }];
    if (typeof value === 'object' && 'amountMinor' in value && 'currency' in value) {
      return [{ key, money: { amountMinor: String(value.amountMinor), currency: String(value.currency) } }];
    }
    // A sealed value's last four is what was shown, not something to write back.
    return [];
  });
}

/* ------------------------------------------------------------- records -- */

/** What People's checks warned about on a national identifier (PEO-125). Never the value. */
type Finding = Readonly<Record<string, string>>;
/**
 * A save's answer: what the checks found, and what it sent to HR for approval
 * instead of saving (PEO-077) — the fields' labels for a form, a count for the
 * grid.
 */
export type Saved =
  | {
      readonly ok: true;
      readonly findings: readonly Finding[];
      readonly held?: readonly string[] | number;
    }
  | { readonly ok: false; readonly message: string };

const saved = async (
  answer: Promise<PeopleAnswer<{ findings?: Finding[]; held?: readonly string[] | number | null }>>,
): Promise<Saved> => {
  const a = await answer;
  if (!a.ok) return { ok: false, message: a.message };
  const held = a.data.held;
  return {
    ok: true,
    findings: a.data.findings ?? [],
    ...(held === undefined || held === null ? {} : { held }),
  };
};

export async function saveOwnSection(sectionKey: string, changed: Values): Promise<Saved> {
  return saved(people('SaveOwnSection', { changed: formInputs(changed) }));
}

export async function savePersonSection(
  personId: string,
  sectionKey: string,
  changed: Values,
): Promise<Saved> {
  return saved(people('SavePersonSection', { personId, changed: formInputs(changed) }));
}

/**
 * What saving these identifiers would be warned about, before they are saved
 * (PEO-125): nothing is kept. No person id is the signed-in person's own record.
 */
export async function checkIdentifiers(
  personId: string | null,
  sectionKey: string,
  changed: Values,
): Promise<Saved> {
  return saved(people('IdentifierCheck', { personId, changed: formInputs(changed) }));
}

/** HR's decision on a doubted identifier: final, audited by People. */
export async function reviewIdentifier(
  personId: string,
  attributeKey: string,
  decision: 'accept' | 'send_back',
  note: string | null,
): Promise<Outcome> {
  return outcome(
    people('ReviewIdentifier', {
      personId,
      attributeKey,
      decision,
      ...(note === null ? {} : { note }),
    }),
  );
}

/** The doubted value in full, for HR deciding it; People audits the read. */
export async function revealIdentifier(
  personId: string,
  attributeKey: string,
): Promise<{ ok: true; value: string } | { ok: false; message: string }> {
  const answer = await people<{ value: string }>('RevealIdentifier', { personId, attributeKey });
  return answer.ok ? { ok: true, value: answer.data.value } : { ok: false, message: answer.message };
}

/** Move a person to a legal entity and location from a date (PEO-123); People decides who may. */
export async function placePerson(
  personId: string,
  placement: {
    readonly legalEntityId?: string | null;
    readonly locationId?: string | null;
    readonly effectiveFrom?: string;
  },
): Promise<Outcome> {
  return outcome(people('PlacePerson', { personId, ...placement }));
}

export async function saveGrid(
  changes: readonly {
    readonly personId: string;
    readonly values: Readonly<Record<string, string>>;
  }[],
): Promise<Saved> {
  return saved(people('SaveCompletenessGrid', { changes: gridChanges(changes) }));
}

/** What saving these grid cells would be warned about, before they are saved (PEO-125). */
export async function checkGrid(changes: GridChanges): Promise<Saved> {
  return saved(people('GridCheck', { changes: gridChanges(changes) }));
}

type GridChanges = readonly {
  readonly personId: string;
  readonly values: Readonly<Record<string, string>>;
}[];

const gridChanges = (changes: GridChanges) =>
  changes.map((c) => ({
    personId: c.personId,
    values: Object.entries(c.values).map(([key, value]) => ({ key, value })),
  }));

/**
 * People a person field may name, found by name over everybody, as the
 * person signed in may read them (PEO-122). The picker's first page: typing
 * more narrows it.
 */
export async function searchPeople(
  text: string,
): Promise<readonly { readonly value: string; readonly label: string }[]> {
  const answer = await people<{ options: { value: string; label: string }[] }>('PeoplePicker', {
    search: text.slice(0, 200),
  });
  return answer.ok ? answer.data.options : [];
}

/* --------------------------------------------------------------- setup -- */

export async function confirmEntity(entity: { name: string; country: string }): Promise<Outcome> {
  return outcome(people('ConfirmSetupEntity', { name: entity.name, country: entity.country }));
}

export async function publishSetup(pack: {
  country: string;
  sections: readonly string[];
}): Promise<Outcome> {
  return outcome(people('PublishSetup', { country: pack.country, sections: [...pack.sections] }));
}

/* ------------------------------------------------------------ registry -- */

export async function reorderSections(order: readonly string[]): Promise<Outcome> {
  return outcome(people('ReorderDraftSections', { order: [...order] }));
}

export async function reorderFields(
  sectionKey: string,
  order: readonly string[],
): Promise<Outcome> {
  return outcome(people('ReorderDraftFields', { sectionKey, order: [...order] }));
}

export async function addSection(label: string): Promise<Outcome> {
  return outcome(people('AddDraftSection', { label }));
}

export async function saveField(input: Values, editing: string | null): Promise<Outcome> {
  return outcome(people('SaveDraftField', { input, editing }));
}

export async function advise(field: Values): Promise<unknown> {
  const answer = await people<Record<string, unknown>>('ClassificationAdvice', {
    label: field['label'],
    description: field['description'] ?? null,
    dataType: field['dataType'],
    sectionKey: field['sectionKey'],
    options: field['options'] ?? [],
  });
  // No judgment is a judgment the editor already draws: the section's default.
  return answer.ok
    ? VIEWS.Advice(answer.data)
    : { kind: 'fallback', classification: 'confidential', piiKind: 'none', floor: 'internal' };
}

export async function previewPublish(requiredFrom: string): Promise<unknown> {
  const answer = await people<unknown>('PublishPreview', { requiredFrom });
  if (!answer.ok) throw new Error(answer.message);
  return answer.data;
}

export async function publishDraft(requiredFrom: string): Promise<Outcome> {
  return outcome(people('PublishDraft', { requiredFrom }));
}

/* -------------------------------------------------------- integrations -- */

export type WithSecret =
  { readonly ok: true; readonly secret: string } | { readonly ok: false; readonly message: string };

const withSecret = (answer: PeopleAnswer<{ secret: string | null }>): WithSecret =>
  !answer.ok
    ? { ok: false, message: answer.message }
    : answer.data.secret === null
      ? // A retry of a request that already went through: the secret was shown once.
        { ok: false, message: 'Done, but the secret was not shown. Rotate it to see a new one.' }
      : { ok: true, secret: answer.data.secret };

export async function createEndpoint(input: {
  url: string;
  events: readonly string[];
  allowlist: readonly string[];
  alertEmail: string;
}): Promise<WithSecret> {
  return withSecret(
    await people('CreateWebhookEndpoint', {
      url: input.url,
      events: [...input.events],
      allowlist: [...input.allowlist],
      alertEmail: input.alertEmail,
    }),
  );
}

export async function updateEndpoint(id: string, patch: Values): Promise<Outcome> {
  const known = ['url', 'events', 'allowlist', 'alertEmail', 'enabled'];
  return outcome(
    people('UpdateWebhookEndpoint', {
      id,
      ...Object.fromEntries(Object.entries(patch).filter(([key]) => known.includes(key))),
    }),
  );
}

export async function rotateEndpoint(id: string): Promise<WithSecret> {
  return withSecret(await people('RotateWebhookSecret', { id }));
}

export async function replayDelivery(deliveryId: string): Promise<Outcome> {
  return outcome(people('ReplayWebhookDelivery', { deliveryId }));
}

/* --------------------------------------------------------- full values -- */

/** Finance asks for sealed fields in full, with a reason (PEO-088); HR decides. */
export async function requestFullValues(fields: readonly string[], reason: string): Promise<Outcome> {
  return outcome(people('RequestFullValues', { fields: [...fields], reason }));
}

/* ---------------------------------------------- approvals (PEO-077) -- */

/** HR approves or rejects a change held for approval; People decides who may. */
export async function decidePendingChange(
  id: string,
  approve: boolean,
  note: string | null,
): Promise<Outcome> {
  return outcome(
    people('DecidePendingChange', { id, approve, ...(note === null ? {} : { note }) }),
  );
}

/** The requester takes their change back while it waits. */
export async function withdrawPendingChange(id: string): Promise<Outcome> {
  return outcome(people('WithdrawPendingChange', { id }));
}

export async function decideFullValues(
  id: string,
  approve: boolean,
  note: string | null,
): Promise<Outcome> {
  return outcome(people('DecideFullValues', { id, approve, ...(note === null ? {} : { note }) }));
}

/* --------------------------------------------------------------- roles -- */

type TenantRole = 'hr' | 'finance' | 'people_admin';

/** Grant or revoke a tenant role (PEO-112), keyed per press. */
export async function grantRole(
  accountId: string,
  role: TenantRole,
  reason: string,
): Promise<Outcome> {
  return outcome(people('GrantRole', { accountId, role, reason }));
}

export async function revokeRole(
  accountId: string,
  role: TenantRole,
  reason: string,
): Promise<Outcome> {
  return outcome(people('RevokeRole', { accountId, role, reason }));
}

/* -------------------------------------------------------- organisation -- */

/** Only what was given: GraphQL's optional arguments are absent, never undefined. */
const given = (patch: Values): Record<string, unknown> =>
  Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));

export async function updateSettings(patch: {
  defaultTimeZone?: string;
  cohortMinimum?: number;
}): Promise<Outcome> {
  return outcome(people('UpdatePeopleSettings', given(patch)));
}

export async function createEntity(input: {
  name: string;
  country: string;
  timeZone: string;
}): Promise<Outcome> {
  return outcome(people('CreateLegalEntity', { ...input }));
}

export async function updateEntity(
  id: string,
  patch: { name?: string; timeZone?: string; archived?: boolean },
): Promise<Outcome> {
  return outcome(people('UpdateLegalEntity', { id, ...given(patch) }));
}

export async function createLocation(input: {
  legalEntityId: string;
  name: string;
  country: string;
  timeZone: string;
  effectiveFrom?: string;
}): Promise<Outcome> {
  return outcome(people('CreateLocation', given(input)));
}

export async function updateLocation(
  id: string,
  patch: { name?: string; archived?: boolean },
): Promise<Outcome> {
  return outcome(people('UpdateLocation', { id, ...given(patch) }));
}

export async function changeZone(
  id: string,
  timeZone: string,
  effectiveFrom: string,
): Promise<Outcome> {
  return outcome(people('ChangeLocationZone', { id, timeZone, effectiveFrom }));
}

export async function setNumbering(
  legalEntityId: string,
  scheme: { prefix: string; digits: number; start: number },
): Promise<Outcome> {
  return outcome(people('SetEmployeeNumbering', { legalEntityId, ...scheme }));
}

/* ----------------------------------------------------------- lifecycle -- */

type LeavingReason = 'resigned' | 'dismissed' | 'end_of_contract';

/** One of a person's lifecycle moves (PEO-120), HR's, keyed per press. People decides whether it may. */
export type LifecycleMove =
  | { readonly kind: 'giveNotice'; readonly lastWorkingDay: string; readonly reason?: LeavingReason }
  | { readonly kind: 'withdrawNotice' }
  | {
      readonly kind: 'terminate';
      readonly lastWorkingDay: string;
      readonly reason: LeavingReason;
      readonly note?: string;
      readonly eligibleForRehire?: boolean;
      readonly endAccessNow?: boolean;
    }
  | { readonly kind: 'endAccess' }
  | { readonly kind: 'startLeave' }
  | { readonly kind: 'endLeave' }
  | { readonly kind: 'discard' }
  | { readonly kind: 'rehire'; readonly startDate: string; readonly overrideReason?: string };

const MOVES = {
  giveNotice: 'GiveNotice',
  withdrawNotice: 'WithdrawNotice',
  terminate: 'TerminatePerson',
  endAccess: 'EndPersonAccess',
  startLeave: 'StartLeave',
  endLeave: 'EndLeave',
  discard: 'DiscardPerson',
  rehire: 'RehirePerson',
} as const;

export async function moveLifecycle(personId: string, move: LifecycleMove): Promise<Outcome> {
  const { kind, ...input } = move;
  return outcome(people(MOVES[kind], { personId, ...given(input) }));
}

/* -------------------------------------------------------------- import -- */

/**
 * An import never sends its file through here: the browser PUTs it straight
 * to storage (PRD §14.2), and these carry only where, and which upload. A
 * Vercel function refuses a body over 4.5 MB, and an import may be 100 MB.
 */
export type UploadTarget =
  | {
      readonly ok: true;
      readonly uploadId: string;
      readonly url: string;
      readonly method: string;
      /** Signed: the browser sends exactly these. */
      readonly headers: Readonly<Record<string, string>>;
    }
  | { readonly ok: false; readonly message: string };

export async function startImportUpload(file: {
  name: string;
  size: number;
}): Promise<UploadTarget> {
  const answer = await people<{
    uploadId: string;
    url: string;
    method: string;
    headers: { name: string; value: string }[];
  }>('StartImportUpload', { name: file.name.slice(0, 255), size: file.size });
  if (!answer.ok) return { ok: false, message: answer.message };
  return {
    ok: true,
    uploadId: answer.data.uploadId,
    url: answer.data.url,
    method: answer.data.method,
    headers: Object.fromEntries(answer.data.headers.map((h) => [h.name, h.value])),
  };
}

export type Staged = { ok: true; stage: unknown } | { ok: false; message: string };

const staged = async (answer: Promise<PeopleAnswer<Record<string, unknown>>>): Promise<Staged> => {
  const a = await answer;
  return a.ok ? { ok: true, stage: VIEWS.ImportStage(a.data) } : { ok: false, message: a.message };
};

const columns = (mapping: Readonly<Record<number, string | null>>) =>
  Object.entries(mapping).map(([column, key]) => ({ column: Number(column), key }));

/** The file is in storage: People checks it, and proposes the mapping. */
export async function completeImportUpload(uploadId: string): Promise<Staged> {
  return staged(people('CompleteImportUpload', { uploadId }));
}

export async function dryRunImport(
  uploadId: string,
  mapping: Readonly<Record<number, string | null>>,
): Promise<Staged> {
  return staged(people('DryRunImport', { uploadId, mapping: columns(mapping) }));
}

export async function commitImport(
  uploadId: string,
  mapping: Readonly<Record<number, string | null>>,
  applySensitiveWithoutApproval = false,
): Promise<Staged> {
  return staged(
    people('CommitImport', {
      uploadId,
      mapping: columns(mapping),
      ...(applySensitiveWithoutApproval ? { applySensitiveWithoutApproval: true } : {}),
    }),
  );
}

/* -------------------------------------------------------------- export -- */

export async function requestExport(choice: {
  who: string;
  fields: readonly string[];
  asOf: string;
  format: 'xlsx' | 'csv';
}): Promise<
  { ok: true; links: readonly { name: string; url: string }[] } | { ok: false; message: string }
> {
  // The links are signed and expire (PEO-089); they carry their own authority.
  const answer = await people<{ links: { name: string; url: string }[] }>('RequestExport', {
    format: choice.format,
    fields: [...choice.fields],
    asOf: choice.asOf,
  });
  return answer.ok ? { ok: true, links: answer.data.links } : { ok: false, message: answer.message };
}
