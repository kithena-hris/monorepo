import * as z from 'zod';

import {
  AsOfQuery,
  CompletenessBody,
  CorrectionBody,
  CreateExportBody,
  CreateLegalEntityBody,
  CreateLocationBody,
  CreateFullValuesBody,
  FullValuesBody,
  FullValuesDecisionBody,
  PendingChangeBody,
  PendingChangeDecisionBody,
  PendingChangesBody,
  CreatePersonBody,
  ExportBody,
  ErrorBody,
  HistoryEntryBody,
  CorrectionWriteBody,
  DuplicateBody,
  DuplicateDismissalBody,
  IdentifierDecidedBody,
  IdentifierRevealBody,
  IdentifierRevealedBody,
  IdentifierReviewBody,
  IdentifierReviewDecisionBody,
  LegalEntityBody,
  ListQuery,
  LocationBody,
  LocationZoneBody,
  NumberingBody,
  PatchLegalEntityBody,
  PatchLocationBody,
  PatchPersonBody,
  PatchSettingsBody,
  PersonBody,
  PersonPageBody,
  PersonWriteBody,
  PutNumberingBody,
  SchemaVersionSummary,
  SettingsBody,
} from './rest.js';
import { EmploymentPeriodsBody, LIFECYCLE_ACTIONS, NoBody } from './lifecycle.js';
import {
  Advice,
  BulkEditBody,
  Entity,
  EndpointBody,
  ScimConnectionBody,
  ScimMappingBody,
  EndpointPatch,
  Field,
  Grid,
  Label,
  Order,
  RequiredFrom,
  Sections,
  SetupChoice,
  ImportStepBody,
  SegmentBody,
  PayBandBody,
  ScheduleBody,
  UploadStart,
} from './screens.js';
import { RoleChangeBody, RoleHolderBody } from './roles.js';

/**
 * The OpenAPI document for REST v1, generated from the Zod schemas `rest.ts`
 * validates with. The route list is code; every schema in it is
 * `z.toJSONSchema` of the definition the handler actually parses against, so
 * the document cannot describe a body the API would refuse.
 *
 * Attribute values are described per published version by the schema
 * artifact at `/v1/schema/versions/{version}`, because they are per tenant
 * and this document is not.
 */

const components = {
  Person: PersonBody,
  PersonWrite: PersonWriteBody,
  PersonPage: PersonPageBody,
  IdentifierReviews: z.object({ items: z.array(IdentifierReviewBody) }),
  Duplicates: z.object({ items: z.array(DuplicateBody) }),
  DuplicateDismissal: DuplicateDismissalBody,
  IdentifierReviewDecision: IdentifierReviewDecisionBody,
  IdentifierDecided: IdentifierDecidedBody,
  IdentifierReveal: IdentifierRevealBody,
  IdentifierRevealed: IdentifierRevealedBody,
  CreatePerson: CreatePersonBody,
  PatchPerson: PatchPersonBody,
  Correction: CorrectionBody,
  HistoryEntry: HistoryEntryBody,
  CorrectionWrite: CorrectionWriteBody,
  HistoryPage: z.object({ items: z.array(HistoryEntryBody) }),
  EmploymentPeriods: EmploymentPeriodsBody,
  Completeness: CompletenessBody,
  SchemaVersions: z.object({ items: z.array(SchemaVersionSummary) }),
  CreateExport: CreateExportBody,
  Export: ExportBody,
  Settings: SettingsBody,
  PatchSettings: PatchSettingsBody,
  LegalEntity: LegalEntityBody,
  LegalEntities: z.object({ items: z.array(LegalEntityBody) }),
  CreateLegalEntity: CreateLegalEntityBody,
  PatchLegalEntity: PatchLegalEntityBody,
  Numbering: NumberingBody,
  PutNumbering: PutNumberingBody,
  Location: LocationBody,
  Locations: z.object({ items: z.array(LocationBody) }),
  CreateLocation: CreateLocationBody,
  PatchLocation: PatchLocationBody,
  LocationZone: LocationZoneBody,
  CreateFullValues: CreateFullValuesBody,
  FullValuesDecision: FullValuesDecisionBody,
  FullValues: FullValuesBody,
  PendingChange: PendingChangeBody,
  PendingChanges: PendingChangesBody,
  PendingChangeDecision: PendingChangeDecisionBody,
  // The screens' writes (PEO-098, keyed and documented in PEO-116).
  SectionChanges: Sections,
  CompletenessChanges: Grid,
  BulkEdit: BulkEditBody,
  NewSection: Label,
  Order,
  DraftField: Field,
  FieldAdvice: Advice,
  RequiredFrom,
  SetupEntity: Entity,
  SetupChoice,
  CreateWebhookEndpoint: EndpointBody,
  PatchWebhookEndpoint: EndpointPatch,
  CreateScimConnection: ScimConnectionBody,
  ScimMapping: ScimMappingBody,
  ImportUploadStart: UploadStart,
  ImportStep: ImportStepBody,
  Segment: SegmentBody,
  PayBand: PayBandBody,
  ReportSchedule: ScheduleBody,
  RoleHolder: RoleHolderBody,
  RoleHolders: z.object({ items: z.array(RoleHolderBody) }),
  RoleChange: RoleChangeBody,
  Error: ErrorBody,
} as const;

/** PEO-108's moves, each body a component named for its mutation; the person after either way. */
const lifecycleBodies = Object.fromEntries(
  LIFECYCLE_ACTIONS.filter((a) => a.body !== NoBody).map((a) => [a.name, a.body]),
);
function lifecyclePaths(): Record<string, unknown> {
  return Object.fromEntries(
    LIFECYCLE_ACTIONS.map((a) => [
      `/v1/people/{id}/${a.path}`,
      {
        post: {
          summary: a.summary,
          parameters: [id, idempotencyKey],
          ...(Object.hasOwn(lifecycleBodies, a.name)
            ? {
                requestBody: {
                  required: true,
                  content: {
                    'application/json': { schema: { $ref: `#/components/schemas/${a.name}` } },
                  },
                },
              }
            : {}),
          responses: { 200: { description: 'The person after', ...json('Person') }, ...failure },
        },
      },
    ]),
  );
}

type Component = keyof typeof components;

/**
 * One of the screens' POST/PUT/PATCH routes. `safe` ones compute and change
 * nothing, so take no key; every other one does (PEO-116).
 */
function screenWrite(
  summary: string,
  body: Component | null,
  status: 200 | 201,
  answered: string,
  options: { readonly path?: 'id' | 'key'; readonly safe?: true } = {},
): object {
  const at =
    options.path === 'id'
      ? [id]
      : options.path === 'key'
        ? [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }]
        : [];
  return {
    summary,
    parameters: options.safe ? at : [...at, idempotencyKey],
    ...(body === null ? {} : { requestBody: { required: true, ...json(body) } }),
    responses: { [status]: { description: answered }, ...failure },
  };
}

function screenPaths(): Record<string, unknown> {
  return {
    '/v1/views/me/sections': {
      post: screenWrite('Save a section of my own record', 'SectionChanges', 200, 'Saved'),
    },
    '/v1/views/people/{id}/sections': {
      post: screenWrite("Save a section of someone's record", 'SectionChanges', 200, 'Saved', {
        path: 'id',
      }),
    },
    '/v1/views/me/identifier-check': {
      post: screenWrite(
        'What saving these values would be warned about (PEO-125); nothing is kept',
        'SectionChanges',
        200,
        '{ findings }',
        { safe: true },
      ),
    },
    '/v1/views/people/{id}/identifier-check': {
      post: screenWrite(
        "What saving these values on someone's record would be warned about; nothing is kept",
        'SectionChanges',
        200,
        '{ findings }',
        { path: 'id', safe: true },
      ),
    },
    '/v1/views/completeness/identifier-check': {
      post: screenWrite(
        "What saving these grid cells would be warned about (PEO-125); nothing is kept",
        'CompletenessChanges',
        200,
        '{ findings }, each with its personId',
        { safe: true },
      ),
    },
    '/v1/views/completeness': {
      post: screenWrite(
        "The completeness grid's bulk save; one write per person",
        'CompletenessChanges',
        200,
        'Saved',
      ),
    },
    '/v1/views/bulk-edit/preview': {
      post: screenWrite(
        'What a bulk edit would change and refuse, per person, and why (PEO-071); nothing is kept',
        'BulkEdit',
        200,
        '{ committed: false, rows }',
        { safe: true },
      ),
    },
    '/v1/views/bulk-edit': {
      post: screenWrite(
        'A page of a bulk edit: one write per person, each atomic, each answered',
        'BulkEdit',
        200,
        '{ committed: true, rows }',
      ),
    },
    '/v1/schema/draft/sections': {
      post: screenWrite('Add a section to the draft', 'NewSection', 201, 'Added'),
    },
    '/v1/schema/draft/sections/order': {
      put: screenWrite('Order the draft sections', 'Order', 200, 'Ordered'),
    },
    '/v1/schema/draft/sections/{key}/order': {
      put: screenWrite("Order a draft section's fields", 'Order', 200, 'Ordered', { path: 'key' }),
    },
    '/v1/schema/draft/attributes': {
      post: screenWrite('Add a field to the draft, or change one', 'DraftField', 200, 'Saved'),
    },
    '/v1/schema/draft/advice': {
      post: screenWrite('The classification suggested for a field', 'FieldAdvice', 200, 'Advice', {
        safe: true,
      }),
    },
    '/v1/schema/draft/preview': {
      post: screenWrite(
        'What publishing the draft would change; nothing is kept',
        'RequiredFrom',
        200,
        'The preview',
        { safe: true },
      ),
    },
    '/v1/schema/draft/publish': {
      post: screenWrite('Publish the draft', 'RequiredFrom', 201, '{ version }'),
    },
    '/v1/views/setup/entity': {
      post: screenWrite("Confirm the setup wizard's legal entity", 'SetupEntity', 200, 'Kept'),
    },
    '/v1/views/setup/publish': {
      post: screenWrite(
        'Accept the core fields and a country pack, and publish version 1',
        'SetupChoice',
        201,
        '{ version }; the version in force when one is already published',
      ),
    },
    '/v1/webhooks/endpoints': {
      post: screenWrite(
        'Register a webhook endpoint; people_admin only',
        'CreateWebhookEndpoint',
        201,
        '{ id, secret }. A retry answers { id }: the secret is shown once',
      ),
    },
    '/v1/webhooks/endpoints/{id}': {
      patch: screenWrite(
        'Change or re-enable an endpoint',
        'PatchWebhookEndpoint',
        200,
        'Changed',
        { path: 'id' },
      ),
    },
    '/v1/webhooks/endpoints/{id}/rotate': {
      post: screenWrite(
        "Rotate an endpoint's secret; the old one signs for 24 hours more",
        null,
        200,
        '{ secret }. A retry answers { id }: the secret is shown once',
        { path: 'id' },
      ),
    },
    '/v1/scim/connections': {
      post: screenWrite(
        'Connect an upstream system to provision people over SCIM; people_admin only',
        'CreateScimConnection',
        201,
        '{ id, token }. A retry answers { id }: the token is shown once',
      ),
    },
    '/v1/scim/connections/{id}/rotate': {
      post: screenWrite(
        "Rotate a connection's token; the old one authenticates for 24 hours more",
        null,
        200,
        '{ id, token }. A retry answers { id }: the token is shown once',
        { path: 'id' },
      ),
    },
    '/v1/scim/connections/{id}/revoke': {
      post: screenWrite(
        'Disconnect: its tokens stop at once and it owns no attribute any more',
        null,
        200,
        'Revoked',
        { path: 'id' },
      ),
    },
    '/v1/scim/connections/{id}/mapping': {
      put: screenWrite(
        'Set the approved mapping; every attribute it names is kept in that system (PEO-073)',
        'ScimMapping',
        200,
        'Set',
        { path: 'id' },
      ),
    },
    '/v1/webhooks/deliveries/{id}/replay': {
      post: screenWrite('Send a stored delivery again', null, 201, '{ deliveryId }', {
        path: 'id',
      }),
    },
    '/v1/segments': {
      post: screenWrite(
        'Save a segment: a named filter, shared within the tenant or not (PEO-068)',
        'Segment',
        201,
        'The segment, and where you could use it',
      ),
    },
    '/v1/pay-bands': {
      get: {
        summary:
          'Every pay band as it now stands, per grade, currency and day; HR or finance (PEO-078)',
        responses: { 200: { description: '{ items }, amounts in minor units' }, ...failure },
      },
      post: screenWrite(
        'Set a pay band from a day, or correct the one recorded for that day; HR or finance (PEO-078)',
        'PayBand',
        201,
        'The band as recorded, and the row it supersedes if any',
      ),
    },
    '/v1/segments/{id}': {
      delete: screenWrite('Delete a segment you saved', null, 200, 'Deleted', { path: 'id' }),
    },
    '/v1/report-schedules': {
      post: screenWrite(
        'Schedule a report (PEO-069): an export file or the analytics summary, built as each recipient on every run and emailed as a link; HR or people_admin',
        'ReportSchedule',
        201,
        'The schedule. It first runs at the next period, not now',
      ),
    },
    '/v1/report-schedules/{id}/pause': {
      post: screenWrite('Pause a scheduled report', null, 200, 'The schedule', { path: 'id' }),
    },
    '/v1/report-schedules/{id}/resume': {
      post: screenWrite(
        'Resume a scheduled report from the next period; what it was paused through is not sent',
        null,
        200,
        'The schedule',
        { path: 'id' },
      ),
    },
    '/v1/report-schedules/{id}': {
      put: screenWrite(
        'Change a scheduled report; whoever saves it owns it, and it starts again from the next period',
        'ReportSchedule',
        200,
        'The schedule',
        { path: 'id' },
      ),
      delete: screenWrite('Delete a scheduled report and its run history', null, 200, 'Deleted', {
        path: 'id',
      }),
    },
    '/v1/imports/uploads': {
      post: screenWrite(
        'Start an upload: a presigned PUT for exactly this file, straight to storage, for five minutes',
        'ImportUploadStart',
        200,
        '{ uploadId, url, method, headers, expiresAt }: PUT the file there with exactly these headers',
        { safe: true },
      ),
    },
    '/v1/imports/uploads/{id}/complete': {
      post: screenWrite(
        'The file is uploaded: check it, and get the proposed mapping',
        null,
        200,
        'The mapping',
        { path: 'id', safe: true },
      ),
    },
    '/v1/imports/dry-run': {
      post: screenWrite(
        'The dry run of an uploaded file; nothing is written',
        'ImportStep',
        200,
        'The review, with a signed link to the blocked rows',
        { safe: true },
      ),
    },
    '/v1/imports': {
      post: screenWrite(
        'Commit an uploaded file; the upload is deleted after',
        'ImportStep',
        201,
        'The report. A retry answers ALREADY_IMPORTED: the report is not kept',
      ),
    },
  };
}

const ref = (name: Component) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: Component) => ({ content: { 'application/json': { schema: ref(name) } } });

const failure = { default: { description: 'A refusal, with a stable code', ...json('Error') } };
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const idempotencyKey = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  description:
    'Every write carries one. A retry with the same key and body is answered, not repeated.',
  schema: { type: 'string', minLength: 1, maxLength: 255 },
};

/** Query parameters, one per key of a Zod object. */
function queryParameters(schema: z.ZodObject): object[] {
  return Object.entries(schema.shape).map(([name, field]) => ({
    name,
    in: 'query',
    required: false,
    schema: z.toJSONSchema(field as z.ZodType, { io: 'input', unrepresentable: 'any' }),
  }));
}

export function openApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'People', version: '1' },
    paths: {
      '/v1/schema': {
        get: {
          summary: 'The published schema version in force',
          responses: { 200: { description: 'The version and its document' }, ...failure },
        },
      },
      '/v1/schema/versions': {
        get: {
          summary: 'Every published version, newest first',
          responses: { 200: { description: 'History', ...json('SchemaVersions') }, ...failure },
        },
      },
      '/v1/schema/versions/{version}': {
        get: {
          summary: 'One published version as JSON Schema, to pin to and generate types from',
          parameters: [
            { name: 'version', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'A JSON Schema document; immutable' }, ...failure },
        },
      },
      '/v1/people': {
        get: {
          summary: 'People, a page at a time',
          parameters: queryParameters(ListQuery),
          responses: { 200: { description: 'A page', ...json('PersonPage') }, ...failure },
        },
        post: {
          summary: 'Create a person',
          parameters: [idempotencyKey],
          requestBody: { required: true, ...json('CreatePerson') },
          responses: {
            201: {
              description: 'Created, with what the checks found on its national identifiers',
              ...json('PersonWrite'),
            },
            ...failure,
          },
        },
      },
      '/v1/people/{id}': {
        get: {
          summary: 'One person, as this caller may see them',
          parameters: [id, ...queryParameters(AsOfQuery)],
          responses: { 200: { description: 'The person', ...json('Person') }, ...failure },
        },
        patch: {
          summary: 'Change some attributes; each is authorized on its own',
          parameters: [id, idempotencyKey],
          requestBody: { required: true, ...json('PatchPerson') },
          responses: {
            200: {
              description:
                'The person after, with what the checks found on each national identifier written; a doubted one is saved and goes to HR’s review',
              ...json('PersonWrite'),
            },
            ...failure,
          },
        },
      },
      '/v1/duplicates': {
        get: {
          summary:
            'Pairs of records that look like one human, strongest first, with why and never a value (PEO-074); HR only. Merging is POST /v1/people/{id}/merge',
          responses: {
            200: { description: 'Undecided pairs', ...json('Duplicates') },
            ...failure,
          },
        },
      },
      '/v1/duplicates/dismissals': {
        post: {
          summary: 'HR says a pair are two people; the queue stops offering it',
          parameters: [idempotencyKey],
          requestBody: { required: true, ...json('DuplicateDismissal') },
          responses: {
            200: { description: 'The decision', ...json('DuplicateDismissal') },
            ...failure,
          },
        },
      },
      '/v1/identifier-reviews': {
        get: {
          summary: 'National identifiers our checks doubted, waiting for HR (PEO-125); HR only',
          responses: {
            200: { description: 'Oldest first', ...json('IdentifierReviews') },
            ...failure,
          },
        },
      },
      '/v1/people/{id}/identifier-reviews': {
        post: {
          summary:
            'HR decides a doubted identifier: accept (final, never flagged again) or send_back to the employee',
          parameters: [id, idempotencyKey],
          requestBody: { required: true, ...json('IdentifierReviewDecision') },
          responses: {
            200: { description: 'The decision', ...json('IdentifierDecided') },
            ...failure,
          },
        },
      },
      '/v1/people/{id}/identifier-reviews/reveal': {
        post: {
          summary: 'The doubted value in full, for HR deciding it; audited, changes nothing',
          parameters: [id],
          requestBody: { required: true, ...json('IdentifierReveal') },
          responses: {
            200: { description: 'The value', ...json('IdentifierRevealed') },
            ...failure,
          },
        },
      },
      '/v1/people/{id}/history': {
        get: {
          summary: 'Effective-dated history, per attribute',
          parameters: [
            id,
            { name: 'attribute', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'History', ...json('HistoryPage') }, ...failure },
        },
      },
      '/v1/people/{id}/employment-periods': {
        get: {
          summary: 'Every employment on this person, first first (PEO-110); HR only',
          parameters: [id],
          responses: {
            200: { description: 'Employment periods', ...json('EmploymentPeriods') },
            ...failure,
          },
        },
      },
      '/v1/people/{id}/corrections': {
        post: {
          summary: 'Correct a recorded fact; carries supersedes, never overwrites',
          parameters: [id, idempotencyKey],
          requestBody: { required: true, ...json('Correction') },
          responses: {
            201: {
              description:
                'The correction, with what the checks found if it corrected a national identifier',
              ...json('CorrectionWrite'),
            },
            ...failure,
          },
        },
      },
      '/v1/people/{id}/completeness': {
        get: {
          summary: 'What is missing and who owns it',
          parameters: [id],
          responses: { 200: { description: 'The verdict', ...json('Completeness') }, ...failure },
        },
      },
      '/v1/exports': {
        post: {
          summary:
            'Export what this caller may read; over 2,000 rows it is queued (202) and completes later',
          parameters: [idempotencyKey],
          requestBody: { required: true, ...json('CreateExport') },
          responses: {
            201: {
              description: 'Completed, with links that expire in 24 hours',
              ...json('Export'),
            },
            202: { description: 'Queued; ask for it by id', ...json('Export') },
            ...failure,
          },
        },
      },
      '/v1/exports/full-values': {
        post: {
          summary:
            'Finance asks for sealed fields in full, with a reason; HR decides within seven days',
          parameters: [idempotencyKey],
          requestBody: { required: true, ...json('CreateFullValues') },
          responses: { 201: { description: 'Pending', ...json('FullValues') }, ...failure },
        },
      },
      '/v1/exports/full-values/{id}': {
        get: {
          summary: 'A request, to its requester or HR; the one-use link only to the requester',
          parameters: [id],
          responses: { 200: { description: 'The request', ...json('FullValues') }, ...failure },
        },
      },
      '/v1/exports/full-values/{id}/decision': {
        post: {
          summary: 'HR approves or rejects; an approval issues one download',
          parameters: [id, idempotencyKey],
          requestBody: { required: true, ...json('FullValuesDecision') },
          responses: { 200: { description: 'The request', ...json('FullValues') }, ...failure },
        },
      },
      '/v1/pending-changes': {
        get: {
          summary:
            'Changes waiting for approval: every one in the tenant for HR, the caller’s own otherwise; oldest first',
          responses: {
            200: { description: 'Open changes', ...json('PendingChanges') },
            ...failure,
          },
        },
      },
      '/v1/pending-changes/{id}': {
        get: {
          summary: 'One change, to its requester, HR, or a reader of the field while it waits',
          parameters: [id],
          responses: { 200: { description: 'The change', ...json('PendingChange') }, ...failure },
        },
      },
      '/v1/pending-changes/{id}/decision': {
        post: {
          summary:
            'HR approves or rejects; never the requester or the subject. An approval applies the value from its effectiveFrom',
          parameters: [id, idempotencyKey],
          requestBody: { required: true, ...json('PendingChangeDecision') },
          responses: { 200: { description: 'The change', ...json('PendingChange') }, ...failure },
        },
      },
      '/v1/pending-changes/{id}/withdrawal': {
        post: {
          summary: 'The requester takes it back while it waits',
          parameters: [id, idempotencyKey],
          responses: { 200: { description: 'The change', ...json('PendingChange') }, ...failure },
        },
      },
      '/v1/people/{id}/pending-changes': {
        get: {
          summary:
            'This person’s changes waiting for HR, on fields the caller reads, masked as the field is; never in attributes',
          parameters: [id],
          responses: {
            200: { description: 'Open changes', ...json('PendingChanges') },
            ...failure,
          },
        },
      },
      '/v1/exports/{id}': {
        get: {
          summary: 'An export this caller asked for, with its links signed again',
          parameters: [id],
          responses: { 200: { description: 'The export', ...json('Export') }, ...failure },
        },
      },
      '/v1/settings': {
        get: {
          summary: "The tenant's default time zone and cohort minimum",
          responses: { 200: { description: 'Settings', ...json('Settings') }, ...failure },
        },
        patch: {
          summary: 'Change them; people_admin only. The cohort minimum is never lowered',
          parameters: [idempotencyKey],
          requestBody: { required: true, ...json('PatchSettings') },
          responses: { 200: { description: 'Settings after', ...json('Settings') }, ...failure },
        },
      },
      '/v1/legal-entities': {
        get: {
          summary: 'Every legal entity, archived ones flagged',
          responses: { 200: { description: 'Entities', ...json('LegalEntities') }, ...failure },
        },
        post: {
          summary: 'Add a legal entity with its country and default time zone; people_admin only',
          parameters: [idempotencyKey],
          requestBody: { required: true, ...json('CreateLegalEntity') },
          responses: { 201: { description: 'Created', ...json('LegalEntity') }, ...failure },
        },
      },
      '/v1/legal-entities/{id}': {
        patch: {
          summary: 'Rename, change the default zone, or archive; people_admin only',
          parameters: [id, idempotencyKey],
          requestBody: { required: true, ...json('PatchLegalEntity') },
          responses: { 200: { description: 'After', ...json('LegalEntity') }, ...failure },
        },
      },
      '/v1/legal-entities/{id}/numbering': {
        get: {
          summary: "The entity's employee numbering; 404 when it does not number its people",
          parameters: [id],
          responses: { 200: { description: 'Scheme', ...json('Numbering') }, ...failure },
        },
        put: {
          summary:
            'Set the prefix, width and start a hire here is numbered from; people_admin only',
          parameters: [id, idempotencyKey],
          requestBody: { required: true, ...json('PutNumbering') },
          responses: { 200: { description: 'Scheme', ...json('Numbering') }, ...failure },
        },
      },
      '/v1/locations': {
        get: {
          summary: 'Every location, with its zone today and its dated zones',
          responses: { 200: { description: 'Locations', ...json('Locations') }, ...failure },
        },
        post: {
          summary: 'Add a location under a legal entity; people_admin only',
          parameters: [idempotencyKey],
          requestBody: { required: true, ...json('CreateLocation') },
          responses: { 201: { description: 'Created', ...json('Location') }, ...failure },
        },
      },
      '/v1/locations/{id}': {
        patch: {
          summary: 'Rename or archive; people_admin only',
          parameters: [id, idempotencyKey],
          requestBody: { required: true, ...json('PatchLocation') },
          responses: { 200: { description: 'After', ...json('Location') }, ...failure },
        },
      },
      '/v1/locations/{id}/zones': {
        post: {
          summary: "Change a location's zone from a date; the same date again is a correction",
          parameters: [id, idempotencyKey],
          requestBody: { required: true, ...json('LocationZone') },
          responses: {
            201: { description: 'The location after', ...json('Location') },
            ...failure,
          },
        },
      },
      '/v1/roles': {
        get: {
          summary: 'Who holds a tenant role; HR and people_admin only (PEO-112)',
          responses: { 200: { description: 'Holders', ...json('RoleHolders') }, ...failure },
        },
      },
      '/v1/roles/grants': {
        post: {
          summary:
            'Grant a tenant role; people_admin only, never to oneself. The account’s roles after; a role already held changes nothing',
          parameters: [idempotencyKey],
          requestBody: { required: true, ...json('RoleChange') },
          responses: { 200: { description: 'After', ...json('RoleHolder') }, ...failure },
        },
      },
      '/v1/roles/revocations': {
        post: {
          summary:
            'Revoke a tenant role; people_admin only, never the last people_admin (409 LAST_ADMIN)',
          parameters: [idempotencyKey],
          requestBody: { required: true, ...json('RoleChange') },
          responses: { 200: { description: 'After', ...json('RoleHolder') }, ...failure },
        },
      },
      ...lifecyclePaths(),
      ...screenPaths(),
    },
    components: {
      schemas: Object.fromEntries(
        Object.entries({ ...components, ...lifecycleBodies }).map(([name, schema]) => [
          name,
          z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }),
        ]),
      ),
    },
  };
}
