import * as z from 'zod';
import { failure, ok, type Result } from '@kithena/domain-kit';
import { RequirednessPredicate, VisibilityRule } from '@kithena/contracts';

import {
  analyticsView,
  commitImportView,
  completeImportUpload,
  createEndpoint,
  deliveriesView,
  dryRunImport,
  exportBuilderView,
  integrationsView,
  startImportUpload,
  replayDelivery,
  rotateEndpoint,
  updateEndpoint,
  type ImportDeps,
  type IntegrationDeps,
} from '../application/screens/operations.js';
import {
  checkGrid,
  checkSection,
  completenessView,
  directoryView,
  historyView,
  identifierReviewsView,
  onboardingView,
  pickerView,
  profileView,
  saveGrid,
  saveSection,
} from '../application/screens/people.js';
import { BULK_PAGE, bulkEdit, bulkEditView } from '../application/screens/bulk-edit.js';
import { personOfViewer } from '../application/screens/record.js';
import { rolesView } from '../application/screens/roles.js';
import {
  addSection,
  adviseClassification,
  confirmEntity,
  previewPublish,
  publishDraft,
  publishSetup,
  registryView,
  reorderFields,
  reorderSections,
  saveField,
  setupView,
  type SchemaScreenDeps,
} from '../application/screens/schema.js';
import { run } from '../application/person/service.js';
import { sharing } from '../infrastructure/unit-of-work.js';
import type { IdempotencyStore } from './idempotency.js';
import { NoBody } from './lifecycle.js';
import {
  AsOfQuery,
  filterIn,
  idempotent,
  json,
  parse,
  refused,
  UUID,
  type Route,
  type RestResponse,
} from './rest.js';

/**
 * What the tenant app's screens read and act through (PEO-098).
 *
 * `/v1/views/*` answers with a screen's view model; the rest are the writes
 * only the application layer had until now — the draft, publishing, the setup
 * pack, import, webhook endpoints. Every one goes through the same caller
 * check as the rest of REST (`callerFrom`), and every decision about who may
 * do or see what is made in `application/screens/*`, not here.
 *
 * Every write carries an Idempotency-Key, as the rest of REST does (PEO-116).
 * The use cases open their own transactions, so each runs inside `sharing`:
 * they join the one that stores the key, and the write and its key commit
 * together. A retry is answered from what now exists — never from a stored
 * body — so a secret an endpoint was created or rotated with is not in a
 * replay, and a replayed import says it was imported (its report is not kept;
 * PEO-090). The four POSTs that change nothing are `safe` and take no key.
 */

export type ScreenRouteDeps = SchemaScreenDeps & IntegrationDeps & ImportDeps;

export const Sections = z.strictObject({ changed: z.record(z.string(), z.unknown()) });
export const Entity = z.strictObject({ name: z.string().max(200), country: z.string().max(2) });
export const SetupChoice = z.strictObject({
  country: z.string().max(2),
  sections: z.array(z.string().max(64)).max(100),
});
export const Order = z.strictObject({ order: z.array(z.string().max(64)).max(500) });
export const Label = z.strictObject({ label: z.string().trim().min(1).max(120) });
export const Field = z.strictObject({
  input: z.object({
    key: z.string().max(64),
    sectionKey: z.string().max(64),
    label: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable(),
    dataType: z.string().max(40),
    options: z.array(z.string().max(200)).max(200),
    requiredness: z.enum(['never', 'always', 'conditional']),
    // The contract's own schemas (PEO-065, PEO-066): the closed grammar is
    // refused here, at the boundary, and again by the draft.
    requiredWhen: RequirednessPredicate.nullable().default(null),
    ownership: z.array(z.string()).max(10),
    collectAt: z.string().max(20),
    visibility: z.array(z.string()).max(10),
    visibilityRules: z.array(VisibilityRule).max(5).default([]),
    classification: z.string().max(20),
    piiKind: z.string().max(20),
    classificationSource: z.enum(['suggested', 'human', 'section_default']),
  }),
  editing: z.string().max(64).nullable(),
});
export const Advice = z.strictObject({
  label: z.string().max(200),
  description: z.string().max(2000).nullable(),
  dataType: z.string().max(40),
  sectionKey: z.string().max(64),
  options: z.array(z.string().max(200)).max(200),
});
export const RequiredFrom = z.strictObject({ requiredFrom: z.iso.date() });
export const Grid = z.strictObject({
  changes: z
    .array(z.object({ personId: z.uuid(), values: z.record(z.string(), z.string()) }))
    .max(500),
});
/** A page of a bulk edit (PEO-071): the same values for these people, from one date. */
export const BulkEditBody = z.strictObject({
  personIds: z.array(z.uuid()).min(1).max(BULK_PAGE),
  values: z.record(z.string().max(64), z.unknown()),
  effectiveFrom: z.iso.date(),
});
export const EndpointBody = z.strictObject({
  url: z.string().max(2000),
  events: z.array(z.string().max(100)).max(50),
  allowlist: z.array(z.string().max(64)).max(500),
  alertEmail: z.string().max(320),
});
export const EndpointPatch = EndpointBody.partial().extend({ enabled: z.boolean().optional() });
/** What the browser is about to upload: its name and exact size, never its bytes (§14.2). */
export const UploadStart = z.strictObject({
  name: z.string().max(255),
  size: z.int().min(1),
});
/** A step after the upload: which upload, and the mapping once there is one. */
export const ImportStepBody = z.strictObject({
  uploadId: z.uuid(),
  mapping: z.record(z.string(), z.string().nullable()).optional(),
});

const answer = <T>(result: Result<T>, status = 200): RestResponse =>
  result.ok ? { status, body: result.value ?? { ok: true } } : refused(result.error);

function body<T>(schema: z.ZodType<T>, raw: string): Result<T> {
  const value = json(raw);
  return value.ok ? parse(schema, value.value) : value;
}

const importStep = (input: z.infer<typeof ImportStepBody>) => ({
  uploadId: input.uploadId,
  ...(input.mapping === undefined
    ? {}
    : {
        mapping: Object.fromEntries(
          Object.entries(input.mapping).map(([index, key]) => [Number(index), key]),
        ),
      }),
});

const KEY = '([a-z][a-z0-9_]{0,63})';

export function screenRoutes(deps: ScreenRouteDeps, idempotency: IdempotencyStore): Route[] {
  const keys = { service: deps.service, idempotency };
  type Asking = Parameters<Route['handle']>[0];
  const done = (): Promise<RestResponse> => Promise.resolve({ status: 200, body: { ok: true } });
  /**
   * A retried section save, answered as the first was (PEO-125): the same
   * findings, from the same function the save and the form's check answer
   * with — recomputed, not stored, so there is one code path.
   */
  const saved = async (
    asking: Asking,
    personId: string,
    changed: Readonly<Record<string, unknown>>,
  ): Promise<RestResponse> => {
    const found = await checkSection(deps, asking, personId, changed);
    return found.ok
      ? { status: 200, body: { ok: true, findings: found.value.findings } }
      : refused(found.error);
  };

  /**
   * A keyed write. `resource` names what it produced (the tenant when it is
   * nothing more particular); `again` answers a retry from what exists now.
   */
  const write =
    <T, R>(
      schema: z.ZodType<T>,
      act: (asking: Asking, input: T, id: string) => Promise<Result<R>>,
      options: {
        readonly status?: number;
        readonly resource?: (asking: Asking, id: string, value: R) => string;
        readonly again?: (asking: Asking, resourceId: string, input: T) => Promise<RestResponse>;
      } = {},
    ): Route['handle'] =>
    async (asking, request, params) => {
      const input = body(schema, request.body);
      if (!input.ok) return refused(input.error);
      const id = params['id'] ?? '';
      const status = options.status ?? 200;
      let first: RestResponse | undefined;
      return idempotent(
        keys,
        asking,
        request,
        status,
        async (tx) => {
          const result = await sharing({ tx, tenantId: asking.tenantId }, () =>
            act(asking, input.value, id),
          );
          if (!result.ok) return result;
          first = answer(result, status);
          return ok(options.resource?.(asking, id, result.value) ?? asking.tenantId);
        },
        (resourceId, replayed) =>
          !replayed && first !== undefined
            ? Promise.resolve(first)
            : (options.again ?? done)(asking, resourceId, input.value),
      );
    };

  /** A POST that only computes: no key, nothing to replay. */
  const compute =
    <T, R>(
      schema: z.ZodType<T>,
      act: (asking: Asking, input: T) => Promise<Result<R>>,
    ): Route['handle'] =>
    async (asking, request) => {
      const input = body(schema, request.body);
      if (!input.ok) return refused(input.error);
      return answer(await act(asking, input.value));
    };

  const version = async (asking: Asking): Promise<RestResponse> => {
    const current = await run(deps.service, asking.tenantId, async (tx) =>
      ok(await deps.service.schemas.current(tx, asking.tenantId)),
    );
    return answer(current.ok ? ok({ version: current.value?.version ?? null }) : current);
  };
  const endpoint = (_asking: Asking, resourceId: string) =>
    Promise.resolve<RestResponse>({ status: 200, body: { id: resourceId } });

  return [
    /* people */
    {
      method: 'GET',
      pattern: /^\/v1\/views\/onboarding$/,
      handle: async (asking) => answer(await onboardingView(deps, asking)),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/profile$/,
      handle: async (asking) => answer(await profileView(deps, asking, null)),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/views/profile/${UUID}$`),
      handle: async (asking, _r, params) =>
        answer(await profileView(deps, asking, params['id'] ?? '')),
    },
    // A record as of a date, and every change behind it (PEO-064).
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/views/history(?:/${UUID})?$`),
      handle: async (asking, _r, params, query) => {
        const q = parse(AsOfQuery, Object.fromEntries(query));
        if (!q.ok) return refused(q.error);
        return answer(await historyView(deps, asking, params['id'] ?? null, q.value.asOf ?? null));
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/me\/sections$/,
      handle: write(
        Sections,
        async (asking, input) => {
          const own = await run(deps.service, asking.tenantId, (tx) =>
            personOfViewer(deps, tx, asking),
          );
          return own.ok ? saveSection(deps, asking, own.value, input.changed) : own;
        },
        {
          again: async (asking, _resource, input) => {
            const own = await run(deps.service, asking.tenantId, (tx) =>
              personOfViewer(deps, tx, asking),
            );
            return own.ok ? saved(asking, own.value, input.changed) : refused(own.error);
          },
        },
      ),
    },
    // What saving would be warned about, saving nothing (PEO-125).
    {
      method: 'POST',
      pattern: /^\/v1\/views\/me\/identifier-check$/,
      safe: true,
      handle: compute(Sections, async (asking, input) => {
        const own = await run(deps.service, asking.tenantId, (tx) =>
          personOfViewer(deps, tx, asking),
        );
        return own.ok ? checkSection(deps, asking, own.value, input.changed) : own;
      }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/views/people/${UUID}/identifier-check$`),
      safe: true,
      handle: async (asking, request, params) => {
        const input = body(Sections, request.body);
        if (!input.ok) return refused(input.error);
        return answer(await checkSection(deps, asking, params['id'] ?? '', input.value.changed));
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/identifier-reviews$/,
      handle: async (asking) => answer(await identifierReviewsView(deps, asking)),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/views/people/${UUID}/sections$`),
      handle: write(Sections, (asking, input, id) => saveSection(deps, asking, id, input.changed), {
        resource: (_asking, id) => id,
        again: (asking, id, input) => saved(asking, id, input.changed),
      }),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/directory$/,
      handle: async (asking, _r, _p, query) => {
        const filter = query.get('filter') ?? undefined;
        if (
          filter !== undefined &&
          !/^[a-z][a-z0-9_]*:[^,]+(,[a-z][a-z0-9_]*:[^,]+)*$/.test(filter)
        ) {
          return refused(failure('BAD_REQUEST', 'filter is key:value pairs', ['filter']));
        }
        const after = query.get('after') ?? undefined;
        if (after !== undefined && !new RegExp(`^${UUID}$`).test(after)) {
          return refused(failure('BAD_REQUEST', 'after is a person id', ['after']));
        }
        return answer(
          await directoryView(deps, asking, {
            search: (query.get('search') ?? '').slice(0, 200),
            filters: filterIn(filter),
            after: after ?? null,
          }),
        );
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/completeness$/,
      handle: async (asking, _r, _p, query) => {
        const after = query.get('after') ?? undefined;
        if (after !== undefined && !new RegExp(`^${UUID}$`).test(after)) {
          return refused(failure('BAD_REQUEST', 'after is a person id', ['after']));
        }
        return answer(await completenessView(deps, asking, { after: after ?? null }));
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/people-picker$/,
      handle: async (asking, _r, _p, query) => {
        const after = query.get('after') ?? undefined;
        if (after !== undefined && !new RegExp(`^${UUID}$`).test(after)) {
          return refused(failure('BAD_REQUEST', 'after is a person id', ['after']));
        }
        return answer(
          await pickerView(deps, asking, {
            search: (query.get('search') ?? '').slice(0, 200),
            after: after ?? null,
          }),
        );
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/completeness$/,
      handle: write(Grid, (asking, input) => saveGrid(deps, asking, input.changes), {
        // A retry answers with the same cell warnings, from the grid's own check.
        again: async (asking, _resource, input) => {
          const found = await checkGrid(deps, asking, input.changes);
          return found.ok
            ? { status: 200, body: { ok: true, findings: found.value.findings } }
            : refused(found.error);
        },
      }),
    },
    // What saving these cells would be warned about, saving nothing (PEO-125).
    {
      method: 'POST',
      pattern: /^\/v1\/views\/completeness\/identifier-check$/,
      safe: true,
      handle: compute(Grid, (asking, input) => checkGrid(deps, asking, input.changes)),
    },

    /* bulk edit (PEO-071): the screen, the preview that keeps nothing, the commit */
    {
      method: 'GET',
      pattern: /^\/v1\/views\/bulk-edit$/,
      handle: async (asking, _r, _p, query) => {
        const ids = (query.get('people') ?? '').split(',').filter((id) => id !== '');
        if (!ids.every((id) => new RegExp(`^${UUID}$`).test(id))) {
          return refused(failure('BAD_REQUEST', 'people is person ids, comma-separated', ['people']));
        }
        return answer(await bulkEditView(deps, asking, ids));
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/bulk-edit\/preview$/,
      safe: true,
      handle: compute(BulkEditBody, (asking, input) => bulkEdit(deps, asking, input, 'preview')),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/bulk-edit$/,
      handle: write(BulkEditBody, (asking, input) => bulkEdit(deps, asking, input, 'commit'), {
        // A retry is answered from what stands now: what the first request
        // wrote reads as unchanged, and nothing is written twice.
        again: async (asking, _resource, input) =>
          answer(await bulkEdit(deps, asking, input, 'preview')),
      }),
    },

    /* roles (PEO-112): the view here, the writes at /v1/roles/* */
    {
      method: 'GET',
      pattern: /^\/v1\/views\/roles$/,
      handle: async (asking) => answer(await rolesView(deps, asking)),
    },

    /* the registry and setup */
    {
      method: 'GET',
      pattern: /^\/v1\/views\/registry$/,
      handle: async (asking) => answer(await registryView(deps, asking)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/schema\/draft\/sections$/,
      handle: write(Label, (asking, input) => addSection(deps, asking, input.label), {
        status: 201,
      }),
    },
    {
      method: 'PUT',
      pattern: /^\/v1\/schema\/draft\/sections\/order$/,
      handle: write(Order, (asking, input) => reorderSections(deps, asking, input.order)),
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/v1/schema/draft/sections/${KEY}/order$`),
      handle: write(Order, (asking, input, key) => reorderFields(deps, asking, key, input.order)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/schema\/draft\/attributes$/,
      handle: write(Field, (asking, input) => saveField(deps, asking, input.input, input.editing)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/schema\/draft\/advice$/,
      safe: true,
      handle: compute(Advice, (_asking, input) => Promise.resolve(ok(adviseClassification(input)))),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/schema\/draft\/preview$/,
      safe: true,
      handle: compute(RequiredFrom, (asking, input) =>
        previewPublish(deps, asking, input.requiredFrom, async (tx) => {
          const since = new Date(0);
          return (await deps.listEndpoints(tx, asking.tenantId, since)).endpoints.filter(
            (e) => e.enabled && e.events.includes('people.schema.published'),
          ).length;
        }),
      ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/schema\/draft\/publish$/,
      handle: write(
        RequiredFrom,
        (asking, input) => publishDraft(deps, asking, input.requiredFrom),
        { status: 201, again: version },
      ),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/setup$/,
      handle: async (asking) => answer(await setupView(deps, asking)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/setup\/entity$/,
      handle: write(Entity, (asking, input) => confirmEntity(deps, asking, input)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/setup\/publish$/,
      handle: write(SetupChoice, (asking, input) => publishSetup(deps, asking, input), {
        status: 201,
        again: version,
      }),
    },

    /* integrations */
    {
      method: 'GET',
      pattern: /^\/v1\/views\/integrations$/,
      handle: async (asking) => answer(await integrationsView(deps, asking)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/webhooks\/endpoints$/,
      handle: write(EndpointBody, (asking, input) => createEndpoint(deps, asking, input), {
        status: 201,
        resource: (_asking, _id, made) => made.id,
        again: endpoint,
      }),
    },
    {
      method: 'PATCH',
      pattern: new RegExp(`^/v1/webhooks/endpoints/${UUID}$`),
      handle: write(
        EndpointPatch,
        (asking, input, id) =>
          updateEndpoint(
            deps,
            asking,
            id,
            Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
          ),
        { resource: (_asking, id) => id, again: endpoint },
      ),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/webhooks/endpoints/${UUID}/rotate$`),
      handle: write(NoBody, (asking, _input, id) => rotateEndpoint(deps, asking, id), {
        resource: (_asking, id) => id,
        again: endpoint,
      }),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/webhooks/endpoints/${UUID}/deliveries$`),
      handle: async (asking, _request, params, query) =>
        answer(await deliveriesView(deps, asking, params['id'] ?? '', query.get('after'))),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/webhooks/deliveries/${UUID}/replay$`),
      handle: write(
        NoBody,
        async (asking, _input, id) => {
          const replayed = await replayDelivery(deps, asking, id);
          return replayed.ok ? ok({ deliveryId: replayed.value }) : replayed;
        },
        {
          status: 201,
          resource: (_asking, _id, made) => made.deliveryId,
          again: (_asking, deliveryId) => Promise.resolve({ status: 201, body: { deliveryId } }),
        },
      ),
    },

    /* import */
    {
      // Where to put the file: a presigned PUT, straight to storage (§14.2).
      // Unkeyed: a retry is a fresh upload, and the earlier one is let go.
      method: 'POST',
      pattern: /^\/v1\/imports\/uploads$/,
      safe: true,
      handle: compute(UploadStart, (asking, input) => startImportUpload(deps, asking, input)),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/imports/uploads/${UUID}/complete$`),
      safe: true,
      handle: async (asking, _request, params) =>
        answer(await completeImportUpload(deps, asking, params['id'] ?? '')),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/imports\/dry-run$/,
      safe: true,
      handle: compute(ImportStepBody, (asking, input) =>
        dryRunImport(deps, asking, importStep(input)),
      ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/imports$/,
      handle: write(ImportStepBody, (asking, input) => commitImportView(deps, asking, importStep(input)), {
        status: 201,
        // The report is not kept (PEO-090), so a retry is told it went through.
        again: () =>
          Promise.resolve(
            refused(
              failure(
                'ALREADY_IMPORTED',
                'This import went through on the first request with this key',
              ),
            ),
          ),
      }),
    },

    /* export and analytics */
    {
      method: 'GET',
      pattern: /^\/v1\/views\/export$/,
      handle: async (asking) => answer(await exportBuilderView(deps, asking)),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/analytics$/,
      handle: async (asking) => answer(await analyticsView(deps, asking)),
    },
  ];
}

/** How big a request body may be. No file comes this way: an import's goes to storage (§14.2). */
export const BODY_LIMIT = 256 * 1024;
