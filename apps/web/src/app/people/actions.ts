'use server';

import { randomUUID } from 'node:crypto';

import { people } from '../../lib/people';

/**
 * What the People screens' buttons do: server actions, each one request to
 * People as the person signed in (PEO-098).
 *
 * One action per thing a screen can ask for, each with its path fixed here.
 * The browser chooses the arguments and never the endpoint, and every
 * argument is validated again by People, which also decides whether this
 * person may do it at all. Nothing here authorizes anything.
 */

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

const outcome = async (answer: Promise<{ ok: boolean; message?: string }>): Promise<Outcome> => {
  const a = await answer;
  return a.ok ? { ok: true } : { ok: false, message: a.message ?? 'That did not go through' };
};

type Values = Readonly<Record<string, unknown>>;

/* ------------------------------------------------------------- records -- */

export async function saveOwnSection(sectionKey: string, changed: Values): Promise<Outcome> {
  void sectionKey;
  return outcome(people('POST', '/v1/views/me/sections', { changed }));
}

export async function savePersonSection(
  personId: string,
  sectionKey: string,
  changed: Values,
): Promise<Outcome> {
  void sectionKey;
  return outcome(
    people('POST', `/v1/views/people/${encodeURIComponent(personId)}/sections`, { changed }),
  );
}

export async function saveGrid(
  changes: readonly {
    readonly personId: string;
    readonly values: Readonly<Record<string, string>>;
  }[],
): Promise<Outcome> {
  return outcome(people('POST', '/v1/views/completeness', { changes }));
}

/* --------------------------------------------------------------- setup -- */

export async function confirmEntity(entity: { name: string; country: string }): Promise<Outcome> {
  return outcome(people('POST', '/v1/views/setup/entity', entity));
}

export async function publishSetup(pack: {
  country: string;
  sections: readonly string[];
}): Promise<Outcome> {
  return outcome(people('POST', '/v1/views/setup/publish', pack));
}

/* ------------------------------------------------------------ registry -- */

export async function reorderSections(order: readonly string[]): Promise<Outcome> {
  return outcome(people('PUT', '/v1/schema/draft/sections/order', { order }));
}

export async function reorderFields(
  sectionKey: string,
  order: readonly string[],
): Promise<Outcome> {
  return outcome(
    people('PUT', `/v1/schema/draft/sections/${encodeURIComponent(sectionKey)}/order`, { order }),
  );
}

export async function addSection(label: string): Promise<Outcome> {
  return outcome(people('POST', '/v1/schema/draft/sections', { label }));
}

export async function saveField(input: Values, editing: string | null): Promise<Outcome> {
  return outcome(people('POST', '/v1/schema/draft/attributes', { input, editing }));
}

export async function advise(field: Values): Promise<unknown> {
  const answer = await people<unknown>('POST', '/v1/schema/draft/advice', field);
  // No judgment is a judgment the editor already draws: the section's default.
  return answer.ok
    ? answer.data
    : { kind: 'fallback', classification: 'confidential', piiKind: 'none', floor: 'internal' };
}

export async function previewPublish(requiredFrom: string): Promise<unknown> {
  const answer = await people<unknown>('POST', '/v1/schema/draft/preview', { requiredFrom });
  if (!answer.ok) throw new Error(answer.message);
  return answer.data;
}

export async function publishDraft(requiredFrom: string): Promise<Outcome> {
  return outcome(people('POST', '/v1/schema/draft/publish', { requiredFrom }));
}

/* -------------------------------------------------------- integrations -- */

export type WithSecret =
  { readonly ok: true; readonly secret: string } | { readonly ok: false; readonly message: string };

export async function createEndpoint(input: {
  url: string;
  events: readonly string[];
  allowlist: readonly string[];
  alertEmail: string;
}): Promise<WithSecret> {
  const answer = await people<{ secret: string }>('POST', '/v1/webhooks/endpoints', input);
  return answer.ok
    ? { ok: true, secret: answer.data.secret }
    : { ok: false, message: answer.message };
}

export async function updateEndpoint(id: string, patch: Values): Promise<Outcome> {
  return outcome(people('PATCH', `/v1/webhooks/endpoints/${encodeURIComponent(id)}`, patch));
}

export async function rotateEndpoint(id: string): Promise<WithSecret> {
  const answer = await people<{ secret: string }>(
    'POST',
    `/v1/webhooks/endpoints/${encodeURIComponent(id)}/rotate`,
    {},
  );
  return answer.ok
    ? { ok: true, secret: answer.data.secret }
    : { ok: false, message: answer.message };
}

/* -------------------------------------------------------------- import -- */

/** The file travels with every step: People keeps nothing between them (§14.2). */
export type Staged = { ok: true; stage: unknown } | { ok: false; message: string };

async function upload(path: string, form: FormData): Promise<Staged> {
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, message: 'Choose a file' };
  const mapping = form.get('mapping');
  const answer = await people<unknown>('POST', path, {
    name: file.name,
    file: Buffer.from(await file.arrayBuffer()).toString('base64'),
    ...(typeof mapping === 'string' ? { mapping: JSON.parse(mapping) as unknown } : {}),
  });
  return answer.ok ? { ok: true, stage: answer.data } : { ok: false, message: answer.message };
}

export async function proposeImport(form: FormData): Promise<Staged> {
  return upload('/v1/imports/proposal', form);
}

export async function dryRunImport(form: FormData): Promise<Staged> {
  return upload('/v1/imports/dry-run', form);
}

export async function commitImport(form: FormData): Promise<Staged> {
  return upload('/v1/imports', form);
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
  const answer = await people<{ links?: { name: string; url: string }[] }>(
    'POST',
    '/v1/exports',
    { format: choice.format, fields: choice.fields, asOf: choice.asOf },
    { 'idempotency-key': randomUUID() },
  );
  return answer.ok
    ? { ok: true, links: answer.data.links ?? [] }
    : { ok: false, message: answer.message };
}
