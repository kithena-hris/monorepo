import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import manifest from '../../module.manifest.js';
import {
  afterSend,
  liveVersions,
  ready,
  rotated,
  subscribes,
  type WebhookEndpoint,
} from '../domain/webhook.js';
import { adminOnly, audit, notFound, type Ctx } from './context.js';
import type { Deps } from './ports.js';

/**
 * Signed webhooks for every event Performance publishes (PRF-058, PRD §31):
 * an administrator adds an endpoint, chooses its events, and is shown its
 * secret once; deliveries are signed as People's are and sent in the order
 * the events were written, by a sweep every 30 seconds.
 */

/** Before any event: an endpoint takes what is written after it was added. */
const ZERO = '00000000-0000-0000-0000-000000000000';
const MAX_ENDPOINTS = 10;
/** Events per endpoint per sweep: a backlog drains over a few minutes, not in one go. */
const BATCH = 50;

const unavailable = failure(
  'UNAVAILABLE',
  'Webhooks are not set up here yet: PERFORMANCE_WEBHOOK_KEY is missing',
);

const view = (e: WebhookEndpoint) => ({
  id: e.id,
  url: e.url,
  events: e.events,
  createdAt: e.createdAt,
  disabled: e.disabled,
  failing: e.failing,
  last: e.last,
  rotatedUntil: e.previous?.until ?? null,
});

/** S8b: the endpoints, what each takes and how its deliveries are going. */
export async function webhooksScreen(ctx: Ctx): Promise<Result<unknown>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  return ok({
    available: ctx.deps.webhooks !== undefined,
    events: manifest.publishes,
    rows: (await ctx.tx.webhooks.find()).map(view),
  });
}

const secretOf = (ctx: Ctx, e: WebhookEndpoint): string =>
  ctx.deps.webhooks?.secret(ctx.caller.tenantId, e.id, e.version) ?? '';

function eventsOf(events: readonly string[]): Result<readonly string[]> {
  if (events.includes('*')) return ok(['*']);
  const unknown = events.filter((e) => !manifest.publishes.includes(e));
  if (unknown.length > 0) return err(failure('BAD_REQUEST', `No event ${unknown.join(', ')}`));
  if (events.length === 0) return err(failure('BAD_REQUEST', 'Choose at least one event'));
  return ok([...new Set(events)]);
}

/** A new endpoint, and its secret, shown this once. */
export async function addWebhook(
  ctx: Ctx,
  input: { readonly url: string; readonly events: readonly string[] },
): Promise<Result<{ id: string; secret: string }>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const hooks = ctx.deps.webhooks;
  if (hooks === undefined) return err(unavailable);
  if ((await ctx.tx.webhooks.find()).length >= MAX_ENDPOINTS)
    return err(failure('LIMIT', `A company has at most ${String(MAX_ENDPOINTS)} endpoints`));
  const vetted = await hooks.vet(input.url);
  if (!vetted.ok) return vetted;
  const events = eventsOf(input.events);
  if (!events.ok) return events;
  const e: WebhookEndpoint = {
    id: ctx.deps.newId(),
    url: input.url,
    events: events.value,
    version: 1,
    previous: null,
    createdAt: ctx.at,
    disabled: null,
    cursor: { at: ctx.at, id: ZERO },
    failing: null,
    last: null,
  };
  await ctx.tx.webhooks.save(e);
  await audit(ctx, {
    kind: 'webhook',
    action: 'Added a webhook endpoint',
    target: new URL(e.url).host,
    targetId: e.id,
    fields: ['url', 'events'],
    area: 'integrations',
  });
  return ok({ id: e.id, secret: secretOf(ctx, e) });
}

/** Its events, or turned on or off; on again starts from where it stopped. */
export async function changeWebhook(
  ctx: Ctx,
  id: string,
  input: { readonly events?: readonly string[] | undefined; readonly on?: boolean | undefined },
): Promise<Result<{ ok: true }>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const e = await ctx.tx.webhooks.get(id);
  if (e === null) return err(notFound('webhook endpoint'));
  let next = e;
  if (input.events !== undefined) {
    const events = eventsOf(input.events);
    if (!events.ok) return events;
    next = { ...next, events: events.value };
  }
  if (input.on !== undefined)
    next = input.on
      ? { ...next, disabled: null, failing: null }
      : { ...next, disabled: { at: ctx.at, why: 'Turned off by an administrator' } };
  await ctx.tx.webhooks.save(next);
  await audit(ctx, {
    kind: 'webhook',
    action:
      input.on === undefined
        ? 'Changed a webhook endpoint'
        : input.on
          ? 'Turned on a webhook endpoint'
          : 'Turned off a webhook endpoint',
    target: new URL(e.url).host,
    targetId: id,
    fields: Object.keys(input),
    area: 'integrations',
  });
  return ok({ ok: true });
}

/** A new secret, shown once; the old one still signs for a day. */
export async function rotateWebhook(ctx: Ctx, id: string): Promise<Result<{ secret: string }>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  if (ctx.deps.webhooks === undefined) return err(unavailable);
  const e = await ctx.tx.webhooks.get(id);
  if (e === null) return err(notFound('webhook endpoint'));
  const next = rotated(e, new Date(ctx.at));
  await ctx.tx.webhooks.save(next);
  await audit(ctx, {
    kind: 'webhook',
    action: 'Rotated a webhook secret',
    target: new URL(e.url).host,
    targetId: id,
    area: 'integrations',
  });
  return ok({ secret: secretOf(ctx, next) });
}

export async function removeWebhook(ctx: Ctx, id: string): Promise<Result<{ ok: true }>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const e = await ctx.tx.webhooks.get(id);
  if (e === null) return err(notFound('webhook endpoint'));
  await ctx.tx.webhooks.remove(id);
  await audit(ctx, {
    kind: 'webhook',
    action: 'Removed a webhook endpoint',
    target: new URL(e.url).host,
    targetId: id,
    area: 'integrations',
  });
  return ok({ ok: true });
}

function signed(
  hooks: NonNullable<Deps['webhooks']>,
  tenantId: string,
  e: WebhookEndpoint,
  body: string,
  eventId: string,
  deliveryId: string,
  now: Date,
): { readonly headers: Record<string, string>; readonly body: string } {
  const secrets = liveVersions(e, now).map((v) => hooks.secret(tenantId, e.id, v));
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Kithena-Webhooks/1',
      'kithena-event-id': eventId,
      'kithena-delivery-id': deliveryId,
      'kithena-signature': hooks.sign(body, secrets),
    },
  };
}

/** "Send a test": a ping, signed like any delivery, answered with what the endpoint said. */
export async function testWebhook(ctx: Ctx, id: string): Promise<Result<{ status: number }>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  const hooks = ctx.deps.webhooks;
  if (hooks === undefined) return err(unavailable);
  const e = await ctx.tx.webhooks.get(id);
  if (e === null) return err(notFound('webhook endpoint'));
  const eventId = ctx.deps.newId();
  const body = JSON.stringify({
    eventId,
    eventName: 'performance.webhook.test',
    tenantId: ctx.caller.tenantId,
    occurredAt: ctx.at,
    payload: { endpointId: e.id },
  });
  const sent = await hooks.post(
    e.url,
    signed(hooks, ctx.caller.tenantId, e, body, eventId, ctx.deps.newId(), new Date(ctx.at)),
  );
  return ok({ status: sent.status });
}

/**
 * One pass of delivery, for every company with an endpoint ready: what was
 * written after its cursor, in order, the events it does not take skipped
 * past, the first failure stopping it until its backoff is over. The sends
 * happen between transactions, never inside one.
 */
export async function deliverWebhooks(deps: Deps): Promise<void> {
  const hooks = deps.webhooks;
  if (hooks === undefined) return;
  const published = new Set(manifest.publishes);
  for (const tenantId of await deps.uow.tenants()) {
    const now = deps.clock.now();
    const work = await deps.uow.run(tenantId, async (tx) => {
      const ready_ = (await tx.webhooks.find()).filter((e) => ready(e, now));
      return Promise.all(
        ready_.map(async (e) => ({ e, written: await tx.outbox.since(e.cursor, BATCH) })),
      );
    });
    for (const { e, written } of work) {
      let at = e;
      for (const w of written) {
        if (!published.has(w.eventName) || !subscribes(at, w.eventName)) {
          at = { ...at, cursor: { at: w.writtenAt, id: w.eventId } };
          continue;
        }
        const when = deps.clock.now();
        const sent = await hooks.post(
          at.url,
          signed(hooks, tenantId, at, JSON.stringify(w.envelope), w.eventId, deps.newId(), when),
        );
        at = afterSend(at, { eventId: w.eventId, writtenAt: w.writtenAt, status: sent.status }, when);
        if (at.failing !== null || at.disabled !== null) break;
      }
      if (at === e) continue;
      const kept = at;
      await deps.uow.run(tenantId, async (tx) => {
        // Only over what it was: an administrator's change meanwhile wins, and is read next pass.
        const now_ = await tx.webhooks.get(kept.id);
        if (now_ !== null && now_.version === e.version && now_.url === e.url)
          await tx.webhooks.save({ ...kept, events: now_.events, disabled: now_.disabled ?? kept.disabled });
      });
      if (kept.disabled !== null && e.disabled === null)
        logger.warn({ module: 'performance', endpoint: kept.id }, 'webhook endpoint turned off');
    }
  }
}
