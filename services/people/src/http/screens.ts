import * as z from 'zod';
import { failure, ok, type Result } from '@kithena/domain-kit';

import {
  analyticsView,
  commitImportView,
  createEndpoint,
  dryRunImport,
  exportBuilderView,
  integrationsView,
  proposeImport,
  replayDelivery,
  rotateEndpoint,
  updateEndpoint,
  type ImportDeps,
  type IntegrationDeps,
} from '../application/screens/operations.js';
import {
  completenessView,
  directoryView,
  onboardingView,
  profileView,
  saveGrid,
  saveSection,
} from '../application/screens/people.js';
import { personOfViewer } from '../application/screens/record.js';
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
import { filterIn, json, parse, refused, UUID, type Route, type RestResponse } from './rest.js';

/**
 * What the tenant app's screens read and act through (PEO-098).
 *
 * `/v1/views/*` answers with a screen's view model; the rest are the writes
 * only the application layer had until now — the draft, publishing, the setup
 * pack, import, webhook endpoints. Every one goes through the same caller
 * check as the rest of REST (`callerFrom`), and every decision about who may
 * do or see what is made in `application/screens/*`, not here.
 *
 * ponytail: these writes take no Idempotency-Key. Draft edits and publishing
 * converge on a retry (a second publish is refused as unchanged, an import is
 * keyed by its file), creating a section or an endpoint twice does not. Add
 * the key when an integrator, rather than the tenant app, calls them.
 */

export type ScreenRouteDeps = SchemaScreenDeps & IntegrationDeps & ImportDeps;

const Sections = z.strictObject({ changed: z.record(z.string(), z.unknown()) });
const Entity = z.strictObject({ name: z.string().max(200), country: z.string().max(2) });
const SetupChoice = z.strictObject({
  country: z.string().max(2),
  sections: z.array(z.string().max(64)).max(100),
});
const Order = z.strictObject({ order: z.array(z.string().max(64)).max(500) });
const Label = z.strictObject({ label: z.string().trim().min(1).max(120) });
const Field = z.strictObject({
  input: z.object({
    key: z.string().max(64),
    sectionKey: z.string().max(64),
    label: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable(),
    dataType: z.string().max(40),
    options: z.array(z.string().max(200)).max(200),
    requiredness: z.enum(['never', 'always']),
    ownership: z.array(z.string()).max(10),
    collectAt: z.string().max(20),
    visibility: z.array(z.string()).max(10),
    classification: z.string().max(20),
    piiKind: z.string().max(20),
    classificationSource: z.enum(['suggested', 'human', 'section_default']),
  }),
  editing: z.string().max(64).nullable(),
});
const Advice = z.strictObject({
  label: z.string().max(200),
  description: z.string().max(2000).nullable(),
  dataType: z.string().max(40),
  sectionKey: z.string().max(64),
  options: z.array(z.string().max(200)).max(200),
});
const RequiredFrom = z.strictObject({ requiredFrom: z.iso.date() });
const Grid = z.strictObject({
  changes: z
    .array(z.object({ personId: z.uuid(), values: z.record(z.string(), z.string()) }))
    .max(500),
});
const EndpointBody = z.strictObject({
  url: z.string().max(2000),
  events: z.array(z.string().max(100)).max(50),
  allowlist: z.array(z.string().max(64)).max(500),
  alertEmail: z.string().max(320),
});
const EndpointPatch = EndpointBody.partial().extend({ enabled: z.boolean().optional() });
const Upload = z.strictObject({
  name: z.string().max(255),
  /** The file, base64. The same bytes every step: nothing is kept between them. */
  file: z.base64(),
  mapping: z.record(z.string(), z.string().nullable()).optional(),
});

const answer = <T>(result: Result<T>, status = 200): RestResponse =>
  result.ok ? { status, body: result.value ?? { ok: true } } : refused(result.error);

function body<T>(schema: z.ZodType<T>, raw: string): Result<T> {
  const value = json(raw);
  return value.ok ? parse(schema, value.value) : value;
}

const upload = (input: z.infer<typeof Upload>) => ({
  name: input.name,
  bytes: new Uint8Array(Buffer.from(input.file, 'base64')),
  ...(input.mapping === undefined
    ? {}
    : {
        mapping: Object.fromEntries(
          Object.entries(input.mapping).map(([index, key]) => [Number(index), key]),
        ),
      }),
});

const KEY = '([a-z][a-z0-9_]{0,63})';

export function screenRoutes(deps: ScreenRouteDeps): Route[] {
  const write =
    <T, R>(
      schema: z.ZodType<T>,
      act: (asking: Parameters<Route['handle']>[0], input: T, id: string) => Promise<Result<R>>,
      status = 200,
    ): Route['handle'] =>
    async (asking, request, params) => {
      const input = body(schema, request.body);
      if (!input.ok) return refused(input.error);
      return answer(await act(asking, input.value, params['id'] ?? ''), status);
    };

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
    {
      method: 'POST',
      pattern: /^\/v1\/views\/me\/sections$/,
      handle: write(Sections, async (asking, input) => {
        const own = await run(deps.service, asking.tenantId, (tx) =>
          personOfViewer(deps, tx, asking),
        );
        return own.ok ? saveSection(deps, asking, own.value, input.changed) : own;
      }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/views/people/${UUID}/sections$`),
      handle: write(Sections, (asking, input, id) => saveSection(deps, asking, id, input.changed)),
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
      handle: async (asking) => answer(await completenessView(deps, asking)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/completeness$/,
      handle: write(Grid, (asking, input) => saveGrid(deps, asking, input.changes)),
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
      handle: write(Label, (asking, input) => addSection(deps, asking, input.label), 201),
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
      handle: write(Advice, (_asking, input) => Promise.resolve(ok(adviseClassification(input)))),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/schema\/draft\/preview$/,
      handle: write(RequiredFrom, (asking, input) =>
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
        201,
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
      handle: write(SetupChoice, (asking, input) => publishSetup(deps, asking, input), 201),
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
      handle: write(EndpointBody, (asking, input) => createEndpoint(deps, asking, input), 201),
    },
    {
      method: 'PATCH',
      pattern: new RegExp(`^/v1/webhooks/endpoints/${UUID}$`),
      handle: write(EndpointPatch, (asking, input, id) =>
        updateEndpoint(
          deps,
          asking,
          id,
          Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
        ),
      ),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/webhooks/endpoints/${UUID}/rotate$`),
      handle: write(z.strictObject({}), (asking, _input, id) => rotateEndpoint(deps, asking, id)),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/webhooks/deliveries/${UUID}/replay$`),
      handle: write(
        z.strictObject({}),
        async (asking, _input, id) => {
          const replayed = await replayDelivery(deps, asking, id);
          return replayed.ok ? ok({ deliveryId: replayed.value }) : replayed;
        },
        201,
      ),
    },

    /* import */
    {
      method: 'POST',
      pattern: /^\/v1\/imports\/proposal$/,
      handle: write(Upload, (asking, input) => proposeImport(deps, asking, upload(input))),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/imports\/dry-run$/,
      handle: write(Upload, (asking, input) => dryRunImport(deps, asking, upload(input))),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/imports$/,
      handle: write(Upload, (asking, input) => commitImportView(deps, asking, upload(input)), 201),
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

/** How big a request body may be: an import carries its file, base64. */
export function bodyLimit(path: string): number {
  return path.startsWith('/v1/imports') ? 140 * 1024 * 1024 : 256 * 1024;
}
