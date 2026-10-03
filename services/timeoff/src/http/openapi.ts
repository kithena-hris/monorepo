import * as z from 'zod';

import { ROUTES, ScheduleBody, type Route } from './rest.js';

/**
 * The OpenAPI document for `/v1/timeoff/...` (TOF-046), generated from the
 * route table `rest.ts` dispatches with: every schema in it is
 * `z.toJSONSchema` of the definition a handler actually parses against or
 * answers with, so the document cannot describe a body the API would refuse.
 */

const pascal = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

const titleOf = (schema: z.ZodType): string | undefined => {
  const title = z.globalRegistry.get(schema)?.title;
  return typeof title === 'string' ? title : undefined;
};

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });

/** One component per schema, however many routes share it. */
function components(
  pick: (r: Route) => z.ZodType | null,
  suffix: string,
  io: 'input' | 'output',
  extra: Record<string, z.ZodType> = {},
): { ids: Map<z.ZodType, string>; schemas: Record<string, unknown> } {
  const registry = z.registry<{ id: string }>();
  const ids = new Map<z.ZodType, string>();
  const add = (schema: z.ZodType, id: string) => {
    if (ids.has(schema)) return;
    ids.set(schema, id);
    registry.add(schema, { id });
  };
  for (const [id, schema] of Object.entries(extra)) add(schema, id);
  for (const r of ROUTES) {
    const schema = pick(r);
    if (schema !== null) add(schema, titleOf(schema) ?? `${pascal(r.name)}${suffix}`);
  }
  const { schemas } = z.toJSONSchema(registry, {
    io,
    unrepresentable: 'any',
    uri: (id) => `#/components/schemas/${id}`,
  });
  return { ids, schemas };
}

const ErrorBody = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        path: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

const isRequired = (field: z.ZodType) => {
  const type = (field._zod.def as { type: string }).type;
  return type !== 'optional' && type !== 'default' && type !== 'nullable';
};

export function openApiDocument(): Record<string, unknown> {
  const bodies = components((r) => r.body, 'Body', 'input', { TimeOffSchedule: ScheduleBody });
  const answers = components((r) => r.answer, 'Answer', 'output');
  const paths: Record<string, Record<string, unknown>> = {};

  for (const r of ROUTES) {
    const inPath = new Set([...r.path.matchAll(/\{([a-zA-Z]+)\}/gu)].map((m) => m[1]));
    const parameters = Object.entries(r.params.shape)
      .filter(([name]) => inPath.has(name) || r.method === 'GET')
      .map(([name, field]) => ({
        name,
        in: inPath.has(name) ? 'path' : 'query',
        required: inPath.has(name) || isRequired(field as z.ZodType),
        schema: z.toJSONSchema(field as z.ZodType, { io: 'input', unrepresentable: 'any' }),
      }));
    // A public write (a kiosk's queue) is made idempotent by its own sequence, not a key.
    if (r.method !== 'GET' && !r.public) {
      parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', minLength: 1, maxLength: 255 } as never,
      });
    }
    const answerId = answers.ids.get(r.answer);
    const content =
      (r.answer._zod.def as { type: string }).type === 'string'
        ? { 'text/calendar': { schema: { type: 'string' } } }
        : { 'application/json': { schema: answerId === undefined ? {} : ref(answerId) } };
    const bodyId = r.body === null ? undefined : bodies.ids.get(r.body);
    (paths[r.path] ??= {})[r.method.toLowerCase()] = {
      operationId: r.name,
      summary: r.summary,
      ...(r.public ? { security: [] } : {}),
      parameters,
      ...(bodyId === undefined
        ? {}
        : {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: ref(bodyId) } },
            },
          }),
      responses: {
        [String(r.status)]: { description: 'Done', content },
        default: {
          description: 'Refused, with the domain’s code',
          content: { 'application/json': { schema: ref('TimeOffError') } },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Time Off', version: '1' },
    paths,
    components: {
      schemas: { ...bodies.schemas, ...answers.schemas, TimeOffError: ErrorBody },
    },
  };
}
