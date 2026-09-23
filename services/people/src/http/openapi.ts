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
  CreatePersonBody,
  ExportBody,
  ErrorBody,
  HistoryEntryBody,
  LegalEntityBody,
  ListQuery,
  LocationBody,
  LocationZoneBody,
  PatchLegalEntityBody,
  PatchLocationBody,
  PatchPersonBody,
  PatchSettingsBody,
  PersonBody,
  PersonPageBody,
  SchemaVersionSummary,
  SettingsBody,
} from './rest.js';

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
  PersonPage: PersonPageBody,
  CreatePerson: CreatePersonBody,
  PatchPerson: PatchPersonBody,
  Correction: CorrectionBody,
  HistoryEntry: HistoryEntryBody,
  HistoryPage: z.object({ items: z.array(HistoryEntryBody) }),
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
  Location: LocationBody,
  Locations: z.object({ items: z.array(LocationBody) }),
  CreateLocation: CreateLocationBody,
  PatchLocation: PatchLocationBody,
  LocationZone: LocationZoneBody,
  CreateFullValues: CreateFullValuesBody,
  FullValuesDecision: FullValuesDecisionBody,
  FullValues: FullValuesBody,
  Error: ErrorBody,
} as const;

type Component = keyof typeof components;

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
          responses: { 201: { description: 'Created', ...json('Person') }, ...failure },
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
          responses: { 200: { description: 'The person after', ...json('Person') }, ...failure },
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
      '/v1/people/{id}/corrections': {
        post: {
          summary: 'Correct a recorded fact; carries supersedes, never overwrites',
          parameters: [id, idempotencyKey],
          requestBody: { required: true, ...json('Correction') },
          responses: {
            201: { description: 'The correction', ...json('HistoryEntry') },
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
          responses: { 201: { description: 'The location after', ...json('Location') }, ...failure },
        },
      },
    },
    components: {
      schemas: Object.fromEntries(
        Object.entries(components).map(([name, schema]) => [
          name,
          z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }),
        ]),
      ),
    },
  };
}
