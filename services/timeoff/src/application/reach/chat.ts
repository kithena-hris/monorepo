import { createHmac, timingSafeEqual } from 'node:crypto';

import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { PersonId, TenantId, type CalendarDate, type Instant } from '@kithena/contracts';

import { LeaveRequestId } from '../../domain/request/leave-request.js';
import { decideRequest } from '../approval/decide.js';
import type { ChatPort, ChatProvider, Deps, Integration, Tx } from '../ports.js';
import { transact } from '../shared.js';
import { startOfDay } from '../zone.js';
import type { Delivery } from './calendar.js';

/**
 * Time off in the chat app (PRD §5.3, TOF-111): a member's status while they
 * are away, and an approver asked in a direct message with Approve and
 * Decline — the decision made by pressing one, as the approver, through the
 * same use case and the same rules as the screen.
 *
 * Named for what it is; Slack is the first adapter and Microsoft Teams can
 * follow behind the same `ChatPort`.
 *
 * Each button carries a value Time Off signs — the tenant, the request, the
 * approver it was sent to, approve or decline, and an expiry — so a press
 * proves twice over where it came from: the provider's signature on the
 * request (checked by the adapter), and Time Off's on the value. Whether the
 * approver may still decide is `decideRequest`'s question, as always.
 */

type ChatDeps = Pick<
  Deps,
  'uow' | 'authz' | 'clock' | 'newId' | 'timers' | 'notifier' | 'feedSecret' | 'reach'
>;

/** A message's buttons last two weeks; a request still waiting by then has been escalated. */
const ACTION_DAYS = 14;
const AWAY = 'Out of office';

async function connected(
  tx: Tx,
  deps: Pick<Deps, 'reach'>,
): Promise<{ port: ChatPort; integration: Integration }[]> {
  const out = [];
  for (const port of deps.reach?.chats ?? []) {
    if (!port.configured) continue;
    const integration = await tx.integrations.get(port.provider);
    if (integration !== null) out.push({ port, integration });
  }
  return out;
}

const day = (date: CalendarDate, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

/** "19–23 Oct", "30 Oct – 2 Nov", "19 Oct". */
export function spanWords(from: CalendarDate, to: CalendarDate): string {
  if (from === to) return day(from, { day: 'numeric', month: 'short' });
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${day(from, { day: 'numeric' })}–${day(to, { day: 'numeric', month: 'short' })}`;
  }
  return `${day(from, { day: 'numeric', month: 'short' })} – ${day(to, { day: 'numeric', month: 'short' })}`;
}

/* ---------------------------------------------------------------- values -- */

interface ActionClaims {
  readonly t: string;
  readonly r: string;
  readonly p: string;
  readonly a: string;
  readonly d: 'approve' | 'decline';
  readonly e: string;
}

const PREFIX = 'ca_';
const signAction = (secret: string, body: string) =>
  createHmac('sha256', secret).update(`chat-action:${body}`).digest('base64url');

function actionValue(secret: string, claims: ActionClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${PREFIX}${body}.${signAction(secret, body)}`;
}

function claimsOf(secret: string, value: string): ActionClaims | null {
  if (!value.startsWith(PREFIX)) return null;
  const [body, signature] = value.slice(PREFIX.length).split('.');
  if (body === undefined || signature === undefined) return null;
  const expected = Buffer.from(signAction(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ActionClaims;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- approvals -- */

/**
 * A request just sent, in its approver's direct messages. The approver is
 * the manager at a manager step, or whoever it was escalated to; an HR step
 * is HR's queue, where nobody in particular is asked.
 */
export const askApproverInChat =
  (deps: Pick<Deps, 'uow' | 'clock' | 'feedSecret' | 'reach'>) =>
  async (tenantId: TenantId, requestId: LeaveRequestId): Promise<Result<Delivery>> => {
    const read = await transact(deps, tenantId, async (tx) => {
      const targets = await connected(tx, deps);
      const record = targets.length === 0 ? null : await tx.requests.get(requestId);
      if (record === null || record.request.status !== 'pending') return ok(null);
      const member = await tx.members.get(record.request.personId);
      const role = record.routing.chain[record.routing.step];
      const approverId =
        record.routing.escalatedTo !== null && record.routing.escalatedTo !== 'hr'
          ? record.routing.escalatedTo
          : role === 'manager'
            ? (member?.managerPersonId ?? null)
            : null;
      const approver = approverId === null ? null : await tx.members.get(approverId);
      const type = await tx.leaveTypes.get(record.request.leaveType.key);
      return ok({ targets, record, member, approver, typeName: type?.definition.name.default });
    });
    if (!read.ok) return read;
    const found = read.value;
    if (
      found === null ||
      found.member === null ||
      found.approver === null ||
      found.approver.workEmail === null ||
      found.approver.accountId === null
    ) {
      return ok({ sent: 0, failed: [] });
    }
    const { targets, record, member, approver } = found;
    const { from } = record.request.span;
    const to = record.request.spans.at(-1)?.to ?? record.request.span.to;
    const expires = new Date(
      Date.parse(deps.clock.instant()) + ACTION_DAYS * 86_400_000,
    ).toISOString();
    const value = (d: ActionClaims['d']) =>
      actionValue(deps.feedSecret, {
        t: tenantId,
        r: requestId,
        p: approver.personId,
        a: approver.accountId ?? '',
        d,
        e: expires,
      });
    let sent = 0;
    const failed: { provider: string; message: string }[] = [];
    for (const { port, integration } of targets) {
      try {
        await port.askApproval(integration, {
          tenantId,
          email: approver.workEmail ?? '',
          text: `${member.displayName} asks for ${found.typeName ?? 'time off'}, ${spanWords(from, to)}.`,
          approve: value('approve'),
          decline: value('decline'),
        });
        sent++;
      } catch (error) {
        failed.push({
          provider: port.provider,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return ok({ sent, failed });
  };

const invalidAction = (): Result<never> =>
  err(failure('INVALID_ACTION', 'This press did not come from a message Time Off sent'));

/**
 * A press on Approve or Decline, on Time Off's public route: verified by the
 * provider's adapter and by Time Off's signature, then decided as the
 * approver the message was sent to. The answer is what the conversation is
 * told; a refusal (the request was decided already, the approver no longer
 * may) is said there too rather than failing the press.
 */
export const approveFromChat =
  (deps: ChatDeps) =>
  async (
    provider: ChatProvider,
    request: {
      readonly headers: Readonly<Record<string, string | string[] | undefined>>;
      readonly body: string;
    },
  ): Promise<Result<{ text: string }>> => {
    const port = deps.reach?.chats.find((p) => p.provider === provider);
    const press = port?.configured === true ? port.action(request) : null;
    const claims = press === null ? null : claimsOf(deps.feedSecret, press.value);
    const tenant = TenantId.safeParse(claims?.t);
    const person = PersonId.safeParse(claims?.p);
    const requestId = LeaveRequestId.safeParse(claims?.r);
    if (
      press === null ||
      claims === null ||
      !tenant.success ||
      !person.success ||
      !requestId.success ||
      Date.parse(claims.e) < Date.parse(deps.clock.instant())
    ) {
      return invalidAction();
    }
    const decided = await decideRequest(deps)(
      {
        tenantId: tenant.data,
        accountId: claims.a,
        personId: person.data,
        correlationId: deps.newId(),
      },
      { requestId: requestId.data, decision: claims.d },
    );
    const about = await transact(deps, tenant.data, async (tx) => {
      const record = await tx.requests.get(requestId.data);
      const member = record === null ? null : await tx.members.get(record.request.personId);
      return ok(
        record === null || member === null
          ? ''
          : `${member.displayName}, ${spanWords(
              record.request.span.from,
              record.request.spans.at(-1)?.to ?? record.request.span.to,
            )}`,
      );
    });
    const what = about.ok ? about.value : '';
    const text = decided.ok
      ? `${claims.d === 'approve' ? 'Approved' : 'Declined'}: ${what}.`
      : `Not done: ${decided.error.message}`;
    await press.reply(text).catch(() => undefined);
    return ok({ text });
  };

/* ---------------------------------------------------------------- status -- */

/**
 * Everybody away today, with their chat app's status saying so until their
 * last day ends — for those who connected their own account, because a
 * status is the person's to set. Daily; setting a status twice changes
 * nothing.
 */
export const chatStatuses =
  (deps: Pick<Deps, 'uow' | 'clock' | 'reach'>) =>
  async (tenantId: TenantId): Promise<Result<Delivery>> => {
    const read = await transact(deps, tenantId, async (tx) => {
      const targets = await connected(tx, deps);
      if (targets.length === 0) return ok({ targets, away: [] });
      const away: { secrets: Map<ChatProvider, string>; until: Instant }[] = [];
      for (const member of await tx.members.list()) {
        if (member.status === 'left') continue;
        const today = deps.clock.date(member.timeZone);
        const records = await tx.requests.list({
          personIds: [member.personId],
          statuses: ['approved', 'taken', 'change_pending'],
          from: today,
          to: today,
        });
        const span = records
          .flatMap((r) => r.request.spans)
          .find((s) => s.from <= today && today <= s.to);
        if (span === undefined) continue;
        const secrets = new Map<ChatProvider, string>();
        for (const { port } of targets) {
          const secret = await tx.integrations.memberSecret(port.provider, member.personId);
          if (secret !== null) secrets.set(port.provider, secret);
        }
        if (secrets.size === 0) continue;
        const next = new Date(Date.parse(`${span.to}T00:00:00Z`) + 86_400_000)
          .toISOString()
          .slice(0, 10) as CalendarDate;
        away.push({ secrets, until: startOfDay(next, member.timeZone).toISOString() as Instant });
      }
      return ok({ targets, away });
    });
    if (!read.ok) return read;
    let sent = 0;
    const failed: { provider: string; message: string }[] = [];
    for (const { secrets, until } of read.value.away) {
      for (const { port, integration } of read.value.targets) {
        const secret = secrets.get(port.provider);
        if (secret === undefined) continue;
        try {
          await port.setStatus(integration, secret, { text: AWAY, until });
          sent++;
        } catch (error) {
          failed.push({
            provider: port.provider,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return ok({ sent, failed });
  };
