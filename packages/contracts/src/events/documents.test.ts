import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { documentsEvents } from './documents.js';

/**
 * Documents' events (PRD §13). No payload may hold a document's title, its
 * text, its bytes or a value read from it.
 */

function keysOf(schema: z.ZodType, out = new Set<string>()): Set<string> {
  if (schema instanceof z.ZodObject) {
    for (const [key, child] of Object.entries(schema.shape)) {
      out.add(key);
      if (child instanceof z.ZodType) keysOf(child, out);
    }
  } else if (schema instanceof z.ZodArray) {
    if (schema.element instanceof z.ZodType) keysOf(schema.element, out);
  } else if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion) {
    for (const option of schema.options) if (option instanceof z.ZodType) keysOf(option, out);
  } else if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    const inner = schema.unwrap();
    if (inner instanceof z.ZodType) keysOf(inner, out);
  }
  return out;
}

const FORBIDDEN = /title|name|text|content|bytes|body|summary|value|salary|fileName/iu;

describe('no Documents payload can hold what a document says', () => {
  it.each(documentsEvents.map((event) => [event.name, event] as const))('%s', (_name, event) => {
    const keys = [...keysOf(event.payload)];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => FORBIDDEN.test(key))).toEqual([]);
  });

  it('every name is in the documents namespace, once', () => {
    const names = documentsEvents.map((event) => event.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith('documents.'))).toBe(true);
  });
});

describe('what Documents publishes as an envelope is signed', () => {
  it('names the signer by the envelope’s own id, and an outside signer is no user', () => {
    const parsed = documentsEvents
      .find((e) => e.name === 'documents.envelope.signed')
      ?.schema.safeParse({
        eventId: '01890000-0000-7000-8000-000000000001',
        eventName: 'documents.envelope.signed',
        eventVersion: 1,
        tenantId: '00000000-0000-4000-8000-0000000000a1',
        occurredAt: '2026-10-25T22:20:00.000Z',
        recordedAt: '2026-10-25T22:20:00.000Z',
        effectiveFrom: '2026-10-25',
        aggregate: { type: 'Envelope', id: 'e1', version: 0 },
        actor: { kind: 'system', process: 'documents.signer' },
        correlationId: '00000000-0000-4000-8000-0000000000c1',
        causationId: null,
        payload: {
          envelopeId: '00000000-0000-4000-8000-0000000000e1',
          signerId: 's1',
          personId: null,
          subjectRef: 'recruiting:offer:00000000-0000-4000-8000-0000000000f1:1',
          turn: [],
        },
      });
    expect(parsed?.success).toBe(true);
  });
});
