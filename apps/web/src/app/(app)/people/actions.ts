'use server';

import type { ShareChoice } from '../../../lib/export-address';
import { people, type PeopleAnswer } from '../../../lib/people';
import { VIEWS } from '../../../lib/people-views';
import { loadScreen } from '../../../lib/people-screens';
import { startViewing } from '../../../lib/view-as';
import { isWaking } from '../../../lib/waking';

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
      return [
        {
          key,
          money: { amountMinor: String(value.amountMinor), currency: String(value.currency) },
        },
      ];
    }
    // A sealed value's last four is what was shown, not something to write back.
    return [];
  });
}

/* ------------------------------------------------------------- view as -- */

/**
 * A People administrator views the app as this person, read-only, for thirty
 * minutes, saying why. People decides whether they may; the cookies are
 * swapped here (`lib/view-as.ts`), and the page then loads as them.
 */
export async function viewAs(personId: string, reason: string): Promise<Outcome> {
  return startViewing(personId, reason);
}

/* ------------------------------------------------------------- records -- */

/**
 * One person added by hand (HR only): the new record's id, for the screen to
 * move on to, or People's reason for refusing. A `hireDate` hires them from
 * it; the rest are attributes.
 */
export async function addPerson(
  person: Readonly<Record<string, string>>,
): Promise<
  | { readonly ok: true; readonly personId: string }
  | { readonly ok: false; readonly message: string }
> {
  const { hireDate = null, ...attributes } = person;
  const a = await people<{ id: string }>('CreatePerson', {
    attributes: Object.entries(attributes).map(([key, text]) => ({ key, text })),
    hireDate,
  });
  return a.ok ? { ok: true, personId: a.data.id } : { ok: false, message: a.message };
}

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
  return answer.ok
    ? { ok: true, value: answer.data.value }
    : { ok: false, message: answer.message };
}

/**
 * HR merges a duplicate into the record that survives (PEO-074): People
 * decides who may, which way, and which values may be taken.
 */
export async function mergePerson(
  survivorId: string,
  absorbedPersonId: string,
  take: readonly string[],
): Promise<Outcome> {
  return outcome(
    people('MergePerson', { personId: survivorId, absorbedPersonId, take: [...take] }),
  );
}

/**
 * HR undoes a merge, for a reason (PEO-074 follow-up): People decides what
 * goes back and what is kept because it changed since.
 */
export async function unmergePerson(absorbedPersonId: string, reason: string): Promise<Outcome> {
  return outcome(people('UnmergePerson', { personId: absorbedPersonId, reason }));
}

/** HR says two records are two people; the queue stops offering them. */
export async function dismissDuplicate(personIds: readonly [string, string]): Promise<Outcome> {
  return outcome(people('DismissDuplicate', { personIds: [...personIds] }));
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

/** Missing details' save: one change per person, each value as a form holds it. */
export async function saveGrid(changes: GridChanges): Promise<Saved> {
  return saved(people('SaveCompletenessGrid', { changes: gridChanges(changes) }));
}

/** What saving these grid cells would be warned about, before they are saved (PEO-125). */
export async function checkGrid(changes: GridChanges): Promise<Saved> {
  return saved(people('GridCheck', { changes: gridChanges(changes) }));
}

type GridChanges = readonly { readonly personId: string; readonly values: Values }[];

const gridChanges = (changes: GridChanges) =>
  changes.map((c) => ({ personId: c.personId, values: formInputs(c.values) }));

/** Missing details' next people, for its infinite list: from `after`, by keyset (PEO-122). */
export async function completenessPage(after: string): Promise<{
  readonly rows: readonly unknown[];
  readonly fields: readonly unknown[];
  readonly next: string | null;
} | null> {
  const answer = await people<{ rows?: unknown[]; fields?: unknown[]; next?: string | null }>(
    'Completeness',
    { after },
  );
  if (!answer.ok) return null;
  return {
    rows: answer.data.rows ?? [],
    fields: answer.data.fields ?? [],
    next: answer.data.next ?? null,
  };
}

/* ----------------------------------------------------------- bulk edit -- */

/** A page of a bulk edit (PEO-071): the same values for these people, from one date. */
export interface BulkEditPage {
  readonly personIds: readonly string[];
  readonly values: Values;
  readonly effectiveFrom: string;
  /** HR writes values that need approval straight through (PEO-077). */
  readonly applySensitiveWithoutApproval?: boolean;
}
export type BulkEdited =
  | { readonly ok: true; readonly committed: boolean; readonly rows: readonly unknown[] }
  | { readonly ok: false; readonly message: string };

const bulk = async (answer: Promise<PeopleAnswer<never>>): Promise<BulkEdited> => {
  const a = await answer;
  if (!a.ok) return { ok: false, message: a.message };
  const result = VIEWS.BulkEditResult(a.data) as {
    committed: boolean;
    rows: unknown[];
  };
  return { ok: true, committed: result.committed, rows: result.rows };
};
const bulkVariables = (page: BulkEditPage) => ({
  personIds: [...page.personIds],
  values: formInputs(page.values),
  effectiveFrom: page.effectiveFrom,
  ...(page.applySensitiveWithoutApproval === true ? { applySensitiveWithoutApproval: true } : {}),
});

/** What this page would change and refuse, per person; nothing is kept. */
export async function previewBulkEdit(page: BulkEditPage): Promise<BulkEdited> {
  return bulk(people('BulkEditPreview', bulkVariables(page)));
}

/** This page, written: one ordinary, effective-dated write per person. */
export async function commitBulkEdit(page: BulkEditPage): Promise<BulkEdited> {
  return bulk(people('BulkEditPeople', bulkVariables(page)));
}

/**
 * A page of a bulk hire: each person from their start date (not started yet),
 * and where to place them should they be placed nowhere that day.
 */
export type BulkHirePage = readonly {
  readonly personId: string;
  readonly hireDate: string;
  readonly legalEntityId?: string;
  readonly locationId?: string;
}[];

/** Who this page would hire and skip, and why; nothing is kept. */
export async function previewBulkHire(hires: BulkHirePage): Promise<BulkEdited> {
  return bulk(people('BulkHirePreview', { hires: [...hires] }));
}

/** This page, hired: each person on their own, the refused ones said why. */
export async function commitBulkHire(hires: BulkHirePage): Promise<BulkEdited> {
  return bulk(people('BulkHirePeople', { hires: [...hires] }));
}

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

/** A field shared with the assistant, or not: a draft change. */
export async function setFieldAssistant(field: string, share: boolean): Promise<Outcome> {
  return outcome(people('SetFieldAssistant', { field, share }));
}

/** Where to send an administrator to connect a chat app, returning to this origin. */
export async function connectChatApp(
  app: string,
  origin: string,
): Promise<
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string }
> {
  const answer = await people<string>('ConnectChatApp', { app, origin });
  return answer.ok ? { ok: true, url: answer.data } : { ok: false, message: answer.message };
}

export async function disconnectChatApp(app: string): Promise<Outcome> {
  return outcome(people('DisconnectChatApp', { app }));
}

/** One of People's notices sent to chat apps, or not. */
export async function setChatNotice(notice: string, on: boolean): Promise<Outcome> {
  return outcome(people('SetChatNotice', { notice, on }));
}

/** A field on the sign-up flow, optional or required, or off it: a draft change. */
export async function setFieldSignup(
  field: string,
  ask: 'off' | 'optional' | 'required',
): Promise<Outcome> {
  return outcome(people('SetFieldSignup', { field, ask }));
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

/** Publish a field's new type or format with HR's decision for each value that does not fit. */
export async function applyFieldChange(
  field: string,
  to: string | null,
  decisions: readonly Values[],
): Promise<Outcome> {
  return outcome(people('ApplyFieldChange', { field, input: JSON.stringify({ to, decisions }) }));
}

export async function publishDraft(requiredFrom: string): Promise<Outcome> {
  return outcome(people('PublishDraft', { requiredFrom }));
}

/* ------------------------------------ new information in an import -- */

type Mapping = Readonly<Record<number, string | null>>;
type Parsed =
  { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly message: string };

/** An answer that crosses as JSON text (docs/ai-settings.md), read back into its object. */
async function parsed(answer: Promise<PeopleAnswer<string>>): Promise<Parsed> {
  const a = await answer;
  if (!a.ok) return { ok: false, message: a.message };
  try {
    return { ok: true, data: JSON.parse(a.data) as unknown };
  } catch {
    return { ok: false, message: 'People answered in a way this page cannot read' };
  }
}

const stepOf = (uploadId: string, mapping: Mapping) => ({
  uploadId,
  mapping: Object.fromEntries(Object.entries(mapping)),
});

/** Fields proposed for the columns that match none. Nothing is written. */
export async function proposeImportFields(uploadId: string, mapping: Mapping): Promise<Parsed> {
  return parsed(
    people<string>('ProposeImportFields', { step: JSON.stringify(stepOf(uploadId, mapping)) }),
  );
}

/** Everything the import will do, from HR's choices, over a dry run. Nothing is written. */
export async function planImport(
  uploadId: string,
  mapping: Mapping,
  proposals: readonly unknown[],
  places?: Readonly<Record<string, unknown>>,
): Promise<Parsed> {
  return parsed(
    people<string>('PlanImport', {
      input: JSON.stringify({
        ...stepOf(uploadId, mapping),
        proposals,
        ...(places === undefined ? {} : { places }),
      }),
    }),
  );
}

/**
 * Approve the plan and run it, in the background: setup if nothing is
 * published, the new fields, their defaults, then the import. Answers at once
 * with the run (`runId`), which `importRun` follows. `basedOn` is the version
 * the plan was made against: published again since, People refuses it. A
 * refusal may point somewhere, as one import already running does (`link`).
 */
export async function runImport(
  uploadId: string,
  mapping: Mapping,
  proposals: readonly unknown[],
  applySensitiveWithoutApproval: boolean,
  places?: Readonly<Record<string, unknown>>,
  basedOn?: number | null,
): Promise<
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly message: string; readonly link?: string }
> {
  const answer = await people<string>('RunImport', {
    input: JSON.stringify({
      ...stepOf(uploadId, mapping),
      proposals,
      ...(applySensitiveWithoutApproval ? { applySensitiveWithoutApproval: true } : {}),
      ...(places === undefined ? {} : { places }),
      ...(basedOn === undefined ? {} : { basedOn }),
    }),
  });
  if (!answer.ok) {
    return {
      ok: false,
      message: answer.message,
      ...(answer.link === undefined ? {} : { link: answer.link }),
    };
  }
  const read = await parsed(Promise.resolve(answer));
  const runId = read.ok ? (read.data as { runId?: unknown } | null)?.runId : undefined;
  return typeof runId === 'string'
    ? { ok: true, runId }
    : { ok: false, message: 'People answered in a way this page cannot read' };
}

/**
 * An approved import as it runs, for its page to follow. `waking`: the VM is
 * still waking, so the page asks again by itself rather than saying so as an error.
 */
export async function importRun(
  id: string,
): Promise<
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly message: string; readonly waking: boolean }
> {
  const answer = await people<string>('ImportRun', { id });
  if (!answer.ok) return { ok: false, message: answer.message, waking: isWaking(answer) };
  const read = await parsed(Promise.resolve(answer));
  return read.ok ? read : { ...read, waking: false };
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

/* --------------------------------------------------------------- SCIM -- */

export type WithToken =
  { readonly ok: true; readonly token: string } | { readonly ok: false; readonly message: string };

const withToken = (answer: PeopleAnswer<{ token: string | null }>): WithToken =>
  !answer.ok
    ? { ok: false, message: answer.message }
    : answer.data.token === null
      ? { ok: false, message: 'Done, but the token was not shown. Rotate it to see a new one.' }
      : { ok: true, token: answer.data.token };

export async function createScimConnection(system: string): Promise<WithToken> {
  return withToken(await people('CreateScimConnection', { system }));
}

export async function rotateScimToken(id: string): Promise<WithToken> {
  return withToken(await people('RotateScimToken', { id }));
}

export async function revokeScimConnection(id: string): Promise<Outcome> {
  return outcome(people('RevokeScimConnection', { id }));
}

export async function setScimMapping(
  id: string,
  mapping: readonly { readonly path: string; readonly key: string }[],
): Promise<Outcome> {
  return outcome(
    people('SetScimMapping', { id, mapping: mapping.map((m) => ({ path: m.path, key: m.key })) }),
  );
}

/* --------------------------------------------------------- full values -- */

/** Finance asks for sealed fields in full, with a reason (PEO-088); HR decides. */
export async function requestFullValues(
  fields: readonly string[],
  reason: string,
): Promise<Outcome> {
  return outcome(people('RequestFullValues', { fields: [...fields], reason }));
}

/* ---------------------------------------------- approvals (PEO-077) -- */

/**
 * HR approves or rejects a change held for approval; People decides who may.
 * `soleApprover`: the requester approving their own, no other HR member being able to, having confirmed it.
 */
export async function decidePendingChange(
  id: string,
  approve: boolean,
  note: string | null,
  soleApprover = false,
): Promise<Outcome> {
  return outcome(
    people('DecidePendingChange', {
      id,
      approve,
      ...(note === null ? {} : { note }),
      ...(soleApprover ? { soleApprover } : {}),
    }),
  );
}

/**
 * The requester approves their own held change when no other HR member can,
 * having confirmed it (PEO-077); with a note when it is flagged (AI7).
 */
export async function approveAlone(id: string, note: string | null = null): Promise<Outcome> {
  return decidePendingChange(id, true, note, true);
}

/** The requester takes their change back while it waits. */
export async function withdrawPendingChange(id: string): Promise<Outcome> {
  return outcome(people('WithdrawPendingChange', { id }));
}

/* ------------------------------------ flagged approvals (AI7, AI8) -- */

/** Its flags were not worth raising: the checks learn from it. Decides nothing. */
export async function markNotUnusual(id: string): Promise<Outcome> {
  return outcome(people('MarkPendingChangeNotUnusual', { id }));
}

/** Whoever decides asks the requester first. */
export async function askAboutChange(id: string, question: string): Promise<Outcome> {
  return outcome(people('AskAboutPendingChange', { id, question }));
}

/** The requester answers, once. */
export async function answerApprovalQuestion(id: string, answer: string): Promise<Outcome> {
  return outcome(people('AnswerApprovalQuestion', { id, answer }));
}

/** A People administrator switches one of the checks. */
export async function setApprovalCheck(code: string, on: boolean): Promise<Outcome> {
  return outcome(people('SetApprovalCheck', { code, on }));
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
  photoAtSignup?: 'off' | 'optional' | 'required';
  /** The company's Inbox rules to change, by key (P2). */
  inboxRules?: Readonly<Record<string, unknown>>;
}): Promise<Outcome> {
  const { inboxRules, ...rest } = patch;
  return outcome(
    people('UpdatePeopleSettings', {
      ...given(rest),
      ...(inboxRules === undefined ? {} : { inboxRules: JSON.stringify(inboxRules) }),
    }),
  );
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

export async function createOrgUnit(input: {
  name: string;
  parentId: string | null;
}): Promise<Outcome> {
  return outcome(people('CreateOrgUnit', { ...input }));
}

/** A rename, a move (null `parentId` for the top), archiving or restoring; People decides who may. */
export async function updateOrgUnit(
  id: string,
  patch: { name?: string; parentId?: string | null; archived?: boolean },
): Promise<Outcome> {
  return outcome(people('UpdateOrgUnit', { id, ...given(patch) }));
}

export async function setNumbering(
  legalEntityId: string,
  scheme: { prefix: string; digits: number; start: number },
): Promise<Outcome> {
  return outcome(people('SetEmployeeNumbering', { legalEntityId, ...scheme }));
}

/** A pay band from a day, in minor units (PEO-078); HR or finance, as People decides. */
export async function setPayBand(band: {
  grade: string;
  currency: string;
  minimumMinor: string;
  midpointMinor: string;
  maximumMinor: string;
  effectiveFrom: string;
}): Promise<Outcome> {
  return outcome(people('SetPayBand', { ...band }));
}

/* ----------------------------------------------------------- lifecycle -- */

type LeavingReason = 'resigned' | 'dismissed' | 'end_of_contract';

/** One of a person's lifecycle moves (PEO-120), HR's, keyed per press. People decides whether it may. */
export type LifecycleMove =
  | {
      readonly kind: 'giveNotice';
      readonly lastWorkingDay: string;
      readonly reason?: LeavingReason;
    }
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
  | { readonly kind: 'rehire'; readonly startDate: string; readonly overrideReason?: string }
  | {
      readonly kind: 'hire';
      readonly hireDate: string;
      readonly legalEntityId?: string;
      readonly locationId?: string;
    };

const MOVES = {
  giveNotice: 'GiveNotice',
  withdrawNotice: 'WithdrawNotice',
  terminate: 'TerminatePerson',
  endAccess: 'EndPersonAccess',
  startLeave: 'StartLeave',
  endLeave: 'EndLeave',
  discard: 'DiscardPerson',
  rehire: 'RehirePerson',
  hire: 'HirePerson',
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

/* -------------------------------------------------------------- photos -- */

/**
 * Where to put a person's photo (no id: the viewer's own): a presigned PUT,
 * as an import's file. The browser has already shrunk it.
 */
export async function startPhotoUpload(
  personId: string | null,
  size: number,
): Promise<UploadTarget> {
  const answer = await people<{
    uploadId: string;
    url: string;
    method: string;
    headers: { name: string; value: string }[];
  }>('StartPhotoUpload', { personId, size });
  if (!answer.ok) return { ok: false, message: answer.message };
  return {
    ok: true,
    uploadId: answer.data.uploadId,
    url: answer.data.url,
    method: answer.data.method,
    headers: Object.fromEntries(answer.data.headers.map((h) => [h.name, h.value])),
  };
}

/** Where to PUT a file for an image or document field: `personId` null is one's own. */
export async function startFileUpload(
  personId: string | null,
  field: string,
  name: string,
  size: number,
): Promise<UploadTarget> {
  const answer = await people<{
    uploadId: string;
    url: string;
    method: string;
    headers: { name: string; value: string }[];
  }>('StartFileUpload', { personId, field, name, size });
  if (!answer.ok) return { ok: false, message: answer.message };
  return {
    ok: true,
    uploadId: answer.data.uploadId,
    url: answer.data.url,
    method: answer.data.method,
    headers: Object.fromEntries(answer.data.headers.map((h) => [h.name, h.value])),
  };
}

export type FileInfo = { id: string; name: string; mediaType: string; size: number };

/** The file is uploaded: People checks it and keeps it. Saving the field points the record at it. */
export async function completeFileUpload(
  personId: string | null,
  field: string,
  uploadId: string,
): Promise<{ ok: true; file: FileInfo } | { ok: false; message: string }> {
  const a = await people<FileInfo>('CompleteFileUpload', { personId, field, uploadId });
  return a.ok ? { ok: true, file: a.data } : { ok: false, message: a.message };
}

export async function completePhotoUpload(
  personId: string | null,
  uploadId: string,
): Promise<
  | { readonly ok: true; readonly avatarUrl: string | null }
  | { readonly ok: false; readonly message: string }
> {
  const a = await people<{ avatarUrl: string | null }>('CompletePhotoUpload', {
    personId,
    uploadId,
  });
  return a.ok ? { ok: true, avatarUrl: a.data.avatarUrl } : { ok: false, message: a.message };
}

/** "Remind N people": the weekly reminder now, to whoever is due one. */
export async function remindWaiting(): Promise<
  | { readonly ok: true; readonly sent: number; readonly failed: number; readonly skipped: number }
  | { readonly ok: false; readonly message: string }
> {
  const a = await people<{ sent: number; failed: number; skipped: number }>('RemindWaiting');
  return a.ok ? { ok: true, ...a.data } : { ok: false, message: a.message };
}

/** Ask somebody to fill in empty details of theirs: they are emailed, at most once a day. */
export async function requestDetails(personId: string, keys: readonly string[]): Promise<Outcome> {
  return outcome(people('RequestDetails', { personId, keys }));
}

export async function removePhoto(personId: string | null): Promise<Outcome> {
  return outcome(people('RemovePhoto', { personId }));
}

export type Staged = { ok: true; stage: unknown } | { ok: false; message: string };

const staged = async (answer: Promise<PeopleAnswer<Record<string, unknown>>>): Promise<Staged> => {
  const a = await answer;
  return a.ok ? { ok: true, stage: VIEWS.ImportStage(a.data) } : { ok: false, message: a.message };
};

/** The file is in storage: People checks it, and proposes the mapping. */
export async function completeImportUpload(uploadId: string): Promise<Staged> {
  return staged(people('CompleteImportUpload', { uploadId }));
}

/* -------------------------------------------------------------- export -- */

type Exported =
  | { ok: true; id: string; links: readonly { name: string; url: string }[] }
  | { ok: false; message: string };

// The links are signed and expire (PEO-089); they carry their own authority.
async function exported(variables: Record<string, unknown>): Promise<Exported> {
  const answer = await people<{ id: string; links: { name: string; url: string }[] }>(
    'RequestExport',
    variables,
  );
  return answer.ok
    ? { ok: true, id: answer.data.id, links: answer.data.links }
    : { ok: false, message: answer.message };
}

export async function requestExport(choice: {
  who: string;
  fields: readonly string[];
  asOf: string;
  format: 'xlsx' | 'csv' | 'pdf';
  photos?: boolean;
  reason?: string;
  /** With `who: 'conditions'`: the directory's own conditions, authorized by People as a list's. */
  conditions?: readonly { key: string; op: string; values: readonly string[] }[];
  match?: 'all' | 'any';
  /** Who, in the builder's words, for the file's provenance sheet. */
  filter?: string;
}): Promise<Exported> {
  // A saved segment is an audience (PEO-068): People applies it as this person.
  const segmentId = choice.who.startsWith('segment:') ? choice.who.slice('segment:'.length) : null;
  const conditions = choice.who === 'conditions' ? (choice.conditions ?? []) : [];
  return exported({
    format: choice.format,
    fields: [...choice.fields],
    asOf: choice.asOf,
    segmentId,
    ...(conditions.length === 0
      ? {}
      : {
          conditions: conditions.map((c) => ({ key: c.key, op: c.op, values: [...c.values] })),
          match: choice.match ?? 'all',
          ...(choice.filter === undefined ? {} : { filter: choice.filter.slice(0, 500) }),
        }),
    ...(choice.photos === true ? { includePhotos: true } : {}),
    ...(choice.reason === undefined || choice.reason === '' ? {} : { reason: choice.reason }),
  });
}

/** One person's employee record as a PDF (PEO-061): what this viewer may read of them. */
export async function exportRecord(personId: string, reason: string): Promise<Exported> {
  return exported({ format: 'pdf', recordOf: personId, ...(reason === '' ? {} : { reason }) });
}

/* ------------------------------------------------------------ segments -- */

/** Save the directory's filters as a named segment (PEO-068). */
export async function saveSegment(segment: {
  name: string;
  shared: boolean;
  filter: Readonly<Record<string, string>>;
  /** A view saved from a search: the directory's own conditions (smart search). */
  conditions?: readonly { key: string; op: string; values: readonly string[] }[];
  match?: 'all' | 'any';
}): Promise<Outcome> {
  const conditions = segment.conditions ?? [];
  return outcome(
    people('SaveSegment', {
      name: segment.name,
      shared: segment.shared,
      filter: Object.entries(segment.filter).map(([key, value]) => ({ key, value })),
      conditions:
        conditions.length === 0
          ? null
          : conditions.map((c) => ({ key: c.key, op: c.op, values: [...c.values] })),
      match: conditions.length === 0 ? null : (segment.match ?? 'all'),
    }),
  );
}

/* ---------------------------------------------------- scheduled reports -- */

/** A schedule as the screen's form holds it (PEO-069); People checks every part again. */
export interface ScheduleDraft {
  readonly name: string;
  readonly segmentId: string | null;
  /** A filter somebody saved over the API; kept as it is, not edited here. */
  readonly filter: readonly { readonly key: string; readonly value: string }[];
  readonly kind: 'export' | 'summary';
  readonly format: 'xlsx' | 'pdf';
  readonly fields: readonly string[] | null;
  readonly reason: string | null;
  readonly every: 'day' | 'week' | 'month';
  readonly weekday: number;
  readonly day: number;
  readonly hour: number;
  readonly legalEntityId: string | null;
  readonly recipients: readonly string[];
}

const scheduleVariables = (d: ScheduleDraft): Record<string, unknown> => ({
  name: d.name,
  segmentId: d.segmentId,
  filter: d.segmentId === null ? d.filter : null,
  kind: d.kind,
  format: d.kind === 'export' ? d.format : null,
  fields: d.kind === 'export' ? d.fields : null,
  reason: d.kind === 'export' ? d.reason : null,
  every: d.every,
  weekday: d.every === 'week' ? d.weekday : null,
  day: d.every === 'month' ? d.day : null,
  hour: d.hour,
  legalEntityId: d.legalEntityId,
  recipients: d.recipients,
});

export async function createReportSchedule(draft: ScheduleDraft): Promise<Outcome> {
  return outcome(people('CreateReportSchedule', scheduleVariables(draft)));
}

export async function updateReportSchedule(id: string, draft: ScheduleDraft): Promise<Outcome> {
  return outcome(people('UpdateReportSchedule', { id, ...scheduleVariables(draft) }));
}

export async function pauseReportSchedule(id: string): Promise<Outcome> {
  return outcome(people('PauseReportSchedule', { id }));
}

export async function resumeReportSchedule(id: string): Promise<Outcome> {
  return outcome(people('ResumeReportSchedule', { id }));
}

export async function deleteReportSchedule(id: string): Promise<Outcome> {
  return outcome(people('DeleteReportSchedule', { id }));
}

/* ------------------------------------------------------- what changed -- */

/** The period and segment in the address, as People reads them; absent is the default. */
export interface PeriodAsk {
  readonly period?: string;
  readonly from?: string;
  readonly to?: string;
  readonly segment?: string;
}

/**
 * The points worded by the assistant where there is one; null when People
 * could not be asked, and the screen keeps People's own words.
 */
export async function wordedWhatChanged(ask: PeriodAsk): Promise<unknown> {
  const answer = await parsed(
    people<string>('WhatChangedWorded', {
      period: ask.period ?? null,
      from: ask.from ?? null,
      to: ask.to ?? null,
      segment: ask.segment ?? null,
    }),
  );
  return answer.ok ? answer.data : null;
}

/** A follow-up question, answered from the points and nothing else. */
export async function askWhatChanged(ask: PeriodAsk, question: string): Promise<Parsed> {
  return parsed(people<string>('WhatChangedAsk', { input: JSON.stringify({ ...ask, question }) }));
}

/** The summary as it would go to somebody, rewritten for what they may see. Writes nothing. */
export async function draftSummary(input: Readonly<Record<string, unknown>>): Promise<Parsed> {
  return parsed(people<string>('SummaryDraft', { input: JSON.stringify(input) }));
}

/** Send the summary as previewed and edited: stored for its recipient, and an email with a link. */
export async function shareSummary(input: Readonly<Record<string, unknown>>): Promise<Parsed> {
  return parsed(people<string>('ShareSummary', { input: JSON.stringify(input) }));
}

/** The screens whose lists load as they scroll, and the name their read gives its cursor. */
const PAGED = {
  WebhookLog: 'after',
  RoleSettings: 'after',
  ReportRuns: 'before',
} as const;

/**
 * The next page of a screen's list, for its infinite scroll: the screen's own
 * read (`loadScreen`), as the page was drawn, from the cursor its last page
 * gave. Its data as the screen's first page had it, or null when People did
 * not answer. Only the screens above: anything else is not a list.
 */
export async function screenPage(
  component: keyof typeof PAGED,
  params: Readonly<Record<string, string>>,
  search: Readonly<Record<string, string>>,
  cursor: string,
): Promise<unknown> {
  const key = PAGED[component] as string | undefined;
  if (key === undefined) return null;
  const load = await loadScreen(component, { params, search: { ...search, [key]: cursor } });
  return load.status === 'ready' ? load.data : null;
}

/** Review's Decided after `after` (the last page's `decidedNext`), as it scrolls: HR's, the page alone. */
export async function decidedPage(after: string): Promise<unknown> {
  const answer = await people<never>('Approvals', { decidedAfter: after });
  return answer.ok ? VIEWS.Approvals(answer.data) : null;
}

/** One of Review's decision queues, by the chip that names it; `flagged`, the Flagged tab's changes. */
export type QueueKind = 'changes' | 'flagged' | 'ids' | 'duplicates' | 'access' | 'exports';

/**
 * A page of one of Review's decision queues after `after` (the last page's
 * place), newest first, as the list scrolls: its items as the screen reads
 * them, and the next page's place.
 */
export async function queuePage(
  kind: QueueKind,
  after: string,
): Promise<{ readonly items: readonly unknown[]; readonly next: string | null } | null> {
  switch (kind) {
    case 'changes':
    case 'flagged': {
      const answer = await people<never>(
        'Approvals',
        kind === 'flagged' ? { after, flagged: true } : { after },
      );
      if (!answer.ok) return null;
      const view = VIEWS.Approvals(answer.data) as { items: unknown[]; itemsNext?: string | null };
      return { items: view.items, next: view.itemsNext ?? null };
    }
    case 'ids': {
      const answer = await people<{ items: unknown[]; next?: string | null }>('IdentifierReviews', {
        after,
      });
      return answer.ok ? { items: answer.data.items, next: answer.data.next ?? null } : null;
    }
    case 'duplicates': {
      const answer = await people<{ items: unknown[]; next?: string | null }>('Duplicates', {
        after,
      });
      return answer.ok ? { items: answer.data.items, next: answer.data.next ?? null } : null;
    }
    case 'access': {
      const answer = await people<{ requests: unknown[]; next?: string | null }>('FullValues', {
        before: after,
      });
      return answer.ok ? { items: answer.data.requests, next: answer.data.next ?? null } : null;
    }
    case 'exports': {
      const answer = await people<string>('ExportSharesWaiting', { after });
      if (!answer.ok) return null;
      const page = JSON.parse(answer.data) as { items?: unknown[]; next?: string | null } | null;
      return { items: page?.items ?? [], next: page?.next ?? null };
    }
  }
}

/** Review's merged records after `after` (the last page's `mergesNext`), as they scroll. */
export async function mergesPage(after: string): Promise<unknown> {
  const answer = await people<unknown>('Duplicates', { mergesAfter: after });
  return answer.ok ? answer.data : null;
}

/** Import & export's history before `before` (the last entry's cursor), as it scrolls. */
export async function transferHistoryPage(before: string): Promise<unknown> {
  const answer = await people<unknown>('TransferHistory', { before });
  return answer.ok ? answer.data : null;
}

/**
 * The directory's next page, for its infinite scroll: the same query the page
 * was drawn with (search, filters, conditions, order), from `after`.
 */
export async function directoryPage(
  search: Readonly<Record<string, string>>,
  after: string,
): Promise<{ readonly people: readonly unknown[]; readonly next: string | null } | null> {
  const load = await loadScreen('Directory', { params: {}, search: { ...search, after } });
  if (load.status !== 'ready') return null;
  const data = load.data as { people?: readonly unknown[]; next?: string | null };
  return { people: data.people ?? [], next: data.next ?? null };
}

/* ------------------------------------------ search and export in words -- */

/**
 * What was typed in the directory, as its own filters and order, with the
 * readings this person chose before (docs/ai-settings.md, smart search). A read.
 */
export async function planDirectory(
  sentence: string,
  remembered: Readonly<Record<string, string>> = {},
): Promise<Parsed> {
  return parsed(
    people<string>('DirectoryPlan', {
      sentence,
      remembered: Object.keys(remembered).length === 0 ? null : JSON.stringify(remembered),
    }),
  );
}

/** Smart search's "Remind all": everybody the conditions find is asked for what they find empty. */
export async function remindDirectory(
  conditions: readonly { key: string; op: string; values: readonly string[] }[],
  match: 'all' | 'any',
  search: string | null,
): Promise<
  | {
      readonly ok: true;
      readonly asked: number;
      readonly emailed: number;
      readonly skipped: number;
      readonly more: boolean;
    }
  | { readonly ok: false; readonly message: string }
> {
  const answer = await parsed(
    people<string>('RemindDirectory', {
      conditions: JSON.stringify(conditions),
      match,
      search,
    }),
  );
  if (!answer.ok) return answer;
  const sent = answer.data as { asked: number; emailed: number; skipped: number; more: boolean };
  return { ok: true, ...sent };
}

/** An export described in words, as the builder's choices and a drafted reason. Nothing is exported. */
export async function planExport(sentence: string): Promise<Parsed> {
  return parsed(people<string>('ExportPlan', { sentence }));
}

/* ------------------------------------------- an export sent to somebody -- */

/**
 * Send an export (design AI13): at once when the recipient could read all of
 * it themselves, otherwise as a request a People administrator approves.
 * Answers `{ status: 'sent', exportId }` or the request waiting.
 */
export async function shareExport(choice: ShareChoice, recipient: string): Promise<Parsed> {
  return parsed(people<string>('ShareExport', { input: JSON.stringify({ choice, recipient }) }));
}

/** Approve or reject sending one; approved, People builds and sends it. */
export async function decideExportShare(
  id: string,
  approve: boolean,
  note: string | null,
): Promise<Parsed> {
  return parsed(people<string>('DecideExportShare', { id, approve, note }));
}
