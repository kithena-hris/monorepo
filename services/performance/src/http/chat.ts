import { createHash } from 'node:crypto';
import { presentsInternalToken } from '@kithena/auth-kit';
import { TenantId } from '@kithena/contracts';

import { contextOf } from '../application/context.js';
import type { Caller, ChatPlan, Deps } from '../application/ports.js';
import { plan, runAs, type RestRequest, type RestResponse } from './rest.js';

/**
 * The chat app's door into Performance (PRD §23.2, PRF-164), for
 * `platform/slack` alone, over the pair's secret (`SLACK_PERFORMANCE_TOKEN`):
 *
 *   POST /internal/chat/relay   a button pressed, `{ tenantId, value }`
 *   POST /internal/chat/plan    a request in words, `{ tenantId, email, text }`
 *
 * A press runs what its button was sealed to run, as the person it was sent
 * to, through the same routes as every other surface (audited "via Slack").
 * A request is Ask Kithena's plan, kept an hour for its Do it.
 */

export const CHAT_PREFIX = '/internal/chat/';
const PLAN_HOURS = 1;

const answer = (status: number, body: unknown): RestResponse => ({ status, body });
const said = (text: string): RestResponse => answer(200, { text });

export function chatHandler(
  deps: Deps,
  token: string,
): (request: RestRequest) => Promise<RestResponse> {
  return async (request) => {
    if (token === '' || !presentsInternalToken({ headers: request.headers }, token))
      return answer(401, { error: { code: 'UNAUTHENTICATED', message: 'Not the chat app' } });
    if (request.method !== 'POST') return answer(405, {});
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(request.body === '' ? '{}' : request.body) as Record<string, unknown>;
    } catch {
      return answer(400, {});
    }
    const tenant = TenantId.safeParse(body['tenantId']);
    if (!tenant.success) return answer(400, {});
    const tenantId = tenant.data;
    const path = new URL(request.url, 'http://performance.internal').pathname;
    const chat = deps.chat;
    if (chat === undefined) return said('Performance is not connected to the chat app here.');

    const callerOf = async (accountId: string): Promise<Caller> => {
      const member = await deps.uow.run(tenantId, (tx) => tx.members.byAccount(accountId));
      return {
        tenantId,
        accountId,
        personId: member?.personId ?? null,
        correlationId: deps.newId(),
        via: 'Slack',
      };
    };

    if (path === `${CHAT_PREFIX}relay`) {
      const value = typeof body['value'] === 'string' ? body['value'] : '';
      const press = chat.open(value);
      if (press === null || press.tenantId !== tenantId)
        return said('That button is not one of Performance’s.');
      if (Date.parse(press.until) < deps.clock.now().getTime())
        return said('This button has expired. Open it in Kithena instead.');
      const caller = await callerOf(press.accountId);
      // The same press twice is one request: its key is the button's.
      const key = `chat:${createHash('sha256').update(value).digest('hex')}`;
      if (press.kind === 'route') {
        const done = await runAs(deps, caller, press.route, press.params, press.body, key);
        return said(done.ok ? 'Done. Kithena has it.' : `Not done: ${done.message ?? 'refused'}.`);
      }
      const kept = await deps.uow.run(tenantId, (tx) => tx.chatPlans.get(press.planId));
      if (kept === null || kept.accountId !== press.accountId)
        return said('That plan has gone. Ask again.');
      if (kept.ran !== null) return said('Already done.');
      const lines: string[] = [];
      for (const [i, s] of kept.steps.entries()) {
        const done = await runAs(deps, caller, s.route, s.params, s.body, `${key}:${String(i)}`);
        lines.push(
          `${done.ok ? '✓' : '✗'} ${s.summary}${done.ok ? '' : `: ${done.message ?? 'refused'}`}`,
        );
        if (!done.ok) break;
      }
      await deps.uow.run(tenantId, (tx) =>
        tx.chatPlans.save({ ...kept, ran: deps.clock.now().toISOString() }),
      );
      return said(lines.join('\n'));
    }

    if (path === `${CHAT_PREFIX}plan`) {
      const email = typeof body['email'] === 'string' ? body['email'].toLowerCase() : '';
      const text = typeof body['text'] === 'string' ? body['text'].slice(0, 2000) : '';
      if (email === '' || text.trim().length < 2) return answer(400, {});
      const member = (await deps.uow.run(tenantId, (tx) => tx.members.list())).find(
        (m) => m.workEmail?.toLowerCase() === email && m.accountId !== null,
      );
      const accountId = member?.accountId ?? null;
      if (accountId === null)
        return answer(200, { reply: 'Kithena does not know you in Performance yet.', steps: [] });
      const caller = await callerOf(accountId);
      const planned = await deps.uow.run(tenantId, async (tx) => {
        const ctx = await contextOf(deps, tx, caller);
        const result = await plan(ctx, text, null);
        if (!result.ok) return { reply: result.error.message, kept: null };
        const value = result.value as { reply: string; steps: ChatPlan['steps'] };
        if (value.steps.length === 0) return { reply: value.reply, kept: null };
        const kept: ChatPlan = {
          id: deps.newId(),
          accountId,
          reply: value.reply,
          steps: value.steps.map((s) => ({
            route: s.route,
            params: s.params,
            body: s.body,
            summary: s.summary,
          })),
          until: new Date(deps.clock.now().getTime() + PLAN_HOURS * 3_600_000).toISOString(),
          ran: null,
        };
        await tx.chatPlans.save(kept);
        return { reply: value.reply, kept };
      });
      const kept = planned.kept;
      return answer(200, {
        reply: planned.reply,
        steps: kept === null ? [] : kept.steps.map((s) => s.summary),
        ...(kept === null
          ? {}
          : {
              run: chat.seal({
                kind: 'plan',
                tenantId,
                accountId,
                planId: kept.id,
                until: kept.until,
              }),
            }),
      });
    }
    return answer(404, {});
  };
}
