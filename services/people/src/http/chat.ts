import { randomUUID } from 'node:crypto';
import * as z from 'zod';

import type { FormValue } from '../application/screens/model.js';
import type { RestRequest, RestResponse } from './rest.js';

/**
 * What a chat tool (Slack) may do in People, as the person who pressed the
 * button: read what waits for their approval and decide it, and read and fill
 * in the details they were asked for.
 *
 * Nothing here decides who may do what. Each action is the app's own REST
 * route, called as the person whose verified email the chat tool vouches for,
 * so an approval in Slack is checked exactly as one in the inbox is, and a
 * detail filled in a Slack form is saved as the person's own edit. Only the
 * routes listed here are reachable, and only by the Slack service, which
 * presents a token of its own.
 *
 * The functions below are the shapes a chat message can carry: short, plain
 * and never more than the person could read in the app.
 */

/** The types a chat form can take a value for. The rest are filled in the app. */
const FILLABLE = new Set([
  'text',
  'long_text',
  'number',
  'decimal',
  'percentage',
  'boolean',
  'date',
  'select',
  'multi_select',
  'email',
  'phone',
  'url',
  'national_id',
]);

export interface ChatField {
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly dataType: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly required: boolean;
  /** Somebody asked the person for it. */
  readonly requested: boolean;
  /** What it holds now, as text: empty for a missing one. */
  readonly value: string | readonly string[] | null;
}

export interface ChatForm {
  readonly fields: readonly ChatField[];
  /** Missing or asked for, and only fillable in the app (a file, an address). */
  readonly elsewhere: readonly string[];
}

interface ProfileLike {
  readonly sections: readonly {
    readonly fields: readonly {
      readonly key: string;
      readonly label: string;
      readonly description: string | null;
      readonly dataType: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
      readonly required: boolean;
      readonly missing: boolean;
      readonly readOnly: boolean;
    }[];
  }[];
  readonly values: Readonly<Record<string, FormValue>>;
  readonly requests: readonly { readonly key: string }[];
}

/**
 * The person's own details still to give: the ones asked for, then the
 * missing ones. A value already there is shown only on a field marked for the
 * assistant (`shown`): what a chat app's servers receive is what the company
 * chose to share with it.
 */
export function chatForm(
  profile: ProfileLike,
  shown: ReadonlySet<string> = new Set(),
): ChatForm {
  const asked = new Set(profile.requests.map((r) => r.key));
  const fields: ChatField[] = [];
  const elsewhere: string[] = [];
  for (const section of profile.sections) {
    for (const f of section.fields) {
      if (f.readOnly || !(f.missing || asked.has(f.key))) continue;
      if (!FILLABLE.has(f.dataType)) {
        elsewhere.push(f.label);
        continue;
      }
      const v = shown.has(f.key) ? profile.values[f.key] : null;
      fields.push({
        key: f.key,
        label: f.label,
        description: f.description,
        dataType: f.dataType,
        options: f.options,
        required: f.required,
        requested: asked.has(f.key),
        value: typeof v === 'string' ? v : Array.isArray(v) ? (v as readonly string[]) : null,
      });
    }
  }
  fields.sort((a, b) => Number(b.requested) - Number(a.requested));
  return { fields, elsewhere };
}

/** A form's answers, as the profile's save takes them. Unknown keys are dropped. */
export function changedOf(
  form: ChatForm,
  values: Readonly<Record<string, string | readonly string[] | null>>,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const f of form.fields) {
    const v = values[f.key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (f.dataType === 'boolean') changed[f.key] = v === 'true';
    else if (f.dataType === 'multi_select') changed[f.key] = Array.isArray(v) ? v : [v];
    else changed[f.key] = Array.isArray(v) ? v.join(', ') : v;
  }
  return changed;
}

const isList = (v: unknown): v is readonly string[] => Array.isArray(v);

/** A value as a sentence can say it. */
export function spoken(value: FormValue): string {
  if (value === null || value === '') return 'nothing';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (isList(value)) return value.join(', ');
  if ('last4' in value) return value.last4 === null ? 'a hidden value' : `ending ${value.last4}`;
  const minor = value.amountMinor.replace('-', '').padStart(3, '0');
  const sign = value.amountMinor.startsWith('-') ? '-' : '';
  return `${sign}${minor.slice(0, -2)}.${minor.slice(-2)} ${value.currency}`;
}

export interface ChatApproval {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly requestedBy: string;
  readonly reason: string | null;
  readonly effectiveFrom: string;
}

interface ApprovalsLike {
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    readonly key: string;
    readonly label: string;
    readonly value: FormValue;
    readonly current: FormValue;
    readonly readable: boolean;
    readonly requestedBy: string;
    readonly reason: string | null;
    readonly effectiveFrom: string;
    readonly canDecide: boolean;
    readonly awaitingReview: boolean;
  }[];
}

const WITHHELD = 'a value you can see in Kithena';

/**
 * What waits for this person's decision, and nothing they could not decide in
 * the inbox. A value is shown only on a field marked for the assistant.
 */
export function chatApprovals(
  view: ApprovalsLike,
  shown: ReadonlySet<string> = new Set(),
): readonly ChatApproval[] {
  return view.items
    .filter((i) => i.canDecide && !i.awaitingReview)
    .map((i) => ({
      id: i.id,
      name: i.name,
      label: i.label,
      from: !i.readable ? 'a value you cannot see' : shown.has(i.key) ? spoken(i.current) : WITHHELD,
      to: !i.readable ? 'a value you cannot see' : shown.has(i.key) ? spoken(i.value) : WITHHELD,
      requestedBy: i.requestedBy,
      reason: i.reason,
      effectiveFrom: i.effectiveFrom,
    }));
}

/* --------------------------------------------------------------- route -- */

const Who = z.object({ tenantId: z.uuid(), email: z.email().max(320) });
const Action = z.discriminatedUnion('action', [
  Who.extend({ action: z.literal('approvals') }),
  Who.extend({
    action: z.literal('decide'),
    id: z.uuid(),
    approve: z.boolean(),
  }),
  Who.extend({ action: z.literal('form') }),
  Who.extend({
    action: z.literal('fill'),
    values: z.record(
      z.string().max(64),
      z.union([z.string().max(2000), z.array(z.string().max(200)).max(100), z.null()]),
    ),
  }),
]);
export type ChatAction = z.infer<typeof Action>;
export const parseChatAction = (value: unknown): z.ZodSafeParseResult<ChatAction> =>
  Action.safeParse(value);

export interface ChatActDeps {
  /** The router's token: what makes a forwarded principal believed. */
  readonly apiToken: string;
  readonly accountOf: (tenantId: string, email: string) => Promise<string | null>;
  readonly rest: (request: RestRequest) => Promise<RestResponse | null>;
  /** The fields marked for the assistant: the only values a chat message carries. */
  readonly shown: (tenantId: string) => Promise<ReadonlySet<string>>;
}

export type ChatOutcome =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly message: string; readonly field?: string };

const NOT_FOUND: ChatOutcome = {
  ok: false,
  message: 'I could not find you in Kithena. Ask your HR team to check that your Slack email is your work email there.',
};

/** Run one chat action as the person whose email it carries. */
export async function chatAct(deps: ChatActDeps, action: ChatAction): Promise<ChatOutcome> {
  const accountId = await deps.accountOf(action.tenantId, action.email.trim().toLowerCase());
  if (accountId === null) return NOT_FOUND;
  const as = (method: string, url: string, body?: unknown, key?: string) =>
    deps.rest({
      method,
      url,
      headers: {
        'x-internal-token': deps.apiToken,
        'x-kithena-principal': JSON.stringify({
          userId: accountId,
          tenantId: action.tenantId,
          roles: [],
          entitlements: ['module.people'],
        }),
        ...(key === undefined ? {} : { 'idempotency-key': key }),
      },
      body: body === undefined ? '' : JSON.stringify(body),
    });
  const outcome = (answer: RestResponse | null, then: (body: unknown) => unknown): ChatOutcome => {
    if (answer === null) return { ok: false, message: 'Kithena could not do that just now.' };
    if (answer.status < 300) return { ok: true, body: then(answer.body) };
    const error = (answer.body as { error?: { message?: string; path?: readonly string[] } }).error;
    const field = error?.path?.[0];
    return {
      ok: false,
      message: error?.message ?? 'Kithena could not do that just now.',
      ...(field === undefined ? {} : { field }),
    };
  };

  const shown = await deps.shown(action.tenantId);
  switch (action.action) {
    case 'approvals':
      return outcome(await as('GET', '/v1/views/approvals'), (b) => ({
        items: chatApprovals(b as ApprovalsLike, shown),
      }));
    case 'decide':
      return outcome(
        await as(
          'POST',
          `/v1/pending-changes/${action.id}/decision`,
          { approve: action.approve },
          `chat:${action.id}:${String(action.approve)}`,
        ),
        () => ({ decided: action.approve ? 'approved' : 'rejected' }),
      );
    case 'form':
      return outcome(await as('GET', '/v1/views/profile'), (b) => chatForm(b as ProfileLike, shown));
    case 'fill': {
      const read = await as('GET', '/v1/views/profile');
      if (read === null || read.status >= 300) return outcome(read, () => null);
      const changed = changedOf(chatForm(read.body as ProfileLike), action.values);
      if (Object.keys(changed).length === 0) return { ok: true, body: { saved: 0 } };
      return outcome(
        await as('POST', '/v1/views/me/sections', { changed }, `chat:${randomUUID()}`),
        () => ({ saved: Object.keys(changed).length }),
      );
    }
  }
}
