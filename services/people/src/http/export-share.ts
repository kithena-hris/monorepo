import { logger } from '@kithena/telemetry';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { run, type PeopleService } from '../application/person/service.js';
import type { Asking } from '../application/person/person-access.js';
import {
  decideExportShare,
  exportRecord,
  previewShare,
  shareExport,
  sharesToDecide,
  shareView,
  ShareAsk,
  ShareDecisionAsk,
  SharePreviewAsk,
  type ShareDeps,
  type ShareMail,
  type WithMail,
} from '../application/export/share.js';
import type { IdempotencyStore } from './idempotency.js';
import { idempotent, json, parse, refused, UUID, type Route, type RestResponse } from './rest.js';

/**
 * An export sent to somebody else, over REST (design AI13, AI14, MA10):
 * preview who it is for and what they could not read, send it or ask for
 * approval, decide, and the finished export as its requester and recipient
 * see it. Every rule is the application layer's (`application/export/share.ts`).
 *
 * Emails go once the write has committed, and only from the request that
 * made it: a replayed key answers with the state as it is and sends nothing.
 */
export function shareRoutes(deps: {
  readonly service: PeopleService;
  readonly idempotency: IdempotencyStore;
  readonly share: ShareDeps | undefined;
}): Route[] {
  const unavailable = (): RestResponse =>
    refused(failure('UNAVAILABLE', 'Sending exports is not configured'));

  const answer = <T>(result: Result<T>): RestResponse =>
    result.ok ? { status: 200, body: result.value } : refused(result.error);

  const inShare = <T>(
    asking: Asking,
    act: (d: ShareDeps, tx: Parameters<Parameters<typeof run>[2]>[0]) => Promise<Result<T>>,
  ): Promise<Result<T>> | null => {
    const d = deps.share;
    return d === undefined ? null : run(deps.service, asking.tenantId, (tx) => act(d, tx));
  };

  /** After the commit: an email that fails is logged, and the write it announces stands. */
  const deliver = async (tenantId: string, mail: readonly ShareMail[]): Promise<void> => {
    const mailer = deps.share?.mailer;
    const companyOf = deps.share?.company;
    if (mailer === undefined || companyOf === undefined || mail.length === 0) return;
    const company = await deps.service.inTenant(tenantId, ({ tx }) => companyOf(tx, tenantId));
    if (company === null) return;
    for (const m of mail) {
      // eslint-disable-next-line no-await-in-loop -- one email at a time is messaging's pace
      await mailer.send(tenantId, company, m).catch((cause: unknown) => {
        logger.error({ err: cause, tenantId, notice: m.notice }, 'export email not sent');
      });
    }
  };

  /** A keyed write whose use case returns emails: sent once, by the request that wrote. */
  const keyed =
    <I, T>(
      schema: Parameters<typeof parse<I>>[0],
      act: (
        d: ShareDeps,
        tx: Parameters<Parameters<typeof run>[2]>[0],
        asking: Asking,
        input: I,
        id: string,
      ) => Promise<Result<WithMail<T>>>,
      resource: (value: T, id: string) => string,
      again: (asking: Asking, resourceId: string) => Promise<RestResponse>,
    ): Route['handle'] =>
    async (asking, request, params) => {
      const id = params['id'] ?? '';
      // `ours`: this request's write is the one that committed, so its emails are owed.
      const wrote: { first: WithMail<T> | null; ours: boolean } = { first: null, ours: false };
      const answered = await idempotent(
        deps,
        asking,
        request,
        200,
        async (tx) => {
          // Inside the keyed write, so a request without a key is refused for that first.
          const d = deps.share;
          if (d === undefined) {
            return err(failure('UNAVAILABLE', 'Sending exports is not configured'));
          }
          const body = json(request.body);
          const input = body.ok ? parse(schema, body.value) : body;
          if (!input.ok) return input;
          const done = await act(d, tx, asking, input.value, id);
          if (!done.ok) return done;
          wrote.first = done.value;
          return ok(resource(done.value.value, id));
        },
        async (resourceId, replayed) => {
          if (replayed || wrote.first === null) return again(asking, resourceId);
          wrote.ours = true;
          return { status: 200, body: wrote.first.value };
        },
      );
      if (wrote.ours && wrote.first !== null && answered.status < 300) {
        await deliver(asking.tenantId, wrote.first.mail);
      }
      return answered;
    };

  const readShare = async (asking: Asking, id: string): Promise<RestResponse> => {
    const found = inShare(asking, (d, tx) => shareView(tx, d, asking, id));
    return found === null ? unavailable() : answer(await found);
  };

  return [
    {
      method: 'POST',
      pattern: /^\/v1\/exports\/share\/preview$/,
      safe: true,
      handle: async (asking, request) => {
        const body = json(request.body);
        const input = body.ok ? parse(SharePreviewAsk, body.value) : body;
        if (!input.ok) return refused(input.error);
        const found = inShare(asking, (d, tx) => previewShare(tx, d, asking, input.value));
        return found === null ? unavailable() : answer(await found);
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/exports\/share$/,
      handle: keyed(
        ShareAsk,
        (d, tx, asking, input) => shareExport(tx, d, asking, input),
        // The key's resource is a uuid: the export sent, or the request waiting.
        (value) => (value.status === 'sent' ? value.exportId : value.requestId),
        async (asking, resourceId) => {
          // A retry answers with what the first request made, as it is now.
          const waiting = await readShare(asking, resourceId);
          return waiting.status === 404
            ? { status: 200, body: { status: 'sent', exportId: resourceId } }
            : waiting.status < 300
              ? { status: 200, body: { status: 'waiting', requestId: resourceId, approvers: [] } }
              : waiting;
        },
      ),
    },
    {
      // Review's Exports (E5): the requests this viewer may decide now.
      method: 'GET',
      pattern: /^\/v1\/exports\/share$/,
      handle: async (asking) => {
        const found = inShare(asking, (d, tx) => sharesToDecide(tx, d, asking));
        return found === null ? answer(ok([])) : answer(await found);
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/exports/share/${UUID}$`),
      handle: (asking, _request, params) => readShare(asking, params['id'] ?? ''),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/exports/share/${UUID}/decision$`),
      handle: keyed(
        ShareDecisionAsk,
        (d, tx, asking, input, id) => decideExportShare(tx, d, asking, id, input),
        (_value, id) => id,
        readShare,
      ),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/exports/${UUID}/record$`),
      handle: async (asking, _request, params) => {
        const found = inShare(asking, (d, tx) => exportRecord(tx, d, asking, params['id'] ?? ''));
        return found === null ? unavailable() : answer(await found);
      },
    },
  ];
}
