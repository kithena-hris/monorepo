import * as z from 'zod';
import { CalendarDate, Instant, TenantId } from './primitives.js';

/**
 * The first segment of every topic name: `kithena.<module>.v<n>`.
 *
 * ### Why this is a constant
 *
 * It was a literal in `defineEvent` and again in each module's contract test,
 * and the tests restated it rather than importing it — so the two could
 * disagree and the suite would still be green, because both sides had been
 * edited by the same careless hand. Naming it once removes that.
 *
 * ### Renaming this is not a rename
 *
 * Kafka has no in-place topic rename. Changing this value does not move
 * anything: it starts writing to a new set of topics and leaves the old ones
 * holding every event ever published, with the schema-registry subjects,
 * Debezium connectors and every deployed consumer still pointed at the names
 * nobody writes to any more.
 *
 * Against a live cluster the change is expand-contract, the same shape as a
 * column rename: publish to both namespaces, move consumers across, stop
 * publishing to the old one, drop it once retention has passed. Editing this
 * string is only safe while no topic under the previous namespace has anything
 * in it worth keeping.
 */
export const EVENT_NAMESPACE = 'kithena';

/**
 * The envelope every module emits. `occurredAt` and `effectiveFrom` are
 * deliberately separate: HR data is bitemporal. A promotion entered on the
 * 15th and effective on the 1st needs both dates to survive, or payroll
 * cannot compute a retroactive delta.
 */
export const Actor = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    userId: z.uuid(),
    /** Set when an admin is impersonating. Always logged, never optional in practice. */
    onBehalfOf: z.uuid().optional(),
  }),
  z.object({
    kind: z.literal('integration'),
    integrationId: z.uuid(),
    provider: z.string(),
  }),
  z.object({ kind: z.literal('system'), process: z.string() }),
]);
export type Actor = z.infer<typeof Actor>;

export const AggregateRef = z.object({
  type: z.string(),
  id: z.string(),
  version: z.int().nonnegative(),
});

export const EventEnvelope = z.object({
  /** UUIDv7: sortable by time, which makes the outbox trivially orderable. */
  eventId: z.uuidv7(),
  eventName: z.string(),
  eventVersion: z.int().positive(),
  tenantId: TenantId,
  occurredAt: Instant,
  recordedAt: Instant,
  effectiveFrom: CalendarDate.nullable(),
  aggregate: AggregateRef,
  actor: Actor,
  correlationId: z.uuid(),
  causationId: z.uuid().nullable(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

/**
 * What `defineEvent` returns. Named so the factory can carry an explicit
 * signature; the shape is still inferred from the payload schema.
 */
export interface EventDefinition<TName extends string, TSchema extends z.ZodType> {
  readonly name: TName;
  readonly version: number;
  readonly payload: TSchema;
  readonly schema: z.ZodType;
  /** Topic per module, partitioned by tenantId:aggregateId for per-aggregate order. */
  readonly topic: string;
  readonly parse: (input: unknown) => unknown;
  readonly safeParse: (input: unknown) => z.ZodSafeParseResult<unknown>;
}

/** Bind a payload schema to the envelope and keep the event name in the type. */
export function defineEvent<TName extends string, TSchema extends z.ZodType>(
  name: TName,
  version: number,
  payload: TSchema,
): EventDefinition<TName, TSchema> {
  const schema = EventEnvelope.extend({
    eventName: z.literal(name),
    eventVersion: z.literal(version),
    payload,
  });

  return {
    name,
    version,
    payload,
    schema,
    /** Topic per module, partitioned by tenantId:aggregateId for per-aggregate order. */
    // The module is the first segment of the event name, which `defineEvent`
    // requires to be dotted; `?? name` keeps the type honest rather than
    // asserting the split cannot be empty.
    topic: `${EVENT_NAMESPACE}.${name.split('.')[0] ?? name}.v${String(version)}`,
    parse: (input: unknown) => schema.parse(input),
    safeParse: (input: unknown) => schema.safeParse(input),
  } as const;
}

export type DefinedEvent = EventDefinition<string, z.ZodType>;
export type EventOf<T extends { schema: z.ZodType }> = z.infer<T['schema']>;
